var layout_default = {
  name: 'layout',
  dependencies: [
    '$',
    'change',
    'groupAncestors',
    'groupBounds',
    'groupDescendantIds',
    'groupNodeIds',
    'hiddenGroupIds',
    'intersects',
    'nodeRect',
    'orderedGroups',
    'render'
  ],
  create({
    workspaceState,
    persistenceState,
    canvasState,
    $,
    change,
    groupAncestors,
    groupBounds,
    groupDescendantIds,
    groupNodeIds,
    hiddenGroupIds,
    intersects,
    nodeRect,
    orderedGroups,
    render
  }) {
    function layoutPositions(units, edges, mode) {
      const positions = /* @__PURE__ */ new Map();
      if (!units.length) return positions;
      if (mode === 'grid') {
        const columns = Math.ceil(Math.sqrt(units.length));
        const widths = Array(columns).fill(0);
        const heights = Array(Math.ceil(units.length / columns)).fill(0);
        units.forEach((u, i) => {
          widths[i % columns] = Math.max(widths[i % columns], u.w);
          heights[Math.floor(i / columns)] = Math.max(heights[Math.floor(i / columns)], u.h);
        });
        units.forEach((u, i) => {
          const column = i % columns,
            row = Math.floor(i / columns);
          positions.set(u.id, {
            x:
              widths.slice(0, column).reduce((sum, width) => sum + width + 70, 0) +
              (widths[column] - u.w) / 2,
            y:
              heights.slice(0, row).reduce((sum, height) => sum + height + 70, 0) +
              (heights[row] - u.h) / 2
          });
        });
      } else if (mode === 'radial') {
        let radius = 0;
        // Separate every pair of bounding circles, including differently sized groups.
        for (let i = 0; i < units.length; i++) {
          for (let j = i + 1; j < units.length; j++) {
            const separation =
              (Math.hypot(units[i].w, units[i].h) + Math.hypot(units[j].w, units[j].h)) / 2 + 70;
            radius = Math.max(
              radius,
              separation / (2 * Math.sin((Math.PI * (j - i)) / units.length))
            );
          }
        }
        units.forEach((u, i) => {
          const angle = (2 * Math.PI * i) / units.length - Math.PI / 2;
          positions.set(u.id, {
            x: radius * Math.cos(angle) - u.w / 2,
            y: radius * Math.sin(angle) - u.h / 2
          });
        });
      } else {
        const degree = new Map(units.map((u) => [u.id, 0])),
          next = new Map(units.map((u) => [u.id, /* @__PURE__ */ new Set()])),
          levels = new Map(units.map((u) => [u.id, 0]));
        for (const [from, to] of edges) {
          if (from === to || !next.has(from) || !degree.has(to) || next.get(from).has(to)) continue;
          next.get(from).add(to);
          degree.set(to, degree.get(to) + 1);
        }
        const queue = units.filter((u) => degree.get(u.id) === 0).map((u) => u.id);
        let head = 0;
        const visited = /* @__PURE__ */ new Set();
        while (head < queue.length) {
          const id = queue[head++];
          visited.add(id);
          for (const target of next.get(id)) {
            levels.set(target, Math.max(levels.get(target), levels.get(id) + 1));
            degree.set(target, degree.get(target) - 1);
            if (degree.get(target) === 0) queue.push(target);
          }
        }
        const cyclicLevel = Math.max(...levels.values()) + 1;
        for (const u of units) if (!visited.has(u.id)) levels.set(u.id, cyclicLevel);
        const columns = /* @__PURE__ */ new Map();
        for (const u of units) {
          const level = levels.get(u.id);
          if (!columns.has(level)) columns.set(level, []);
          columns.get(level).push(u);
        }
        const orderedLevels = [...columns.keys()].sort((a, b) => a - b);
        const rank = new Map();
        const updateRanks = () => {
          for (const column of columns.values()) column.forEach((u, i) => rank.set(u.id, i));
        };
        updateRanks();
        for (let pass = 0; pass < 4; pass++) {
          const forward = pass % 2 === 0;
          for (const level of forward ? orderedLevels : [...orderedLevels].reverse()) {
            const score = (id) => {
              const neighbors = edges
                .filter(([a, b]) => (forward ? b === id : a === id))
                .map(([a, b]) => (forward ? a : b))
                .filter((n) => rank.has(n));
              return neighbors.length
                ? neighbors.reduce((sum, n) => sum + rank.get(n), 0) / neighbors.length
                : rank.get(id);
            };
            columns.get(level).sort((a, b) => score(a.id) - score(b.id));
            updateRanks();
          }
        }
        const maxHeight = Math.max(
          ...[...columns.values()].map((column) => column.reduce((sum, u) => sum + u.h + 60, -60))
        );
        let x = 0;
        for (const level of orderedLevels) {
          let y = (maxHeight - columns.get(level).reduce((sum, u) => sum + u.h + 60, -60)) / 2,
            width = 0;
          for (const u of columns.get(level)) {
            positions.set(u.id, {
              x,
              y
            });
            y += u.h + 60;
            width = Math.max(width, u.w);
          }
          x += width + 110;
        }
      }
      return positions;
    }
    function arrangeProject(mode) {
      if (!workspaceState.project || persistenceState.busy) return;
      arrangeGroupContents(mode);
      const doc = workspaceState.project.document,
        owners = /* @__PURE__ */ new Map(),
        units = [];
      for (const group of doc.groups.filter((g) => !g.parent_id)) {
        const groupIds = groupNodeIds(group),
          nodes = doc.nodes.filter((n) => groupIds.has(n.id) && !owners.has(n.id));
        if (!nodes.length) continue;
        const bounds = groupBounds(group),
          id = 'group:' + group.id;
        for (const n of nodes) owners.set(n.id, id);
        units.push({
          id,
          members: nodes,
          x: bounds.x,
          y: bounds.y,
          w: group.collapsed ? 220 : bounds.w,
          h: group.collapsed ? 76 : bounds.h
        });
      }
      for (const n of doc.nodes)
        if (!owners.has(n.id) && n.type !== 'marker') {
          owners.set(n.id, n.id);
          units.push({
            id: n.id,
            members: [n],
            x: n.x,
            y: n.y,
            w: nodeRect(n).w,
            h: nodeRect(n).h
          });
        }
      const edges = doc.edges.map((e) => [owners.get(e.source), owners.get(e.target)]);
      // Each execution forms its own grid/circle. Connect those blocks in workflow order.
      let positions;
      if (mode === 'hierarchical') positions = layoutPositions(units, edges, mode);
      else {
        const byId = new Map(units.map((u) => [u.id, u]));
        const claimed = new Set(),
          clusters = [],
          clusterOwner = new Map();
        for (const unit of units.filter(
          (u) => u.members.length === 1 && u.members[0].type === 'actor'
        )) {
          const outputs = edges
            .filter(([from, to]) => from === unit.id && to !== unit.id)
            .map(([, to]) => byId.get(to))
            .filter(
              (u) =>
                u && u.members.length === 1 && u.members[0].type !== 'actor' && !claimed.has(u.id)
            );
          const members = [unit, ...new Map(outputs.map((u) => [u.id, u])).values()];
          const local = layoutPositions(members, [], mode);
          const left = Math.min(...members.map((u) => local.get(u.id).x)),
            top = Math.min(...members.map((u) => local.get(u.id).y));
          const cluster = {
            id: unit.id,
            members,
            local,
            x: left,
            y: top,
            w: Math.max(...members.map((u) => local.get(u.id).x + u.w)) - left,
            h: Math.max(...members.map((u) => local.get(u.id).y + u.h)) - top
          };
          clusters.push(cluster);
          for (const member of members) {
            claimed.add(member.id);
            clusterOwner.set(member.id, cluster.id);
          }
        }
        for (const unit of units)
          if (!claimed.has(unit.id)) {
            clusters.push({
              ...unit,
              members: [unit],
              local: new Map([[unit.id, { x: 0, y: 0 }]]),
              x: 0,
              y: 0
            });
            clusterOwner.set(unit.id, unit.id);
          }
        const clusterEdges = edges.map(([a, b]) => [clusterOwner.get(a), clusterOwner.get(b)]);
        const blocks = layoutPositions(clusters, clusterEdges, 'hierarchical');
        positions = new Map();
        for (const cluster of clusters)
          for (const unit of cluster.members)
            positions.set(unit.id, {
              x: blocks.get(cluster.id).x + cluster.local.get(unit.id).x - cluster.x,
              y: blocks.get(cluster.id).y + cluster.local.get(unit.id).y - cluster.y
            });
      }
      for (const unit of units) {
        const pos = positions.get(unit.id);
        for (const node of unit.members) {
          node.x += pos.x - unit.x;
          node.y += pos.y - unit.y;
        }
      }
      change();
      render();
      centerProject();
    }
    function fitViewport(rects, width, height, padding = 40) {
      if (!rects.length)
        return {
          x: width / 2,
          y: height / 2,
          scale: 1
        };
      const left = Math.min(...rects.map((r) => r.x)),
        top = Math.min(...rects.map((r) => r.y)),
        right = Math.max(...rects.map((r) => r.x + r.w)),
        bottom = Math.max(...rects.map((r) => r.y + r.h));
      const scale = Math.min(
        1.1,
        Math.max(1, width - 2 * padding) / Math.max(1, right - left),
        Math.max(1, height - 2 * padding) / Math.max(1, bottom - top)
      );
      return {
        scale,
        x: width / 2 - ((left + right) * scale) / 2,
        y: height / 2 - ((top + bottom) * scale) / 2
      };
    }
    function centerProject() {
      if (!workspaceState.project) return;
      const rects = [],
        hidden = /* @__PURE__ */ new Set(),
        hiddenGroups = hiddenGroupIds();
      for (const group of orderedGroups()) {
        if (hiddenGroups.has(group.id)) continue;
        const bounds = groupBounds(group);
        rects.push({
          x: bounds.x,
          y: bounds.y,
          w: group.collapsed ? 220 : bounds.w,
          h: group.collapsed ? 76 : bounds.h
        });
        if (group.collapsed) for (const id of groupNodeIds(group)) hidden.add(id);
      }
      for (const node of workspaceState.project.document.nodes)
        if (!hidden.has(node.id)) rects.push(nodeRect(node));
      const box = $('graph').getBoundingClientRect();
      canvasState.pan = fitViewport(rects, box.width, box.height);
      render();
    }
    function freeNodeSpot(rect) {
      const hidden = /* @__PURE__ */ new Set(),
        obstacles = [];
      for (const group of workspaceState.project.document.groups.filter((g) => !g.parent_id)) {
        const b = groupBounds(group);
        obstacles.push({
          ...b,
          w: group.collapsed ? 220 : b.w,
          h: group.collapsed ? 76 : b.h
        });
        for (const id of groupNodeIds(group)) hidden.add(id);
      }
      for (const node of workspaceState.project.document.nodes)
        if (node.type !== 'marker' && !hidden.has(node.id)) obstacles.push(nodeRect(node));
      const spot = {
        ...rect
      };
      for (
        let i = 0;
        i <
        workspaceState.project.document.nodes.length +
          workspaceState.project.document.groups.length +
          2;
        i++
      ) {
        const collisions = obstacles.filter((r) => intersects(spot, r, 25));
        if (!collisions.length) break;
        spot.y = Math.max(...collisions.map((r) => r.y + r.h)) + 35;
      }
      return spot;
    }
    function makeRoomForGroup(group) {
      const ancestors = groupAncestors(group.id),
        excluded = groupDescendantIds(group.id);
      for (const id of ancestors) excluded.add(id);
      makeRoomAround(groupBounds(group), groupNodeIds(group), excluded);
    }
    function makeRoomAround(bounds, owned, excluded) {
      const units = [];
      for (const other of orderedGroups()) {
        if (excluded.has(other.id)) continue;
        const ids = groupNodeIds(other);
        if ([...ids].some((id) => owned.has(id))) continue;
        const nodes = workspaceState.project.document.nodes.filter((n) => ids.has(n.id));
        nodes.forEach((n) => owned.add(n.id));
        const b = groupBounds(other);
        units.push({
          nodes,
          rect: {
            ...b,
            w: other.collapsed ? 220 : b.w,
            h: other.collapsed ? 76 : b.h
          }
        });
      }
      for (const node of workspaceState.project.document.nodes)
        if (node.type !== 'marker' && !owned.has(node.id))
          units.push({
            nodes: [node],
            rect: nodeRect(node)
          });
      const placed = [bounds];
      for (const unit of units) {
        const y = unit.rect.y;
        for (let i = 0; i < units.length + 1; i++) {
          const hit = placed.find((b) => intersects(unit.rect, b, 30));
          if (!hit) break;
          unit.rect.y = hit.y + hit.h + 40;
        }
        for (const node of unit.nodes) node.y += unit.rect.y - y;
        placed.push(unit.rect);
      }
      canvasState.groupBoundsCache = null;
    }
    function arrangeGroupContents(mode) {
      for (const group of orderedGroups().reverse()) {
        const origin = groupBounds(group),
          units = [];
        for (const id of group.members) {
          const node = workspaceState.project.document.nodes.find((n) => n.id === id);
          if (node)
            units.push({
              id,
              members: [node],
              ...nodeRect(node)
            });
        }
        for (const child of workspaceState.project.document.groups.filter(
          (g) => g.parent_id === group.id
        )) {
          const bounds = groupBounds(child);
          units.push({
            id: 'group:' + child.id,
            members: workspaceState.project.document.nodes.filter((n) =>
              groupNodeIds(child).has(n.id)
            ),
            x: bounds.x,
            y: bounds.y,
            w: child.collapsed ? 220 : bounds.w,
            h: child.collapsed ? 76 : bounds.h
          });
        }
        if (units.length < 2) continue;
        const unitOwners = new Map(units.flatMap((u) => u.members.map((n) => [n.id, u.id]))),
          edges = workspaceState.project.document.edges.map((e) => [
            unitOwners.get(e.source),
            unitOwners.get(e.target)
          ]),
          positions = layoutPositions(units, edges, mode),
          minX = Math.min(...[...positions.values()].map((p) => p.x)),
          minY = Math.min(...[...positions.values()].map((p) => p.y));
        for (const unit of units) {
          const spot = positions.get(unit.id);
          for (const node of unit.members) {
            node.x += origin.x + 20 + spot.x - minX - unit.x;
            node.y += origin.y + 42 + spot.y - minY - unit.y;
          }
        }
        canvasState.groupBoundsCache = null;
      }
    }
    return {
      layoutPositions,
      arrangeProject,
      fitViewport,
      centerProject,
      freeNodeSpot,
      makeRoomForGroup,
      makeRoomAround,
      arrangeGroupContents
    };
  }
};
export { layout_default };
export default layout_default;
