import { t } from '../i18n.js';
var groups_default = {
  name: 'groups',
  dependencies: [
    'askText',
    'change',
    'freeNodeSpot',
    'inspect',
    'inspectGroup',
    'makeRoomForGroup',
    'nodeRect',
    'pluginText',
    'render',
    'uid'
  ],
  create({
    canvasState,
    workspaceState,
    persistenceState,
    selectionState,
    pluginsState,
    askText,
    change,
    freeNodeSpot,
    inspect,
    inspectGroup,
    makeRoomForGroup,
    nodeRect,
    pluginText,
    render,
    uid
  }) {
    function groupBounds(g) {
      if (!canvasState.groupBoundsCache) {
        const groups = workspaceState.project.document.groups,
          byId = new Map(groups.map((v) => [v.id, v])),
          children = new Map(groups.map((v) => [v.id, []])),
          nodes = new Map(workspaceState.project.document.nodes.map((n) => [n.id, n])),
          pending = /* @__PURE__ */ new Map();
        for (const group of groups)
          if (byId.has(group.parent_id)) children.get(group.parent_id).push(group);
        for (const group of groups) pending.set(group.id, children.get(group.id).length);
        const queue = groups.filter((g2) => !pending.get(g2.id)),
          bounds = /* @__PURE__ */ new Map();
        for (let i = 0; i < queue.length; i++) {
          const group = queue[i],
            rects = group.members
              .map((id) => nodes.get(id))
              .filter(Boolean)
              .map(nodeRect);
          for (const child of children.get(group.id)) {
            const b = bounds.get(child.id);
            if (b)
              rects.push({
                ...b,
                w: child.collapsed ? 220 : b.w,
                h: child.collapsed ? 76 : b.h
              });
          }
          let result = {
            x: 0,
            y: 0,
            w: 220,
            h: 100
          };
          if (rects.length) {
            const x = Math.min(...rects.map((r) => r.x)) - 20,
              y = Math.min(...rects.map((r) => r.y)) - 42;
            result = {
              x,
              y,
              w: Math.max(...rects.map((r) => r.x + r.w)) - x + 20,
              h: Math.max(...rects.map((r) => r.y + r.h)) - y + 20
            };
          }
          bounds.set(group.id, result);
          if (pending.has(group.parent_id)) {
            pending.set(group.parent_id, pending.get(group.parent_id) - 1);
            if (!pending.get(group.parent_id)) queue.push(byId.get(group.parent_id));
          }
        }
        canvasState.groupBoundsCache = bounds;
      }
      return (
        canvasState.groupBoundsCache.get(g.id) || {
          x: 0,
          y: 0,
          w: 220,
          h: 100
        }
      );
    }
    function graphGroupModel() {
      const groups = orderedGroups(),
        byId = new Map(groups.map((g) => [g.id, g])),
        paths = /* @__PURE__ */ new Map(),
        nodePaths = /* @__PURE__ */ new Map();
      function pathFor(group) {
        if (paths.has(group.id)) return paths.get(group.id);
        const path = [],
          seen = /* @__PURE__ */ new Set();
        let current = group;
        while (current && !seen.has(current.id)) {
          seen.add(current.id);
          path.unshift(current.id);
          current = byId.get(current.parent_id);
        }
        paths.set(group.id, path);
        return path;
      }
      for (const group of groups) {
        const full = pathFor(group);
        for (const id of group.members) {
          const previous = nodePaths.get(id) || [];
          if (full.length > previous.length) nodePaths.set(id, full);
        }
      }
      const visible = groups.filter(
        (group) =>
          !pathFor(group)
            .slice(0, -1)
            .some((id) => byId.get(id).collapsed)
      );
      for (const [id, full] of nodePaths) {
        const collapsed = full.findIndex((id2) => byId.get(id2).collapsed);
        if (collapsed >= 0) nodePaths.set(id, full.slice(0, collapsed + 1));
      }
      const hidden = /* @__PURE__ */ new Set();
      for (const [id, path] of nodePaths) if (byId.get(path.at(-1))?.collapsed) hidden.add(id);
      const rects = new Map(
        visible.map((group) => {
          const bounds = groupBounds(group);
          return [
            group.id,
            {
              ...bounds,
              w: group.collapsed ? 220 : bounds.w,
              h: group.collapsed ? 76 : bounds.h
            }
          ];
        })
      );
      const nodes = new Map(workspaceState.project.document.nodes.map((n) => [n.id, n]));
      function connection(edge) {
        const ap = nodePaths.get(edge.source) || [],
          bp = nodePaths.get(edge.target) || [];
        let shared = 0;
        while (shared < ap.length && shared < bp.length && ap[shared] === bp[shared]) shared++;
        const context = shared ? ap[shared - 1] : null;
        if (context && byId.get(context).collapsed) return null;
        const endpoint = (id, path) =>
          shared < path.length
            ? {
                key: 'group:' + path[shared],
                rect: rects.get(path[shared])
              }
            : {
                key: 'node:' + id,
                rect: nodes.has(id) ? nodeRect(nodes.get(id)) : null
              };
        const a = endpoint(edge.source, ap),
          b = endpoint(edge.target, bp);
        if (!a.rect || !b.rect || a.key === b.key) return null;
        return {
          context,
          a,
          b,
          key: (context || 'root') + '|' + a.key + '>' + b.key + ':' + (edge.label || '')
        };
      }
      const obstacles = /* @__PURE__ */ new Map([[null, []]]);
      for (const group of visible) if (!group.collapsed) obstacles.set(group.id, []);
      for (const group of visible) {
        const path = pathFor(group),
          parent = path.length > 1 ? path[path.length - 2] : null;
        if (obstacles.has(parent)) obstacles.get(parent).push(rects.get(group.id));
      }
      for (const node of nodes.values()) {
        if (hidden.has(node.id)) continue;
        const context = (nodePaths.get(node.id) || []).at(-1) || null;
        if (obstacles.has(context)) obstacles.get(context).push(nodeRect(node));
      }
      return {
        groups: visible,
        byId,
        nodePaths,
        hidden,
        rects,
        obstacles,
        connection
      };
    }
    function toggleGroup(group) {
      if (!workspaceState.project || workspaceState.project.archived_at) return;
      group = workspaceState.project.document.groups.find((item) => item.id === group.id);
      if (!group) return;
      group.collapsed = !group.collapsed;
      canvasState.groupBoundsCache = null;
      if (!group.collapsed) makeRoomForGroup(group);
      change();
      render();
      inspectGroup(group);
    }
    function setAllGroups(collapsed) {
      if (!workspaceState.project || workspaceState.project.archived_at) return;
      const groups = workspaceState.project.document.groups;
      if (!groups.some((g) => Boolean(g.collapsed) !== collapsed)) return;
      for (const group2 of groups) group2.collapsed = collapsed;
      canvasState.groupBoundsCache = null;
      if (!collapsed)
        for (const group2 of groups.filter((g) => !g.parent_id)) makeRoomForGroup(group2);
      change(null, 'all-groups');
      render();
      const group = groups.find((g) => g.id === selectionState.selectedGroup);
      if (group) inspectGroup(group);
      else inspect();
    }
    function moveGroup(group, dx, dy) {
      for (const node of workspaceState.project.document.nodes)
        if (group.members.includes(node.id)) {
          node.x += dx;
          node.y += dy;
        }
    }
    function groupTitle(group) {
      return group.label_key
        ? pluginText(
            pluginsState.catalog.find((p) => p.id === group.plugin),
            group.label_key
          )
        : group.label;
    }
    function groupAncestors(id) {
      const byId = new Map(workspaceState.project.document.groups.map((g) => [g.id, g])),
        ancestors = /* @__PURE__ */ new Set();
      let parent = byId.get(id)?.parent_id;
      while (parent && !ancestors.has(parent)) {
        ancestors.add(parent);
        parent = byId.get(parent)?.parent_id;
      }
      return ancestors;
    }
    function groupDescendantIds(id, doc = workspaceState.project.document) {
      const children = /* @__PURE__ */ new Map();
      for (const g of doc.groups) {
        if (!children.has(g.parent_id)) children.set(g.parent_id, []);
        children.get(g.parent_id).push(g.id);
      }
      const ids = /* @__PURE__ */ new Set(),
        stack = [id];
      while (stack.length) {
        const next = stack.pop();
        if (ids.has(next)) continue;
        ids.add(next);
        stack.push(...(children.get(next) || []));
      }
      return ids;
    }
    function groupNodeIds(group, doc = workspaceState.project.document) {
      if (!group) return /* @__PURE__ */ new Set();
      const ids = groupDescendantIds(group.id, doc),
        nodes = /* @__PURE__ */ new Set();
      for (const g of doc.groups) if (ids.has(g.id)) for (const id of g.members) nodes.add(id);
      return nodes;
    }
    function orderedGroups() {
      const groups = workspaceState.project.document.groups,
        children = /* @__PURE__ */ new Map();
      for (const g of groups) {
        if (!children.has(g.parent_id)) children.set(g.parent_id, []);
        children.get(g.parent_id).push(g);
      }
      const known = new Set(groups.map((g) => g.id)),
        stack = groups.filter((g) => !known.has(g.parent_id)).reverse(),
        result = [],
        seen = /* @__PURE__ */ new Set();
      while (stack.length) {
        const g = stack.pop();
        if (seen.has(g.id)) continue;
        seen.add(g.id);
        result.push(g);
        stack.push(...(children.get(g.id) || []).slice().reverse());
      }
      return result;
    }
    function hiddenGroupIds() {
      const hidden = /* @__PURE__ */ new Set();
      for (const g of orderedGroups()) {
        if (hidden.has(g.id)) continue;
        if (g.collapsed) {
          for (const id of groupDescendantIds(g.id)) if (id !== g.id) hidden.add(id);
        }
      }
      return hidden;
    }
    function pruneGroups(groups, nodeIds) {
      let result = groups.map((g) => ({
        ...g,
        members: g.members.filter((id) => nodeIds.has(id))
      }));
      let changed = true;
      while (changed) {
        const parents = new Set(result.map((g) => g.parent_id)),
          next = result.filter((g) => g.members.length || parents.has(g.id));
        changed = next.length !== result.length;
        result = next;
      }
      const ids = new Set(result.map((g) => g.id));
      for (const group of result) if (!ids.has(group.parent_id)) delete group.parent_id;
      return result;
    }
    async function createGroupFromSelection() {
      if (
        !selectionState.selected.size &&
        !selectionState.selectedGroup &&
        !selectionState.selectedGroups.size
      )
        throw Error(t('Bitte Knoten ausw\xE4hlen.'));
      const label = await askText(t('Gruppe erstellen'), t('Gruppenbezeichnung'), t('Neue Gruppe'));
      if (!label) return;
      const doc = workspaceState.project.document,
        groupIds = new Set(
          selectionState.selectedGroups.size
            ? selectionState.selectedGroups
            : selectionState.selectedGroup
              ? [selectionState.selectedGroup]
              : []
        );
      for (const id of [...groupIds]) {
        if ([...groupIds].some((other) => other !== id && groupDescendantIds(other).has(id)))
          groupIds.delete(id);
      }
      const children = doc.groups.filter((g) => groupIds.has(g.id)),
        covered = /* @__PURE__ */ new Set();
      for (const child of children) for (const id of groupNodeIds(child)) covered.add(id);
      const members = [...selectionState.selected].filter((id) => !covered.has(id));
      const owners = [
          ...children.map((g) => g.parent_id || null),
          ...members.map((id) => doc.groups.find((g) => g.members.includes(id))?.id || null)
        ],
        parent = owners.length && owners.every((id) => id === owners[0]) ? owners[0] : null;
      const group = {
        id: uid(),
        label,
        members,
        collapsed: false,
        ...(parent
          ? {
              parent_id: parent
            }
          : {})
      };
      for (const child of children) child.parent_id = group.id;
      for (const old of doc.groups) old.members = old.members.filter((id) => !members.includes(id));
      doc.groups.push(group);
      doc.groups = pruneGroups(doc.groups, new Set(doc.nodes.map((n) => n.id)));
      selectionState.selected.clear();
      selectionState.selectedGroups = /* @__PURE__ */ new Set([group.id]);
      selectionState.selectedGroup = group.id;
      change();
      render();
      inspectGroup(group);
    }
    function dissolveGroup(group) {
      if (!workspaceState.project || !group) return;
      selectionState.selected = new Set(group.members);
      selectionState.selectedGroups = /* @__PURE__ */ new Set([group.id]);
      selectionState.selectedGroup = group.id;
      dissolveSelectedGroups();
    }
    function detachNodes(ids) {
      if (!workspaceState.project) return;
      const doc = workspaceState.project.document,
        wanted = new Set(ids),
        positions = /* @__PURE__ */ new Map();
      for (const id of wanted) {
        let group = doc.groups.find((g) => g.members.includes(id));
        if (!group) continue;
        const seen = /* @__PURE__ */ new Set();
        while (group.parent_id && !seen.has(group.id)) {
          seen.add(group.id);
          const parent = doc.groups.find((g) => g.id === group.parent_id);
          if (!parent) break;
          group = parent;
        }
        const bounds = groupBounds(group);
        positions.set(id, {
          x: bounds.x + (group.collapsed ? 220 : bounds.w) + 200,
          y: bounds.y
        });
      }
      for (const group of doc.groups) group.members = group.members.filter((id) => !wanted.has(id));
      doc.groups = pruneGroups(doc.groups, new Set(doc.nodes.map((n) => n.id)));
      canvasState.groupBoundsCache = null;
      for (const [id, pos] of positions) {
        const node = doc.nodes.find((n) => n.id === id);
        if (!node) continue;
        const rect = nodeRect(node),
          spot = freeNodeSpot({
            ...rect,
            x: pos.x,
            y: pos.y
          });
        node.x = spot.x;
        node.y = spot.y;
      }
      selectionState.selectedGroups.clear();
      selectionState.selectedGroup = null;
      selectionState.selected = new Set(ids);
      change();
      render();
      inspect();
    }
    function dissolveSelectedGroups() {
      if (!workspaceState.project) return;
      const ids = new Set(
        selectionState.selectedGroups.size
          ? selectionState.selectedGroups
          : selectionState.selectedGroup
            ? [selectionState.selectedGroup]
            : []
      );
      if (!ids.size) return;
      const doc = workspaceState.project.document;
      for (const group of [...orderedGroups()].reverse().filter((g) => ids.has(g.id))) {
        const parent = doc.groups.find((g) => g.id === group.parent_id);
        if (parent)
          parent.members = [.../* @__PURE__ */ new Set([...parent.members, ...group.members])];
        for (const child of doc.groups.filter((g) => g.parent_id === group.id)) {
          if (parent) child.parent_id = parent.id;
          else delete child.parent_id;
        }
        doc.groups = doc.groups.filter((g) => g.id !== group.id);
      }
      selectionState.selectedGroup = null;
      selectionState.selectedGroups.clear();
      change();
      render();
      inspect();
    }
    return {
      groupBounds,
      graphGroupModel,
      toggleGroup,
      setAllGroups,
      moveGroup,
      groupTitle,
      groupAncestors,
      groupDescendantIds,
      groupNodeIds,
      orderedGroups,
      hiddenGroupIds,
      pruneGroups,
      createGroupFromSelection,
      dissolveGroup,
      detachNodes,
      dissolveSelectedGroups
    };
  }
};
export { groups_default };
export default groups_default;
