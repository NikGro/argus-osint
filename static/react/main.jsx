import React, { memo, useEffect, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { createController } from './controller.js';
import { Button, Field, Icon, Modal } from './ui/index.jsx';
import { Workspace } from './workspace.jsx';
import { Plugins } from './plugins.jsx';
import { Settings, LogViewer } from './settings.jsx';
import { t, language, setLanguage } from '../i18n.js';
import { pollJob } from '../jobs-client.js';
import { VERSION } from '../version.js';

export const app = createController();
const StableWorkspace = memo(Workspace);
const StablePlugins = memo(Plugins);
const StableSettings = memo(Settings);
const StableHome = memo(Home);

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <main className="intro">
        <h1>ARGUS</h1>
        <p role="alert">{this.state.error.message}</p>
        <Button onClick={() => location.reload()}>{t('Neu laden')}</Button>
      </main>
    ) : (
      this.props.children
    );
  }
}
function Application() {
  const revision = useSyncExternalStore(app.subscribe, app.snapshot);
  const { commands: c, state: s, ui } = app;
  ui.visited ??= new Set();
  ui.visited.add(ui.view);
  useEffect(() => {
    let stopped = false,
      monitor,
      health;
    const sync = async () => {
      if (stopped) return;
      try {
        if (!document.hidden) await c.syncActorJobs();
      } catch {
        /* Retry on the next bounded poll. */
      }
      if (!stopped)
        monitor = setTimeout(
          sync,
          s.executionState.queueRunning || s.executionState.actorQueue.length ? 2000 : 15000
        );
    };
    app.safely(async () => {
      const data = await c.api('/api/settings');
      s.preferencesState.appSettings = data.settings;
      ui.languages = data.languages;
      await setLanguage(data.settings.language);
      await c.refreshCatalog();
      await c.home();
      ui.ready = true;
      app.redraw();
      for (const id of JSON.parse(localStorage.getItem('argus.jobs') || '[]')) {
        pollJob(id)
          .then(async (job) => {
            localStorage.setItem(
              'argus.jobs',
              JSON.stringify(
                JSON.parse(localStorage.getItem('argus.jobs') || '[]').filter(
                  (value) => value !== id
                )
              )
            );
            if (s.workspaceState.project?.id === job.project_id) {
              await c.reconcileWorkspace(s.workspaceState.lastServerSnapshot);
              c.render();
            }
          })
          .catch((error) => c.toast(error.message));
      }
      sync();
      await c.checkBackend();
      health = setInterval(c.checkBackend, 20000);
    });
    function beforeUnload(event) {
      if (
        s.persistenceState.dirty ||
        s.pluginsState.pendingPluginDirty.size ||
        s.preferencesState.settingsDirty
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    function key(event) {
      if (
        !s.workspaceState.project ||
        app.ui.view !== 'workspace' ||
        c.textEditing(event.target) ||
        document.querySelector('dialog[open]')
      )
        return;
      if (event.key === 'Escape') {
        c.cancelConnection();
        return;
      }
      if (event.key === 'Delete') {
        event.preventDefault();
        c.deleteSelection();
      }
      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === 'a') {
          event.preventDefault();
          s.selectionState.selected = new Set(
            s.workspaceState.project.document.nodes.map((node) => node.id)
          );
          c.inspect();
          c.render();
        }
        if (['z', 'y'].includes(event.key.toLowerCase())) {
          event.preventDefault();
          c.applyHistory(event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo');
        }
      }
    }
    const copy = (event) => c.copyGraph(event),
      paste = (event) => app.safely(() => c.pasteGraph(event));
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('keydown', key);
    window.addEventListener('copy', copy);
    window.addEventListener('paste', paste);
    return () => {
      stopped = true;
      clearTimeout(monitor);
      clearInterval(health);
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('keydown', key);
      window.removeEventListener('copy', copy);
      window.removeEventListener('paste', paste);
    };
  }, []);
  const saving =
    s.persistenceState.savePromise ||
    s.preferencesState.settingsPromise ||
    s.pluginsState.pendingPluginSaves.size;
  const error =
    s.persistenceState.saveError ||
    s.preferencesState.settingsError ||
    [...(ui.pluginSaveErrors?.values() || [])].find(Boolean);
  const pending =
    s.persistenceState.dirty ||
    s.preferencesState.settingsDirty ||
    s.pluginsState.pendingPluginDirty.size;
  const connected = s.shellState.backendOnline;
  const status = error
    ? t('Speichern fehlgeschlagen')
    : saving
      ? t('Speichert …')
      : pending
        ? t('Noch zu speichern')
        : !connected
          ? t('Backend nicht erreichbar')
          : ['workspace', 'settingsView', 'pluginsView'].includes(ui.view)
            ? t('Gespeichert')
            : t('Verbunden');
  return (
    <>
      <header>
        <div className="brand">
          <Button id="brandHome" app={app} onClick={c.home}>
            <img className="brand-logo" src="/argus-logo.svg" alt="" /> ARGUS
          </Button>
          <span className="brand-version">Workbench · v{VERSION}</span>
        </div>
        <div id="projectHeading" hidden={ui.view !== 'workspace'}>
          <h1 id="projectTitle">{s.workspaceState.project?.title || ''}</h1>
          <Button
            app={app}
            id="editProjectTitle"
            icon="edit"
            only
            className="icon-text"
            onClick={async () => {
              const title = await c.askText(
                t('Projekttitel bearbeiten'),
                t('Projekttitel'),
                s.workspaceState.project.title
              );
              if (title?.trim()) {
                s.workspaceState.project.title = title.trim().slice(0, 200);
                app.emit();
                c.change();
              }
            }}
          >
            {t('Projekttitel bearbeiten')}
          </Button>
        </div>
        <nav hidden={ui.view === 'workspace'}>
          <Button
            app={app}
            id="projectsTab"
            icon="file"
            className={ui.view === 'home' ? 'active' : ''}
            onClick={c.home}
          >
            {t('Projekte')}
          </Button>
          <Button
            app={app}
            id="pluginsTab"
            icon="plugin"
            className={ui.view === 'pluginsView' ? 'active' : ''}
            onClick={c.pluginsHome}
          >
            {t('Plugins')}
          </Button>
        </nav>
        {ui.view !== 'workspace' && (
          <Button
            app={app}
            id="settingsTab"
            className="settings-navigation"
            icon="settings"
            only
            onClick={c.settingsHome}
          >
            {t('Einstellungen')}
          </Button>
        )}
        <span id="status" role="status" title={error || status}>
          <span id="statusText">
            <span className="status-measure" aria-hidden="true">
              {ui.view === 'workspace' ? t('Gespeichert') : status}
            </span>
            <span className="status-current">{status}</span>
          </span>
          <i
            id="statusLight"
            data-state={
              error || connected === false
                ? 'red'
                : saving || pending || connected === null
                  ? 'yellow'
                  : 'green'
            }
          />
        </span>
      </header>
      {!ui.ready && (
        <p className="loading-state" role="status">
          {t('Lädt …')}
        </p>
      )}
      <StableHome app={app} revision={ui.view === 'home' ? revision : -1} />
      <StableWorkspace app={app} revision={ui.view === 'workspace' ? revision : -1} />
      {ui.visited.has('pluginsView') && (
        <StablePlugins app={app} revision={ui.view === 'pluginsView' ? revision : -1} />
      )}
      {ui.visited.has('settingsView') && (
        <StableSettings app={app} revision={ui.view === 'settingsView' ? revision : -1} />
      )}
      <main id="logsView" hidden={ui.view !== 'logsView'}>
        {ui.view === 'logsView' && s.workspaceState.project && <LogViewer app={app} project />}
      </main>
      <main id="reportView" hidden={ui.view !== 'reportView'}>
        <Button onClick={() => c.show('workspace')}>{t('Zurück')}</Button>
        {ui.view === 'reportView' && s.workspaceState.project && (
          <iframe
            id="reportFrame"
            title={t('Report')}
            src={'/api/projects/' + s.workspaceState.project.id + '/report'}
          />
        )}
      </main>
      <Modal app={app} />
      {ui.message && (
        <div id="toast" role="status">
          {t(ui.message)}
        </div>
      )}
    </>
  );
}
function Home({ app }) {
  const { commands: c, state: s } = app;
  const library = s.libraryState;
  const visible = library.projectIndex.filter(
    (project) =>
      Boolean(project.archived_at) === (library.homeMode === 'archive') &&
      project.title.toLowerCase().includes(library.homeQueries[library.homeMode].toLowerCase())
  );
  return (
    <main id="home" hidden={app.ui.view !== 'home'}>
      <div className="intro">
        <h1>
          {t('Informationen verbinden.')}
          <br />
          {t('Erkenntnisse bewahren.')}
        </h1>
        <p>{t('Ein Graph für Daten, Rechercheaktionen und nachvollziehbare Ergebnisse.')}</p>
        <Button
          app={app}
          id="newProject"
          className="primary"
          icon="plus"
          onClick={async () => {
            const title = await c.askText(t('Projekt erstellen'), t('Projekttitel'), '');
            if (!title?.trim()) return;
            const project = await c.api('/api/projects', { title: title.trim() });
            await c.openProject(project.id);
          }}
        >
          {t('Projekt erstellen')}
        </Button>
      </div>
      <section className="home-tools">
        <div className="home-tabs">
          <Button
            icon="folder"
            className={library.homeMode === 'active' ? 'active' : ''}
            onClick={() => {
              library.homeMode = 'active';
              app.redraw();
            }}
          >
            {t('Aktive Projekte')}
          </Button>
          <Button
            icon="archive"
            className={library.homeMode === 'archive' ? 'active' : ''}
            onClick={() => {
              library.homeMode = 'archive';
              app.redraw();
            }}
          >
            {t('Archiv')}
          </Button>
        </div>
        <input
          type="search"
          placeholder={t('Projekte suchen …')}
          value={library.homeQueries[library.homeMode]}
          onChange={(event) => {
            library.homeQueries[library.homeMode] = event.target.value;
            app.redraw();
          }}
        />
        <span>
          {visible.length} {t('Projekte')}
        </span>
      </section>
      <div id="projectList" className="tiles">
        {visible.map((project) => (
          <article key={project.id} className="tile project-tile" data-project={project.id}>
            <small>
              {new Date(project.archived_at || project.updated_at).toLocaleString(language)}
            </small>
            <h2 title={project.title}>{project.title}</h2>
            <p className="project-kind">
              {t(project.archived_at ? 'Archiviert' : 'Aktives Projekt')}
            </p>
            <div className="tile-actions">
              <Button
                app={app}
                className="primary"
                icon={project.archived_at ? 'restore' : 'file'}
                onClick={() =>
                  project.archived_at ? c.setArchived(project, false) : c.openProject(project.id)
                }
              >
                {t(project.archived_at ? 'Wiederherstellen' : 'Öffnen')}
              </Button>
              <Button
                app={app}
                icon="edit"
                only
                onClick={async () => {
                  const title = await c.askText(
                    t('Projekttitel bearbeiten'),
                    t('Projekttitel'),
                    project.title
                  );
                  if (title?.trim()) {
                    await c.api('/api/projects/' + project.id + '/rename', {
                      title: title.trim(),
                      revision: project.revision
                    });
                    library.projectIndex = await c.api('/api/projects');
                    app.redraw();
                  }
                }}
              >
                {t('Titel bearbeiten')}
              </Button>
              <Button
                app={app}
                className={
                  'card-end-action ' + (project.archived_at ? 'danger-filled' : 'archive-action')
                }
                only
                icon={project.archived_at ? 'trash' : 'archive'}
                onClick={() =>
                  project.archived_at ? c.deleteProject(project) : c.setArchived(project, true)
                }
              >
                {t(project.archived_at ? 'Löschen' : 'Archivieren')}
              </Button>
            </div>
          </article>
        ))}
        {!visible.length && (
          <p className="empty-state">{t('Keine passenden Projekte gefunden.')}</p>
        )}
      </div>
    </main>
  );
}
export function mountApplication(element) {
  const root = createRoot(element);
  root.render(
    <ErrorBoundary>
      <Application />
    </ErrorBoundary>
  );
  return () => root.unmount();
}
if (
  typeof document !== 'undefined' &&
  !globalThis.ARGUS_TEST_MODE &&
  !globalThis.ARGUS_MOBILE_BLOCKED
)
  mountApplication(document.getElementById('app'));

// Preserve public command exports for development and compatibility checks.
export * from '../main.js';
