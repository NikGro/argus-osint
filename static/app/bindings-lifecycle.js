import { setupWorkspaceLayout } from '../workspace-layout.js';
var bindings_lifecycle_default = {
  name: 'bindLifecycle',
  dependencies: [
    '$',
    'bind',
    'bootstrap',
    'cancelCurrentActor',
    'clearLogs',
    'draggableDialog',
    'exportLogs',
    'finishDialog',
    'openLogs',
    'renderLogs',
    'resizePaletteSplit',
    'show',
    'toast'
  ],
  create({
    persistenceState,
    preferencesState,
    pluginsState,
    executionState,
    $,
    bind,
    bootstrap,
    cancelCurrentActor,
    clearLogs,
    draggableDialog,
    exportLogs,
    finishDialog,
    openLogs,
    renderLogs,
    resizePaletteSplit,
    show,
    toast
  }) {
    function bindLifecycle() {
      setupWorkspaceLayout();
      $('inputDialogCancel').addEventListener('click', () => finishDialog(false));
      $('inputDialogForm').addEventListener('submit', (e) => {
        e.preventDefault();
        finishDialog(true);
      });
      $('inputDialog').addEventListener('cancel', (e) => {
        e.preventDefault();
        finishDialog(false);
      });
      draggableDialog($('inputDialog'));
      draggableDialog($('projectDialog'));
      window.addEventListener('beforeunload', (e) => {
        if (
          persistenceState.dirty ||
          preferencesState.settingsDirty ||
          pluginsState.pendingPluginDirty.size ||
          pluginsState.pendingPluginSaves.size ||
          executionState.queueRunning
        ) {
          e.preventDefault();
          e.returnValue = '';
        }
      });
      new ResizeObserver(() =>
        document.documentElement.style.setProperty(
          '--toolbar-height',
          document.querySelector('.toolbar').getBoundingClientRect().height + 'px'
        )
      ).observe(document.querySelector('.toolbar'));
      bootstrap().catch((e) => toast(e.message));
      bind('logs', openLogs);
      bind('logsBack', () => show('workspace'));
      bind('logsExport', exportLogs);
      bind('logsClear', clearLogs);
      bind('logsMore', () => renderLogs(true));
      bind('cancelActor', cancelCurrentActor);
      $('logsSearch').addEventListener('input', () =>
        renderLogs().catch((error) => toast(error.message))
      );
      resizePaletteSplit();
    }
    return { bindLifecycle };
  }
};
export { bindings_lifecycle_default };
export default bindings_lifecycle_default;
