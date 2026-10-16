var bindings_shortcuts_default = {
  name: 'bindShortcuts',
  dependencies: [
    '$',
    'applyHistory',
    'copyGraph',
    'deleteSelection',
    'graphClipboardText',
    'inspect',
    'pasteGraph',
    'render',
    'textEditing'
  ],
  create({
    workspaceState,
    selectionState,
    historyState,
    persistenceState,
    $,
    applyHistory,
    copyGraph,
    deleteSelection,
    graphClipboardText,
    inspect,
    pasteGraph,
    render,
    textEditing
  }) {
    function bindShortcuts() {
      window.addEventListener('copy', copyGraph);
      window.addEventListener('paste', pasteGraph);
      window.addEventListener('keydown', (e) => {
        if (
          (e.ctrlKey || e.metaKey) &&
          !textEditing(e.target) &&
          !document.querySelector('dialog[open]') &&
          workspaceState.project &&
          !$('workspace').hidden
        ) {
          if (e.key.toLowerCase() === 'a') {
            e.preventDefault();
            selectionState.selectedEdges.clear();
            selectionState.selected = new Set(
              workspaceState.project.document.nodes.map((n) => n.id)
            );
            render();
            inspect();
            return;
          }
          if (e.key.toLowerCase() === 'c') {
            historyState.internalClipboard = graphClipboardText();
          }
          if (e.key.toLowerCase() === 'v' && historyState.internalClipboard) {
            clearTimeout(historyState.pendingClipboardPaste);
            historyState.pendingClipboardPaste = setTimeout(
              () =>
                pasteGraph({
                  target: e.target,
                  clipboardData: {
                    getData: () => historyState.internalClipboard
                  },
                  preventDefault() {}
                }),
              150
            );
          }
          if (e.key.toLowerCase() === 'z') {
            e.preventDefault();
            applyHistory(e.shiftKey ? 'redo' : 'undo');
            return;
          }
          if (e.key.toLowerCase() === 'y') {
            e.preventDefault();
            applyHistory('redo');
            return;
          }
        }
        if (
          e.key !== 'Delete' ||
          !workspaceState.project ||
          persistenceState.busy ||
          $('workspace').hidden ||
          textEditing(e.target) ||
          document.querySelector('dialog[open]')
        )
          return;
        e.preventDefault();
        deleteSelection();
      });
    }
    return { bindShortcuts };
  }
};
export { bindings_shortcuts_default };
export default bindings_shortcuts_default;
