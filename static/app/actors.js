import { t } from '../i18n.js';
import { diagnostic } from '../i18n.js';
import { transformExample } from './labels.js';
import { pollJob } from '../jobs-client.js';
import ui_default from '../ui.js';
var actors_default = {
  name: 'actors',
  dependencies: [
    'actorTitle',
    'api',
    'change',
    'inspect',
    'reconcileWorkspace',
    'modalChoice',
    'openPluginSettings',
    'parameterModal',
    'render',
    'save',
    'toast',
    'updateStatus'
  ],
  create({
    workspaceState,
    executionState,
    pluginsState,
    actorTitle,
    api,
    change,
    inspect,
    reconcileWorkspace,
    modalChoice,
    openPluginSettings,
    parameterModal,
    render,
    save,
    toast,
    updateStatus
  }) {
    async function transform(node, documentData = workspaceState.project.document) {
      const ids = new Set(
        documentData.edges.filter((e) => e.target === node.id).map((e) => e.source)
      );
      const inputs = documentData.nodes.filter((n) => ids.has(n.id) && n.type !== 'actor');
      return new Promise((resolve, reject) => {
        const worker = new Worker('/transform-worker.js');
        const timer = setTimeout(() => {
          worker.terminate();
          reject(Error(t('Transform nach 2 Sekunden abgebrochen.')));
        }, 2e3);
        worker.onmessage = (e) => {
          clearTimeout(timer);
          worker.terminate();
          e.data.error ? reject(Error(e.data.error)) : resolve(e.data.outputs);
        };
        worker.onerror = (e) => {
          clearTimeout(timer);
          worker.terminate();
          reject(Error(e.message));
        };
        worker.postMessage({
          inputs,
          code: node.data.params?.code || transformExample
        });
      });
    }
    async function run(node) {
      if (
        !workspaceState.project ||
        executionState.preflighting.has(node.id) ||
        executionState.activeActors.has(node.id) ||
        executionState.actorQueue.some((j) => j.id === node.id)
      )
        return;
      executionState.preflighting.add(node.id);
      try {
        if (node.data?.plugin === 'instagram' && !(await instagramPreflight())) return;
        await performActorJob({
          pid: workspaceState.project.id,
          id: node.id,
          label: actorTitle(node)
        });
      } finally {
        executionState.preflighting.delete(node.id);
        await syncActorJobs().catch(() => {});
        if (workspaceState.project) inspect();
      }
    }
    async function syncActorJobs() {
      const data = await api('/api/jobs');
      executionState.vpnWaiting = Boolean(data.vpn_waiting);
      executionState.actorQueue = data.jobs
        .filter((job) => job.state === 'queued')
        .map((job) => ({ ...job, id: job.actor_id, pid: job.project_id, serverId: job.id }));
      executionState.activeActors = new Set(
        data.jobs.filter((job) => job.state !== 'queued').map((job) => job.actor_id)
      );
      const active = data.jobs.find((job) => job.state !== 'queued');
      executionState.currentActorJob = active
        ? { ...active, id: active.actor_id, pid: active.project_id, serverId: active.id }
        : null;
      executionState.queueRunning = Boolean(active);
      updateStatus();
    }
    async function cancelCurrentActor() {
      if (executionState.currentActorJob?.serverId)
        await api('/api/jobs/' + executionState.currentActorJob.serverId + '/cancel', {});
      await syncActorJobs();
    }
    function pendingJobIds() {
      try {
        const ids = JSON.parse(localStorage.getItem('argus.jobs') || '[]');
        return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
      } catch {
        return [];
      }
    }
    function startJobMonitor() {
      for (const id of pendingJobIds())
        pollJob(id)
          .then(async (job) => {
            localStorage.setItem(
              'argus.jobs',
              JSON.stringify(pendingJobIds().filter((item) => item !== id))
            );
            if (workspaceState.project?.id === job.project_id) {
              await reconcileWorkspace(workspaceState.lastServerSnapshot);
              render();
              inspect();
            }
          })
          .catch((error) => toast(error.message));
      syncActorJobs().catch(() => {});
      const monitor = async () => {
        try {
          if (!document.hidden) await syncActorJobs();
        } catch {
          /* Retry later. */
        }
        setTimeout(
          monitor,
          executionState.queueRunning || executionState.actorQueue.length ? 2000 : 15000
        );
      };
      setTimeout(monitor, 15000);
    }
    async function performActorJob(job) {
      let transient = {};
      if (workspaceState.project?.id === job.pid) await save();
      let current =
        workspaceState.project?.id === job.pid
          ? workspaceState.project
          : await api('/api/projects/' + job.pid);
      let node = current.document.nodes.find((n) => n.id === job.id && n.type === 'actor');
      if (!node) return;
      const action = pluginsState.catalog
        .find((p) => p.id === node.data.plugin)
        ?.actions.find((a) => a.id === node.data.action);
      if (action?.input_prompt) {
        const values = await parameterModal(action.input_prompt, node.data.params || {});
        if (values === null) return;
        const temporary = new Set(
          (action.input_prompt.fields || [])
            .filter((field) => field.transient)
            .map((field) => field.key)
        );
        transient = Object.fromEntries(
          Object.entries(values).filter(([key]) => temporary.has(key))
        );
        node.data.params = {
          ...node.data.params,
          ...Object.fromEntries(Object.entries(values).filter(([key]) => !temporary.has(key)))
        };
        await persistActorParameters(job, current, node);
      }
      for (let attempt = 0; attempt < 4; attempt++) {
        current =
          workspaceState.project?.id === job.pid
            ? workspaceState.project
            : await api('/api/projects/' + job.pid);
        node = current.document.nodes.find((n) => n.id === job.id && n.type === 'actor');
        if (!node) return;
        if (workspaceState.project?.id === job.pid) await save();
        const base = structuredClone(current.document),
          body = {
            actor_id: node.id,
            revision: current.revision,
            ...(Object.keys(transient).length
              ? {
                  transient
                }
              : {})
          };
        if (node.data.plugin === 'transform') {
          try {
            body.outputs = await transform(node, current.document);
          } catch (error) {
            body.browser_error = error.message;
          }
        }
        body.request_key = Array.from(crypto.getRandomValues(new Uint8Array(24)), (n) =>
          n.toString(16).padStart(2, '0')
        ).join('');
        const submitted = await api('/api/projects/' + job.pid + '/run', body);
        job.serverId = submitted.id;
        const pending = pendingJobIds();
        if (!pending.includes(submitted.id))
          localStorage.setItem('argus.jobs', JSON.stringify([...pending, submitted.id]));
        const terminal = await pollJob(submitted.id, () => syncActorJobs().catch(() => {}));
        localStorage.setItem(
          'argus.jobs',
          JSON.stringify(pendingJobIds().filter((id) => id !== submitted.id))
        );
        await syncActorJobs();
        const finished = await api('/api/projects/' + job.pid);
        if (workspaceState.project?.id === job.pid) {
          await reconcileWorkspace(base);
          render();
          inspect();
        }
        if (terminal.state !== 'completed') {
          if (terminal.state !== 'cancelled')
            throw Error(t('errors.' + (terminal.error_code || 'execution_interrupted')));
          return;
        }
        const last = finished.document.runs.find((run2) => run2.id === terminal.run_id);
        if (last?.input_request) {
          const values = await parameterModal(last.input_request, node.data.params || {});
          if (values === null) {
            await cancelActorRun(job.pid, last.id);
            return;
          }
          current = workspaceState.project?.id === job.pid ? workspaceState.project : finished;
          node = current.document.nodes.find((n) => n.id === job.id);
          if (!node) return;
          const temporary = new Set(
            (last.input_request.fields || [])
              .filter((field) => field.transient)
              .map((field) => field.key)
          );
          transient = Object.fromEntries(
            Object.entries(values).filter(([key]) => temporary.has(key))
          );
          node.data.params = {
            ...node.data.params,
            ...Object.fromEntries(Object.entries(values).filter(([key]) => !temporary.has(key)))
          };
          await persistActorParameters(job, current, node);
          continue;
        }
        if (last?.candidates?.some((c) => !c.chosen)) await handleManualChoices(job.pid, last);
        toast(last?.status === 'failed' ? diagnostic(last.error) : t('Aktion abgeschlossen.'));
        return;
      }
      throw Error(t('Zu viele aufeinanderfolgende Eingabeanforderungen.'));
    }
    async function persistActorParameters(job, current, node) {
      if (workspaceState.project?.id === job.pid) {
        change(node.id);
        await save();
      } else
        await api('/api/projects/' + job.pid, {
          title: current.title,
          document: current.document,
          revision: current.revision
        });
    }
    async function cancelActorRun(pid, runId) {
      if (workspaceState.project?.id === pid) await save();
      const current =
          workspaceState.project?.id === pid
            ? workspaceState.project
            : await api('/api/projects/' + pid),
        base = structuredClone(current.document);
      await api('/api/projects/' + pid + '/cancel-run', {
        revision: current.revision,
        run_id: runId
      });
      if (workspaceState.project?.id === pid) {
        await reconcileWorkspace(base);
        change();
        render();
        inspect();
      }
    }
    async function handleManualChoices(pid, run2) {
      for (const choice of run2.candidates || []) {
        if (choice.chosen || choice.cancelled || run2.status === 'cancelled') continue;
        const value = await modalChoice(
          t('Adresse ausw\xE4hlen'),
          t('Bitte die passende Ortsangabe ausw\xE4hlen.'),
          choice.options.map((option, index) => ({
            label:
              (option.formatted_address || option.locality || option.country || String(index + 1)) +
              ' \xB7 ' +
              (option.provider || ''),
            value: index
          }))
        );
        if (value === null) {
          await cancelActorRun(pid, run2.id);
          return;
        }
        if (workspaceState.project?.id === pid) await save();
        const current =
            workspaceState.project?.id === pid
              ? workspaceState.project
              : await api('/api/projects/' + pid),
          base = structuredClone(current.document);
        await api('/api/projects/' + pid + '/location-choice', {
          revision: current.revision,
          run_id: run2.id,
          input_id: choice.input_id,
          index: value
        });
        if (workspaceState.project?.id === pid) {
          await reconcileWorkspace(base);
          change();
          render();
          inspect();
        }
        choice.chosen = true;
      }
    }
    async function instagramPreflight() {
      if (!workspaceState.project) return false;
      const plugin = pluginsState.catalog.find((p) => p.id === 'instagram'),
        params = plugin?.actions?.[0]?.default_params || {};
      if (
        params.sessionid ||
        (params.login_username && params.login_password) ||
        workspaceState.project.document.preferences?.instagram_anonymous_notice_dismissed
      )
        return true;
      const pid = workspaceState.project.id,
        result = await ui_default.notice({
          title: t('Instagram ohne Anmeldung'),
          message: t(
            'Ohne Instagram-Zugangsdaten sind m\xF6glicherweise nicht alle Ergebnisse verf\xFCgbar. Du kannst fortfahren oder Zugangsdaten in den Plugin-Einstellungen hinterlegen.'
          ),
          checkboxText: t('F\xFCr dieses Projekt nicht mehr anzeigen'),
          actions: [
            {
              id: 'settings',
              label: t('Plugin-Einstellungen')
            },
            {
              id: 'continue',
              label: t('Ohne Anmeldung fortfahren'),
              primary: true
            }
          ]
        });
      if (!result || workspaceState.project?.id !== pid) return false;
      if (result.checked) {
        workspaceState.project.document.preferences = {
          ...workspaceState.project.document.preferences,
          instagram_anonymous_notice_dismissed: true
        };
        change();
        await save();
      }
      if (result.action === 'settings') {
        await openPluginSettings('instagram');
        return false;
      }
      return result.action === 'continue';
    }
    return {
      syncActorJobs,
      cancelCurrentActor,
      startJobMonitor,
      transform,
      run,
      performActorJob,
      persistActorParameters,
      cancelActorRun,
      handleManualChoices,
      instagramPreflight
    };
  }
};
export { actors_default };
export default actors_default;
