var persistence_default = {
  name: 'persistence',
  dependencies: ['api', 'recordHistory', 'toast', 'updateStatus'],
  create({
    persistenceState,
    workspaceState,
    canvasState,
    api,
    recordHistory,
    toast,
    updateStatus
  }) {
    function keepNodeReferences(previous, canonical) {
      for (const collection of ['nodes', 'groups']) {
        const existing = new Map((previous[collection] || []).map((item) => [item.id, item]));
        canonical[collection] = (canonical[collection] || []).map((remote) => {
          const local = existing.get(remote.id);
          if (!local) return remote;
          for (const key of Object.keys(local)) if (!(key in remote)) delete local[key];
          Object.assign(local, remote);
          return local;
        });
      }
      return canonical;
    }
    function change(nodeId, scope) {
      if (workspaceState.project?.archived_at) {
        workspaceState.project.document = structuredClone(workspaceState.lastServerSnapshot);
        toast('Archiviertes Projekt: zum Bearbeiten wiederherstellen.');
        return;
      }
      canvasState.groupBoundsCache = null;
      recordHistory(scope || nodeId);
      persistenceState.changeVersion++;
      persistenceState.dirty = true;
      if (nodeId) persistenceState.dirtyNodes.add(nodeId);
      updateStatus();
      clearTimeout(persistenceState.autosaveTimer);
      if (workspaceState.project)
        persistenceState.autosaveTimer = setTimeout(
          () => save().catch((error) => toast(error.message)),
          700
        );
    }
    async function reconcileWorkspace(base) {
      const current = workspaceState.project;
      if (!current) return false;
      for (let attempt = 0; attempt < 4; attempt++) {
        const version = persistenceState.changeVersion;
        const response = await api('/api/projects/' + current.id + '/reconcile', {
          base,
          local: structuredClone(current.document),
          base_title: workspaceState.lastServerTitle,
          title: current.title
        });
        if (workspaceState.project !== current) return false;
        if (version !== persistenceState.changeVersion) continue;
        const titleUnchanged = current.title === workspaceState.lastServerTitle;
        current.document = keepNodeReferences(current.document, response.document);
        current.revision = response.revision;
        if (titleUnchanged) {
          current.title = response.title;
        }
        workspaceState.lastServerSnapshot = structuredClone(response.server_document);
        workspaceState.lastServerTitle = response.server_title;
        persistenceState.dirty = response.has_local_changes;
        return true;
      }
      persistenceState.dirty = true;
      return false;
    }
    async function save() {
      if (!workspaceState.project || workspaceState.project.archived_at)
        return workspaceState.project;
      if (persistenceState.savePromise) return persistenceState.savePromise;
      if (!persistenceState.dirty) return workspaceState.project;
      clearTimeout(persistenceState.autosaveTimer);
      const current = workspaceState.project,
        version = persistenceState.changeVersion;
      const sent = structuredClone(current.document);
      const payload = {
        base: structuredClone(workspaceState.lastServerSnapshot || sent),
        local: sent,
        title: current.title,
        base_title: workspaceState.lastServerTitle,
        persist: true
      };
      persistenceState.saveError = '';
      persistenceState.savePromise = api('/api/projects/' + current.id + '/reconcile', payload)
        .then(async (saved) => {
          if (workspaceState.project !== current) return saved;
          if (version === persistenceState.changeVersion) {
            // Open detail controls hold node references. Reconcile canonical values without
            // orphaning those controls after an autosave response.
            current.document = keepNodeReferences(current.document, saved.document);
            current.revision = saved.revision;
            current.title = saved.title;
            workspaceState.lastServerSnapshot = structuredClone(saved.document);
            workspaceState.lastServerTitle = saved.title;
            persistenceState.dirty = false;
            persistenceState.dirtyNodes.clear();
          } else await reconcileWorkspace(sent);
          return saved;
        })
        .catch((error) => {
          persistenceState.saveError = error.message;
          persistenceState.dirty = true;
          throw error;
        })
        .finally(() => {
          persistenceState.savePromise = null;
          updateStatus();
          if (persistenceState.dirty)
            persistenceState.autosaveTimer = setTimeout(
              () => save().catch((error) => toast(error.message)),
              persistenceState.saveError ? 5e3 : 300
            );
        });
      updateStatus();
      return persistenceState.savePromise;
    }
    return { change, save, reconcileWorkspace };
  }
};
export { persistence_default };
export default persistence_default;
