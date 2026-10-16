import { t } from '../i18n.js';
var clipboard_default = {
  name: 'clipboard',
  dependencies: [
    '$',
    'api',
    'change',
    'groupNodeIds',
    'inspect',
    'openProject',
    'render',
    'toast',
    'uid'
  ],
  create({
    workspaceState,
    historyState,
    selectionState,
    persistenceState,
    canvasState,
    $,
    api,
    change,
    groupNodeIds,
    inspect,
    openProject,
    render,
    toast,
    uid
  }) {
    function clipboardDocument(doc, selection) {
      const all = selection.size === 0,
        ids = all ? new Set(doc.nodes.map((n) => n.id)) : selection,
        groups = doc.groups
          .filter((g) => all || [...groupNodeIds(g, doc)].some((id) => ids.has(id)))
          .map((g) => ({
            ...g,
            members: g.members.filter((id) => ids.has(id))
          })),
        gids = new Set(groups.map((g) => g.id));
      for (const g of groups) if (!gids.has(g.parent_id)) delete g.parent_id;
      return {
        nodes: structuredClone(doc.nodes.filter((n) => ids.has(n.id))),
        edges: structuredClone(doc.edges.filter((e) => ids.has(e.source) && ids.has(e.target))),
        groups: structuredClone(groups),
        runs: structuredClone(all ? doc.runs : doc.runs.filter((r) => ids.has(r.actor_id))),
        report_notes: all ? doc.report_notes || '' : '',
        preferences: all ? structuredClone(doc.preferences || {}) : {}
      };
    }
    function remapDocument(doc, origin) {
      const result = structuredClone(doc),
        nodes = new Map(result.nodes.map((n) => [n.id, uid()])),
        runs = new Map((result.runs || []).map((r) => [r.id, uid()]));
      for (const n of result.nodes) {
        const old = n.id;
        n.id = nodes.get(old);
        n.evidence = {
          ...n.evidence,
          copied_from: {
            project: origin,
            node: old
          }
        };
        if (n.evidence.source_input && nodes.has(n.evidence.source_input))
          n.evidence.source_input = nodes.get(n.evidence.source_input);
        if (runs.has(n.evidence.run_id)) n.evidence.run_id = runs.get(n.evidence.run_id);
      }
      for (const e of result.edges) {
        e.id = uid();
        e.source = nodes.get(e.source);
        e.target = nodes.get(e.target);
        if (runs.has(e.run_id)) e.run_id = runs.get(e.run_id);
      }
      const groupIds = new Map(result.groups.map((g) => [g.id, uid()]));
      for (const g of result.groups) {
        g.id = groupIds.get(g.id);
        if (g.parent_id) g.parent_id = groupIds.get(g.parent_id);
        g.members = g.members.map((id) => nodes.get(id)).filter(Boolean);
        if (runs.has(g.run_id)) g.run_id = runs.get(g.run_id);
      }
      for (const r of result.runs || []) {
        r.id = runs.get(r.id);
        r.actor_id = nodes.get(r.actor_id) || r.actor_id;
        for (const choice of r.candidates || [])
          choice.input_id = nodes.get(choice.input_id) || choice.input_id;
        for (const key of ['inputs', 'outputs', 'updated_inputs'])
          if (r[key]) r[key] = r[key].map((id) => nodes.get(id) || id);
        for (const n of r.input_snapshot || []) n.id = nodes.get(n.id) || n.id;
      }
      return result;
    }
    function textEditing(target) {
      return Boolean(
        target?.closest('input,textarea,select,[contenteditable]:not([contenteditable=false])')
      );
    }
    function copyGraph(event) {
      if (
        !workspaceState.project ||
        $('workspace').hidden ||
        textEditing(event.target) ||
        document.querySelector('dialog[open]')
      )
        return;
      const documentData = clipboardDocument(
          workspaceState.project.document,
          clipboardSelectionIds()
        ),
        selection = clipboardSelectionIds(),
        payload = {
          format: 'argus-clipboard',
          version: 1,
          kind: selection.size ? 'selection' : 'project',
          title: workspaceState.project.title,
          origin: workspaceState.project.id,
          document: documentData
        },
        text = JSON.stringify(payload, null, 2);
      historyState.internalClipboard = text;
      event.clipboardData.setData('text/plain', text);
      event.clipboardData.setData('application/json', text);
      event.preventDefault();
      toast(
        selectionState.selected.size
          ? selectionState.selected.size + t(' Knoten kopiert.')
          : t('Projekt kopiert.')
      );
    }
    async function pasteGraph(event) {
      clearTimeout(historyState.pendingClipboardPaste);
      if (
        persistenceState.busy ||
        textEditing(event.target) ||
        document.querySelector('dialog[open]')
      )
        return;
      const text = event.clipboardData.getData('text/plain');
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        return;
      }
      if (!['argus-clipboard', 'trace-project'].includes(payload?.format)) return;
      event.preventDefault();
      try {
        const doc = payload.document;
        if (!doc || !['nodes', 'edges', 'groups', 'runs'].every((key) => Array.isArray(doc[key])))
          throw Error(t('Ung\xFCltige Projektdaten in der Zwischenablage.'));
        const imported = remapDocument(doc, payload.origin || payload.title);
        if (!workspaceState.project || $('workspace').hidden) {
          const created = await api('/api/projects', {
            title: (payload.title || t('Eingef\xFCgtes Projekt')) + t(' \xB7 Kopie'),
            document: imported
          });
          await openProject(created.id);
        } else {
          const minX = Math.min(...imported.nodes.map((n) => n.x)),
            minY = Math.min(...imported.nodes.map((n) => n.y));
          const box = $('graph').getBoundingClientRect(),
            x = (box.width / 2 - canvasState.pan.x) / canvasState.pan.scale,
            y = (box.height / 2 - canvasState.pan.y) / canvasState.pan.scale;
          for (const n of imported.nodes) {
            n.x += x - minX;
            n.y += y - minY;
          }
          for (const key of ['nodes', 'edges', 'groups', 'runs'])
            workspaceState.project.document[key].push(...imported[key]);
          selectionState.selected = new Set(imported.nodes.map((n) => n.id));
          change();
          render();
          inspect();
        }
        toast(imported.nodes.length + t(' Knoten eingef\xFCgt.'));
      } catch (error) {
        toast(error.message);
      }
    }
    function graphClipboardText() {
      const selection = clipboardSelectionIds(),
        doc = clipboardDocument(workspaceState.project.document, selection);
      return JSON.stringify(
        {
          format: 'argus-clipboard',
          version: 1,
          kind: selection.size ? 'selection' : 'project',
          title: workspaceState.project.title,
          origin: workspaceState.project.id,
          document: doc
        },
        null,
        2
      );
    }
    function clipboardSelectionIds() {
      const ids = new Set(selectionState.selected);
      for (const id of selectionState.selectedGroups.size
        ? selectionState.selectedGroups
        : selectionState.selectedGroup
          ? [selectionState.selectedGroup]
          : []) {
        const group = workspaceState.project.document.groups.find((g) => g.id === id);
        if (group) for (const node of groupNodeIds(group)) ids.add(node);
      }
      return ids;
    }
    return {
      clipboardDocument,
      remapDocument,
      textEditing,
      copyGraph,
      pasteGraph,
      graphClipboardText,
      clipboardSelectionIds
    };
  }
};
export { clipboard_default };
export default clipboard_default;
