import { t } from '../i18n.js';
var bindings_workspace_default = {
  name: 'bindWorkspace',
  dependencies: [
    '$',
    'applyHistory',
    'arrangeProject',
    'bind',
    'cancelConnection',
    'centerProject',
    'change',
    'parameterModal',
    'createGroupFromSelection',
    'deleteSelection',
    'deleteSelectionWithChildren',
    'detachNodes',
    'dissolveSelectedGroups',
    'inspect',
    'panelVisibility',
    'render',
    'save',
    'setAllGroups',
    'setupPaletteControls',
    'show',
    'toast',
    'zoomAt',
    'zoomStep'
  ],
  create({
    canvasState,
    selectionState,
    workspaceState,
    $,
    applyHistory,
    arrangeProject,
    bind,
    cancelConnection,
    centerProject,
    change,
    parameterModal,
    createGroupFromSelection,
    deleteSelection,
    deleteSelectionWithChildren,
    detachNodes,
    dissolveSelectedGroups,
    inspect,
    panelVisibility,
    render,
    save,
    setAllGroups,
    setupPaletteControls,
    show,
    toast,
    zoomAt,
    zoomStep
  }) {
    function bindWorkspace() {
      for (const b of document.querySelectorAll('[data-layout]'))
        b.addEventListener('click', () => arrangeProject(b.dataset.layout));
      $('zoomLevel').addEventListener('change', () => {
        const percent = Number($('zoomLevel').value.trim().replace(/%$/, ''));
        if (!Number.isFinite(percent) || percent < 15 || percent > 250) {
          $('zoomLevel').value = Math.round(canvasState.pan.scale * 100) + '%';
          toast(t('Zoom muss zwischen 15 und 250 Prozent liegen.'));
          return;
        }
        const box = $('graph').getBoundingClientRect();
        zoomAt(box.width / 2, box.height / 2, percent / 100);
      });
      $('zoomLevel').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          $('zoomLevel').blur();
        }
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && canvasState.connecting) {
          e.preventDefault();
          cancelConnection();
        }
      });
      bind('zoomIn', () => zoomStep(1));
      bind('zoomOut', () => zoomStep(-1));
      bind('toggleLeft', () => {
        canvasState.leftCollapsed = !canvasState.leftCollapsed;
        panelVisibility();
        try {
          localStorage.setItem('argus.leftCollapsed', String(canvasState.leftCollapsed));
        } catch {}
      });
      bind('toggleRight', () => {
        if (!selectionState.inspectorSelectionKey) return;
        canvasState.rightCollapsed = !canvasState.rightCollapsed;
        panelVisibility();
      });
      try {
        canvasState.leftCollapsed = localStorage.getItem('argus.leftCollapsed') === 'true';
      } catch {}
      panelVisibility();
      bind('undo', () => applyHistory('undo'));
      bind('redo', () => applyHistory('redo'));
      bind('report', async () => {
        await save();
        $('reportFrame').src = '/api/projects/' + workspaceState.project.id + '/report';
        show('reportView');
      });
      bind('reportBack', () => {
        show('workspace');
        render();
        inspect();
      });
      bind('expandAllGroups', () => setAllGroups(false));
      bind('collapseAllGroups', () => setAllGroups(true));
      bind('groupNodes', createGroupFromSelection);
      bind('ungroupNodes', dissolveSelectedGroups);
      bind('detachNodes', () => detachNodes([...selectionState.selected]));
      bind('deleteSelected', deleteSelection);
      bind('deleteDescendants', deleteSelectionWithChildren);
      setupPaletteControls();
      bind('fit', centerProject);
      bind('editProjectTitle', async () => {
        const result = await parameterModal(
          {
            title: 'Projekttitel bearbeiten',
            fields: [{ key: 'title', label: 'Projekttitel', required: true, maxLength: 200 }]
          },
          { title: workspaceState.project.title }
        );
        if (!result?.title?.trim()) return;
        workspaceState.project.title = result.title.trim().slice(0, 200);
        $('projectTitle').textContent = workspaceState.project.title;
        change();
      });
    }
    return { bindWorkspace };
  }
};
export { bindings_workspace_default };
export default bindings_workspace_default;
