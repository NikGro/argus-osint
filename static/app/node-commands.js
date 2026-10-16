import { t } from '../i18n.js';
import { transformExample } from './labels.js';
var node_commands_default = {
  name: 'node-commands',
  dependencies: [
    '$',
    'actionAcceptsNode',
    'actorIncompatible',
    'change',
    'freeNodeSpot',
    'groupDescendantIds',
    'groupNodeIds',
    'inspect',
    'newNodeLabel',
    'nodeRect',
    'pluginText',
    'pruneGroups',
    'render',
    'uid'
  ],
  create({
    preferencesState,
    canvasState,
    pluginsState,
    workspaceState,
    selectionState,
    persistenceState,
    uploadsState,
    $,
    actionAcceptsNode,
    actorIncompatible,
    change,
    freeNodeSpot,
    groupDescendantIds,
    groupNodeIds,
    inspect,
    newNodeLabel,
    nodeRect,
    pluginText,
    pruneGroups,
    render,
    uid
  }) {
    function newNode(type, label, data, x, y) {
      const n = {
        id: uid(),
        type,
        label,
        data,
        display: structuredClone(preferencesState.appSettings.node_display_defaults?.[type] || {}),
        ...(type === 'note'
          ? {
              appearance: {
                width: 320,
                height: 180,
                color: '#ffcc70'
              }
            }
          : {}),
        x: x ?? (160 - canvasState.pan.x) / canvasState.pan.scale,
        y: y ?? (130 - canvasState.pan.y) / canvasState.pan.scale,
        evidence: {
          origin: 'manual',
          created_at: /* @__PURE__ */ new Date().toISOString(),
          ...(type !== 'actor' && label === newNodeLabel(type) && pluginsState.dataTypes.get(type)
            ? {
                label_key:
                  pluginsState.dataTypes.get(type).node.new_label ||
                  pluginsState.dataTypes.get(type).node.name
              }
            : {})
        }
      };
      const spot = freeNodeSpot(nodeRect(n));
      n.x = spot.x;
      n.y = spot.y;
      workspaceState.project.document.nodes.push(n);
      selectionState.selected = /* @__PURE__ */ new Set([n.id]);
      change(n.id);
      render();
      inspect();
      return n;
    }
    function addData(type, x, y) {
      if (persistenceState.busy) return;
      if (type === 'image' || type === 'file') {
        uploadsState.pendingUploadType = type;
        uploadsState.pendingImagePosition =
          x === void 0
            ? null
            : {
                x,
                y
              };
        $('fileInput').accept = type === 'image' ? 'image/*' : '';
        $('fileInput').click();
        return;
      }
      newNode(type, newNodeLabel(type), structuredClone(workspaceState.templates[type]), x, y);
    }
    function addActor(plugin, action, inputOverride = null) {
      if (persistenceState.busy) return;
      let inputs = inputOverride || selectedData();
      if (selectionState.selectedGroup && !inputOverride)
        inputs = inputs.filter((n) => actionAcceptsNode(action, n));
      if (actorIncompatible(action, inputs, true))
        throw Error(t('Die ausgew\xE4hlten Daten passen nicht zu diesem Aktor.'));
      const x = inputs.length ? Math.max(...inputs.map((n) => n.x + nodeRect(n).w)) + 200 : void 0,
        y = inputs[0] ? inputs[0].y + (nodeRect(inputs[0]).h - 76) / 2 : void 0;
      const actor = newNode(
        'actor',
        pluginText(plugin, action.name),
        {
          plugin: plugin.id,
          action: action.id,
          params:
            action.execution === 'browser'
              ? {
                  code: transformExample
                }
              : Object.fromEntries(
                  Object.entries(structuredClone(action.default_params || {})).filter(
                    ([key]) =>
                      !key.startsWith('use_') &&
                      key !== 'source_order' &&
                      !(action.settings_only || []).includes(key) &&
                      !/(password|token|secret|api_key|sessionid)$/.test(key)
                  )
                )
        },
        x,
        y
      );
      for (const n of inputs)
        workspaceState.project.document.edges.push({
          id: uid(),
          source: n.id,
          target: actor.id,
          label: t('Eingabe')
        });
      change(actor.id);
      render();
      inspect();
      return actor;
    }
    function updateDeleteButtons() {
      if ($('ungroupNodes'))
        $('ungroupNodes').disabled =
          persistenceState.busy ||
          !(selectionState.selectedGroups.size || selectionState.selectedGroup);
      if ($('detachNodes'))
        $('detachNodes').disabled =
          persistenceState.busy ||
          !workspaceState.project?.document.groups.some((g) =>
            g.members.some((id) => selectionState.selected.has(id))
          );
      if ($('expandAllGroups'))
        $('expandAllGroups').disabled = !workspaceState.project?.document.groups.some(
          (g) => g.collapsed
        );
      if ($('collapseAllGroups'))
        $('collapseAllGroups').disabled = !workspaceState.project?.document.groups.some(
          (g) => !g.collapsed
        );
      const hasSelection =
        selectionState.selected.size ||
        selectionState.selectedGroups.size ||
        selectionState.selectedGroup ||
        selectionState.selectedEdges.size;
      for (const id of ['deleteSelected', 'deleteDescendants'])
        if ($(id)) $(id).disabled = persistenceState.busy || !hasSelection;
    }
    function deleteSelectionWithChildren() {
      if (!workspaceState.project || persistenceState.busy) return;
      const ids = new Set(selectionState.selected);
      for (const group of workspaceState.project.document.groups)
        if (
          selectionState.selectedGroups.has(group.id) ||
          group.id === selectionState.selectedGroup
        )
          for (const id of groupNodeIds(group)) ids.add(id);
      const next = /* @__PURE__ */ new Map();
      for (const edge of workspaceState.project.document.edges) {
        if (!next.has(edge.source)) next.set(edge.source, []);
        next.get(edge.source).push(edge.target);
      }
      const queue = [...ids];
      for (let i = 0; i < queue.length; i++)
        for (const child of next.get(queue[i]) || [])
          if (!ids.has(child)) {
            ids.add(child);
            queue.push(child);
          }
      deleteNodes([...ids]);
    }
    function deleteGroup(group) {
      if (!group || !workspaceState.project) return;
      const removed = groupDescendantIds(group.id),
        nodes = [...groupNodeIds(group)];
      workspaceState.project.document.groups = workspaceState.project.document.groups.filter(
        (g) => !removed.has(g.id)
      );
      deleteNodes(nodes, true);
    }
    function deleteSelection() {
      if (selectionState.selectedEdges.size) {
        deleteEdges([...selectionState.selectedEdges]);
        return;
      }
      const groups = selectionState.selectedGroups.size
        ? [...selectionState.selectedGroups]
        : selectionState.selectedGroup
          ? [selectionState.selectedGroup]
          : [];
      if (groups.length) {
        const ids = new Set(selectionState.selected),
          removed = /* @__PURE__ */ new Set();
        for (const id of groups) {
          const group = workspaceState.project.document.groups.find((g) => g.id === id);
          if (group) {
            for (const node of groupNodeIds(group)) ids.add(node);
            for (const child of groupDescendantIds(id)) removed.add(child);
          }
        }
        workspaceState.project.document.groups = workspaceState.project.document.groups.filter(
          (g) => !removed.has(g.id)
        );
        deleteNodes([...ids], true);
      } else deleteNodes([...selectionState.selected]);
    }
    function deleteNodes(ids, groupRemoved = false) {
      if (persistenceState.busy || (!ids.length && !groupRemoved)) return;
      const nodes = workspaceState.project.document.nodes.filter((n) => ids.includes(n.id));
      if (!nodes.length && !groupRemoved) return;
      const remove = new Set(ids),
        doc = workspaceState.project.document;
      doc.nodes = doc.nodes.filter((n) => !remove.has(n.id));
      doc.edges = doc.edges.filter((e) => !remove.has(e.source) && !remove.has(e.target));
      for (const g of doc.groups) g.members = g.members.filter((id) => !remove.has(id));
      doc.groups = pruneGroups(doc.groups, new Set(doc.nodes.map((n) => n.id)));
      selectionState.selected.clear();
      selectionState.selectedEdges.clear();
      selectionState.selectedGroup = null;
      selectionState.selectedGroups.clear();
      change();
      render();
      inspect();
    }
    function deleteEdges(ids) {
      if (!workspaceState.project) return;
      const remove = new Set(ids);
      workspaceState.project.document.edges = workspaceState.project.document.edges.filter(
        (e) => !remove.has(e.id)
      );
      selectionState.selectedEdges.clear();
      change();
      render();
      inspect();
    }
    function selectedData() {
      const ids = new Set(selectionState.selected);
      for (const id of selectionState.selectedGroups.size
        ? selectionState.selectedGroups
        : selectionState.selectedGroup
          ? [selectionState.selectedGroup]
          : []) {
        const group = workspaceState.project?.document.groups.find((g) => g.id === id);
        if (group) for (const node of groupNodeIds(group)) ids.add(node);
      }
      return workspaceState.project
        ? workspaceState.project.document.nodes.filter((n) => n.type !== 'actor' && ids.has(n.id))
        : [];
    }
    function editableNodeData(node) {
      const data = {};
      for (const [key, value] of Object.entries(workspaceState.templates[node.type] || {})) {
        if (node.type === 'error' && key === 'title') continue;
        if (
          node.type === 'location' &&
          ['formatted_address', 'original_input', 'granularity', 'coordinate_role'].includes(key)
        )
          continue;
        data[key] = node.data[key] ?? structuredClone(value);
      }
      return data;
    }
    return {
      newNode,
      addData,
      addActor,
      updateDeleteButtons,
      deleteSelectionWithChildren,
      deleteGroup,
      deleteSelection,
      deleteNodes,
      deleteEdges,
      selectedData,
      editableNodeData
    };
  }
};
export { node_commands_default };
export default node_commands_default;
