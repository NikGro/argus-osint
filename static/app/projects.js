var projects_default = {
  name: 'projects',
  dependencies: [
    'api',
    'inspect',
    'panelVisibility',
    'projectSnapshot',
    'render',
    'save',
    'show',
    'updateStatus'
  ],
  create({
    libraryState,
    persistenceState,
    workspaceState,
    selectionState,
    canvasState,
    historyState,
    api,
    inspect,
    panelVisibility,
    projectSnapshot,
    render,
    save,
    show,
    updateStatus
  }) {
    async function openProject(id) {
      workspaceState.project = await api('/api/projects/' + id);
      selectionState.selected.clear();
      selectionState.selectedEdges.clear();
      persistenceState.dirtyNodes.clear();
      persistenceState.saveError = '';
      persistenceState.dirty = false;
      canvasState.pan = {
        x: 60,
        y: 70,
        scale: 1
      };
      show('workspace');
      selectionState.inspectorSelectionKey = '';
      canvasState.rightCollapsed = true;
      panelVisibility();
      updateStatus();
      workspaceState.lastServerSnapshot = structuredClone(workspaceState.project.document);
      workspaceState.lastServerTitle = workspaceState.project.title;
      historyState.lastSnapshot = projectSnapshot();
      historyState.undoStack = [];
      historyState.redoStack = [];
      render();
      inspect();
    }
    async function leaveWorkspace() {
      if (persistenceState.dirty) await save();
      clearTimeout(persistenceState.autosaveTimer);
      workspaceState.project = null;
      persistenceState.dirty = false;
      selectionState.selectedGroup = null;
      selectionState.selected.clear();
    }
    return { openProject, leaveWorkspace };
  }
};
export { projects_default };
export default projects_default;
