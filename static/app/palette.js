import { t } from '../i18n.js';
var palette_default = {
  name: 'palette',
  dependencies: [
    '$',
    'addActor',
    'addData',
    'dropFiles',
    'providerSearchKey',
    'render',
    'selectedData',
    'toast'
  ],
  create({
    libraryState,
    workspaceState,
    pluginsState,
    persistenceState,
    selectionState,
    canvasState,
    $,
    addActor,
    addData,
    dropFiles,
    providerSearchKey,
    render,
    selectedData,
    toast
  }) {
    function dataCategory(type) {
      return (
        {
          email: 'Kennungen',
          username: 'Kennungen',
          phone: 'Kennungen',
          url: 'Kennungen',
          location: 'Orte und Zeit',
          datetime: 'Orte und Zeit',
          image: 'Medien',
          file: 'Medien',
          note: 'Eigene Angaben',
          value: 'Eigene Angaben'
        }[type] || 'Weitere'
      );
    }
    function actionCategory(plugin, action) {
      return (
        action.category ||
        plugin.category ||
        {
          location: 'Orte und Zeit',
          metadata: 'Medien',
          transform: 'Datenbearbeitung'
        }[plugin.id] ||
        'Weitere'
      );
    }
    async function dropPalette(event) {
      if (event.dataTransfer?.files?.length) {
        try {
          await dropFiles(event);
        } catch (error) {
          toast(error.message);
        }
        return;
      }
      event.preventDefault();
      for (const element of document.querySelectorAll('.drop-target'))
        element.classList.remove('drop-target');
      try {
        const payload = JSON.parse(event.dataTransfer.getData('application/x-argus-palette'));
        const box = $('graph').getBoundingClientRect(),
          x = (event.clientX - box.left - canvasState.pan.x) / canvasState.pan.scale,
          y = (event.clientY - box.top - canvasState.pan.y) / canvasState.pan.scale;
        if (payload.kind === 'node' && workspaceState.templates[payload.type])
          addData(payload.type, x, y);
        else if (payload.kind === 'actor') {
          const plugin = pluginsState.catalog.find((p) => p.id === payload.plugin),
            action = plugin?.actions.find((a) => a.id === payload.action);
          if (!action) throw Error(t('ui.tool_unavailable'));
          const targetId = event.target.closest('.node')?.dataset.id,
            target = workspaceState.project.document.nodes.find((n) => n.id === targetId);
          if (target?.type === 'actor') throw Error(t('ui.tools_require_a_data_node_as_input'));
          const selected = selectedData();
          const inputs = target
            ? selected.some((node) => node.id === target.id)
              ? selected.filter((node) => actionAcceptsNode(action, node))
              : [target]
            : [];
          const actor = addActor(plugin, action, inputs);
          if (!target) {
            actor.x = x;
            actor.y = y;
            render();
          }
        }
      } catch (error) {
        toast(error.message);
      }
    }
    function actionAcceptsNode(action, node) {
      if (!action.inputs.includes('*') && !action.inputs.includes(node.type)) return false;
      if (node.type !== 'profile') return true;
      const record = pluginsState.providerIndex.get(providerSearchKey(node.data.provider)),
        provider = record?.id || node.data.provider;
      if (action.providers && !action.providers.includes(provider)) return false;
      if (
        action.generic_profile &&
        pluginsState.catalog.some((p) =>
          (p.actions || []).some((a) => a.providers?.includes(provider))
        )
      )
        return false;
      return true;
    }
    function actorIncompatible(action, inputs, allowPartial = false) {
      if (
        action.max_inputs &&
        inputs.filter((n) => actionAcceptsNode(action, n)).length > action.max_inputs
      )
        return true;
      if (action.input_roles) {
        const remaining = [...action.input_roles]
          .sort((a, b) => a.length - b.length)
          .map((role) => [...role]);
        for (const node of [...inputs].sort(
          (a, b) =>
            remaining.filter((role) => role.includes(a.type)).length -
            remaining.filter((role) => role.includes(b.type)).length
        )) {
          const slot = remaining.findIndex((role) => role.includes(node.type));
          if (slot < 0) return true;
          remaining.splice(slot, 1);
        }
        if (!allowPartial && remaining.length) return true;
      }
      if (action.same_type && inputs.length && new Set(inputs.map((n) => n.type)).size > 1)
        return true;
      if (
        !allowPartial &&
        action.min_inputs &&
        inputs.length > 0 &&
        inputs.length < action.min_inputs
      )
        return true;
      return selectionState.selectedGroup
        ? inputs.length > 0 && !inputs.some((n) => actionAcceptsNode(action, n))
        : inputs.some((n) => !actionAcceptsNode(action, n));
    }
    return { dataCategory, actionCategory, dropPalette, actionAcceptsNode, actorIncompatible };
  }
};
export { palette_default };
export default palette_default;
