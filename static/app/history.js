var history_default = {
  name: 'history',
  dependencies: ['$', 'change', 'inspect', 'render'],
  create({
    workspaceState,
    persistenceState,
    historyState,
    selectionState,
    $,
    change,
    inspect,
    render
  }) {
    function projectSnapshot() {
      return workspaceState.project
        ? {
            title: workspaceState.project.title,
            document: structuredClone(workspaceState.project.document)
          }
        : null;
    }
    function historyButtons() {
      if ($('undo'))
        $('undo').disabled = persistenceState.busy || historyState.undoStack.length === 0;
      if ($('redo'))
        $('redo').disabled = persistenceState.busy || historyState.redoStack.length === 0;
    }
    function recordHistory(scope) {
      if (!workspaceState.project || historyState.historyMuted) return;
      const snapshot = projectSnapshot(),
        at = Date.now();
      if (
        historyState.lastSnapshot &&
        JSON.stringify(snapshot) !== JSON.stringify(historyState.lastSnapshot)
      ) {
        if (
          !(
            scope &&
            historyState.lastHistoryScope === scope &&
            at - historyState.lastHistoryAt < 700
          )
        )
          historyState.undoStack.push(historyState.lastSnapshot);
        if (historyState.undoStack.length > 60) historyState.undoStack.shift();
        historyState.redoStack = [];
        historyState.lastSnapshot = snapshot;
        historyState.lastHistoryScope = scope;
        historyState.lastHistoryAt = at;
      } else if (!historyState.lastSnapshot) historyState.lastSnapshot = snapshot;
      historyButtons();
    }
    function applyHistory(direction) {
      if (!workspaceState.project || persistenceState.busy) return;
      const from = direction === 'undo' ? historyState.undoStack : historyState.redoStack,
        to = direction === 'undo' ? historyState.redoStack : historyState.undoStack;
      if (!from.length) return;
      to.push(projectSnapshot());
      const restored = from.pop();
      historyState.historyMuted = true;
      workspaceState.project.title = restored.title;
      workspaceState.project.document = structuredClone(restored.document);
      $('projectTitle').textContent = workspaceState.project.title;
      selectionState.selected.clear();
      selectionState.selectedEdges.clear();
      selectionState.selectedGroup = null;
      for (const node of workspaceState.project.document.nodes)
        persistenceState.dirtyNodes.add(node.id);
      historyState.lastSnapshot = projectSnapshot();
      historyState.lastHistoryAt = 0;
      change();
      historyState.historyMuted = false;
      render();
      inspect();
      historyButtons();
    }
    return { projectSnapshot, historyButtons, recordHistory, applyHistory };
  }
};
export { history_default };
export default history_default;
