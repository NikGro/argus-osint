import ArgusRouting from '../graph-routing.js';
import { t } from '../i18n.js';
var canvas_input_default = {
  name: 'canvas-input',
  dependencies: [
    '$',
    'change',
    'groupBounds',
    'groupNodeIds',
    'inspect',
    'inspectGroup',
    'nodeRect',
    'portPosition',
    'render',
    'renderViewport',
    'svg',
    'uid'
  ],
  create({
    selectionState,
    persistenceState,
    canvasState,
    workspaceState,
    $,
    change,
    groupBounds,
    groupNodeIds,
    inspect,
    inspectGroup,
    nodeRect,
    portPosition,
    render,
    renderViewport,
    svg,
    uid
  }) {
    function startGroupDrag(group, event) {
      selectionState.selectedEdges.clear();
      if (
        persistenceState.busy ||
        event.button > 0 ||
        canvasState.spacePressed ||
        event.target.closest('.group-toggle')
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        selectionState.selectedGroups.has(group.id)
          ? selectionState.selectedGroups.delete(group.id)
          : selectionState.selectedGroups.add(group.id);
        if (!selectionState.selectedGroups.has(group.id)) {
          if (selectionState.selectedGroups.size)
            inspectGroup(
              workspaceState.project.document.groups.find(
                (g) => g.id === [...selectionState.selectedGroups][0]
              )
            );
          else {
            selectionState.selectedGroup = null;
            inspect();
          }
          return;
        }
      } else if (!selectionState.selectedGroups.has(group.id)) {
        selectionState.selectedGroups = /* @__PURE__ */ new Set([group.id]);
        selectionState.selected.clear();
      }
      const dragIds = new Set(selectionState.selected);
      for (const id of selectionState.selectedGroups)
        for (const node of groupNodeIds(
          workspaceState.project.document.groups.find((g) => g.id === id)
        ))
          dragIds.add(node);
      canvasState.drag = {
        kind: 'group',
        groupId: group.id,
        startX: event.clientX,
        startY: event.clientY,
        positions: workspaceState.project.document.nodes
          .filter((n) => dragIds.has(n.id))
          .map((n) => ({
            id: n.id,
            x: n.x,
            y: n.y
          })),
        moved: false
      };
      $('graph').setPointerCapture(event.pointerId);
      inspectGroup(group);
    }
    let pendingDrag = null,
      dragFrame = null;
    function flushDrag() {
      if (dragFrame !== null) cancelAnimationFrame(dragFrame);
      dragFrame = null;
      const event = pendingDrag;
      pendingDrag = null;
      if (event) applyDrag(event);
    }
    function updateDrag(event) {
      if (!canvasState.drag && !canvasState.connecting) return;
      pendingDrag = event;
      if (dragFrame === null) dragFrame = requestAnimationFrame(flushDrag);
    }
    function applyDrag(event) {
      if (canvasState.connecting) {
        updateConnection(event);
        return;
      }
      if (!canvasState.drag || canvasState.pinchGesture || canvasState.gestureBlocked) return;
      const dx = event.clientX - canvasState.drag.startX,
        dy = event.clientY - canvasState.drag.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) canvasState.drag.moved = true;
      if (!canvasState.drag.moved) return;
      if (canvasState.drag.kind === 'note-resize') {
        const node = workspaceState.project.document.nodes.find(
          (n) => n.id === canvasState.drag.id
        );
        if (node) {
          node.appearance = {
            ...node.appearance,
            width: Math.max(
              200,
              Math.min(900, canvasState.drag.width + dx / canvasState.pan.scale)
            ),
            height: Math.max(
              120,
              Math.min(800, canvasState.drag.height + dy / canvasState.pan.scale)
            )
          };
          change(node.id, 'resize:' + canvasState.drag.id);
          render();
        }
        return;
      }
      if (canvasState.drag.kind === 'box') {
        drawSelectionFrame(canvasState.drag, event);
        return;
      }
      if (canvasState.drag.kind === 'pan') {
        canvasState.pan.x = canvasState.drag.x + dx;
        canvasState.pan.y = canvasState.drag.y + dy;
      } else {
        for (const pos of canvasState.drag.positions) {
          const node = workspaceState.project.document.nodes.find((n) => n.id === pos.id);
          if (node) {
            node.x = pos.x + dx / canvasState.pan.scale;
            node.y = pos.y + dy / canvasState.pan.scale;
          }
        }
        change(null, 'drag:' + canvasState.drag.startX + ':' + canvasState.drag.startY);
      }
      if (canvasState.drag.kind === 'pan') renderViewport();
      else render();
    }
    function zoomAt(x, y, scale) {
      const next = Math.max(0.15, Math.min(2.5, scale));
      canvasState.pan.x = x - ((x - canvasState.pan.x) * next) / canvasState.pan.scale;
      canvasState.pan.y = y - ((y - canvasState.pan.y) * next) / canvasState.pan.scale;
      canvasState.pan.scale = next;
      renderViewport();
    }
    function zoomStep(direction) {
      const box = $('graph').getBoundingClientRect();
      zoomAt(
        box.width / 2,
        box.height / 2,
        nextZoomPercent(canvasState.pan.scale * 100, direction) / 100
      );
    }
    function nextZoomPercent(percent, direction) {
      return Math.max(
        15,
        Math.min(
          250,
          direction > 0
            ? (Math.floor((percent + 1e-7) / 5) + 1) * 5
            : (Math.ceil((percent - 1e-7) / 5) - 1) * 5
        )
      );
    }
    function frameRect(start, event) {
      const box = $('graph').getBoundingClientRect();
      const x1 = start.startX - box.left,
        y1 = start.startY - box.top,
        x2 = event.clientX - box.left,
        y2 = event.clientY - box.top;
      return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        w: Math.abs(x2 - x1),
        h: Math.abs(y2 - y1)
      };
    }
    function removeSelectionFrame() {
      $('selectionFrame')?.remove();
    }
    function drawSelectionFrame(start, event) {
      let frame = $('selectionFrame');
      if (!frame) {
        frame = svg('rect', {
          id: 'selectionFrame',
          class: 'selection-frame'
        });
        $('graph').append(frame);
      }
      const bounds = frameRect(start, event);
      for (const [key, value] of Object.entries({
        x: bounds.x,
        y: bounds.y,
        width: bounds.w,
        height: bounds.h
      }))
        frame.setAttribute(key, value);
    }
    function boxSelection(doc, rect, base) {
      const result = new Set(base),
        hidden = /* @__PURE__ */ new Set();
      function overlaps(b) {
        return (
          b.x + b.w >= rect.x &&
          b.x <= rect.x + rect.w &&
          b.y + b.h >= rect.y &&
          b.y <= rect.y + rect.h
        );
      }
      for (const group of doc.groups)
        if (group.collapsed) {
          const b = groupBounds(group);
          for (const id of groupNodeIds(group, doc)) hidden.add(id);
          if (
            overlaps({
              x: b.x,
              y: b.y,
              w: 220,
              h: 76
            })
          )
            for (const id of groupNodeIds(group, doc)) result.add(id);
        }
      for (const node of doc.nodes)
        if (
          !hidden.has(node.id) &&
          overlaps({
            x: node.x,
            y: node.y,
            ...nodeRect(node)
          })
        )
          result.add(node.id);
      return result;
    }
    function canvasPointerDown(event) {
      if (
        !workspaceState.project ||
        persistenceState.busy ||
        canvasState.pinchGesture ||
        canvasState.gestureBlocked ||
        event.target.closest('.edge-edit,.edge-delete,.edge-hit,.group-toggle')
      )
        return;
      const panning =
        event.button === 1 ||
        event.button === 2 ||
        canvasState.spacePressed ||
        (event.pointerType === 'touch' && !canvasState.touchSelection);
      if (!panning && event.target.closest('.node,.group')) return;
      selectionState.selectedEdges.clear();
      event.preventDefault();
      canvasState.drag = {
        kind: panning ? 'pan' : 'box',
        startX: event.clientX,
        startY: event.clientY,
        x: canvasState.pan.x,
        y: canvasState.pan.y,
        moved: false,
        base: new Set(event.shiftKey || canvasState.touchSelection ? selectionState.selected : [])
      };
      $('graph').setPointerCapture(event.pointerId);
    }
    function canvasPointerUp(event) {
      flushDrag();
      if (canvasState.connecting) {
        finishConnection(event);
        return;
      }
      if (canvasState.drag?.kind === 'box') {
        if (canvasState.drag.moved) {
          const b = frameRect(canvasState.drag, event);
          selectionState.selected = boxSelection(
            workspaceState.project.document,
            {
              x: (b.x - canvasState.pan.x) / canvasState.pan.scale,
              y: (b.y - canvasState.pan.y) / canvasState.pan.scale,
              w: b.w / canvasState.pan.scale,
              h: b.h / canvasState.pan.scale
            },
            canvasState.drag.base
          );
        } else if (!event.shiftKey) selectionState.selected.clear();
        removeSelectionFrame();
        render();
        inspect();
      } else if (canvasState.drag?.kind === 'pan' && !canvasState.drag.moved) {
        selectionState.selected.clear();
        render();
        inspect();
      }
      canvasState.drag = null;
      if ($('graph').hasPointerCapture(event.pointerId))
        $('graph').releasePointerCapture(event.pointerId);
    }
    function touchMetrics() {
      const [a, b] = [...canvasState.touchPointers.values()];
      return {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
      };
    }
    function touchGestureEvent(event) {
      if (event.pointerType !== 'touch') return;
      if (event.type === 'pointerup' || event.type === 'pointercancel') {
        const wasGesture = Boolean(canvasState.pinchGesture) || canvasState.gestureBlocked;
        canvasState.touchPointers.delete(event.pointerId);
        if (wasGesture) {
          event.stopImmediatePropagation();
          canvasState.drag = null;
          canvasState.pinchGesture = null;
          canvasState.gestureBlocked = canvasState.touchPointers.size > 0;
          removeSelectionFrame();
        }
        return;
      }
      canvasState.touchPointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY
      });
      if (event.type === 'pointerdown') {
        if (canvasState.touchPointers.size >= 2) {
          const metrics = touchMetrics(),
            box = $('graph').getBoundingClientRect();
          canvasState.pinchGesture = {
            ...metrics,
            scale: canvasState.pan.scale,
            worldX: (metrics.x - box.left - canvasState.pan.x) / canvasState.pan.scale,
            worldY: (metrics.y - box.top - canvasState.pan.y) / canvasState.pan.scale
          };
          canvasState.gestureBlocked = false;
          cancelConnection();
          canvasState.drag = null;
          removeSelectionFrame();
          $('graph').setPointerCapture(event.pointerId);
          event.stopImmediatePropagation();
          event.preventDefault();
        }
        return;
      }
      if (canvasState.pinchGesture && canvasState.touchPointers.size >= 2) {
        const metrics = touchMetrics(),
          box = $('graph').getBoundingClientRect();
        canvasState.pan.scale = Math.max(
          0.15,
          Math.min(
            2.5,
            (canvasState.pinchGesture.scale * metrics.distance) / canvasState.pinchGesture.distance
          )
        );
        canvasState.pan.x =
          metrics.x - box.left - canvasState.pinchGesture.worldX * canvasState.pan.scale;
        canvasState.pan.y =
          metrics.y - box.top - canvasState.pinchGesture.worldY * canvasState.pan.scale;
        renderViewport();
        event.stopImmediatePropagation();
        event.preventDefault();
      } else if (canvasState.gestureBlocked) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    }
    function nodePorts(g, node, bounds) {
      const count = Math.min(32, bounds.inputCount || 1);
      for (const side of [
        ...Array.from({ length: count }, (_, i) => `left:${i}:${count}`),
        'right'
      ]) {
        const pos = portPosition(
            {
              x: 0,
              y: 0,
              w: bounds.w,
              h: bounds.h
            },
            side
          ),
          dock = svg('g', {
            class: 'dock',
            'data-port': side,
            role: 'button',
            tabindex: 0,
            'aria-label':
              t(side.startsWith('left') ? 'Eingang' : 'Ausgang') +
              (side.startsWith('left') ? ' ' + (Number(side.split(':')[1]) + 1) : '')
          });
        dock.append(
          svg('circle', {
            class: 'dock-hit',
            cx: pos.x,
            cy: pos.y,
            r: 13
          }),
          svg('circle', {
            cx: pos.x,
            cy: pos.y,
            r: 5
          })
        );
        dock.addEventListener('pointerdown', (e) => {
          if (e.button > 0) return;
          e.preventDefault();
          e.stopPropagation();
          canvasState.connecting = {
            source: node.id,
            port: side,
            pointer: e.pointerId,
            target: null,
            targetPort: null
          };
          canvasState.drag = null;
          $('graph').setPointerCapture(e.pointerId);
          g.classList.add('connection-source');
          updateConnection(e);
        });
        dock.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') cancelConnection();
        });
        g.append(dock);
      }
    }
    function nearestConnectionTarget(point, source, nodes, visibleIds, scale) {
      let best = null,
        distance = Infinity;
      for (const node of nodes) {
        if (node.id === source || node.type === 'marker' || !visibleIds.has(node.id)) continue;
        const bounds = nodeRect(node),
          dx = Math.max(bounds.x - point.x, 0, point.x - bounds.x - bounds.w),
          dy = Math.max(bounds.y - point.y, 0, point.y - bounds.y - bounds.h);
        if (Math.hypot(dx, dy) > 30 / scale) continue;
        const count = Math.min(32, bounds.inputCount || 1);
        const sides = canvasState.connecting?.port.startsWith('left')
          ? ['right']
          : Array.from({ length: count }, (_, i) => `left:${i}:${count}`);
        for (const side of sides) {
          const port = portPosition(bounds, side),
            d = Math.hypot(point.x - port.x, point.y - port.y);
          if (d < distance) {
            best = {
              node: node.id,
              side,
              port
            };
            distance = d;
          }
        }
      }
      return best;
    }
    function updateConnection(event) {
      if (!canvasState.connecting || !workspaceState.project) return;
      const box = $('graph').getBoundingClientRect(),
        point = {
          x: (event.clientX - box.left - canvasState.pan.x) / canvasState.pan.scale,
          y: (event.clientY - box.top - canvasState.pan.y) / canvasState.pan.scale
        },
        nodes = workspaceState.project.document.nodes,
        visible = new Set([...$('scene').querySelectorAll('.node')].map((g) => g.dataset.id)),
        target = nearestConnectionTarget(
          point,
          canvasState.connecting.source,
          nodes,
          visible,
          canvasState.pan.scale
        );
      canvasState.connecting.target = target?.node || null;
      canvasState.connecting.targetPort = target?.side || null;
      for (const g of $('scene').querySelectorAll('.connection-near'))
        g.classList.remove('connection-near');
      const targetElement = [...$('scene').querySelectorAll('.node')].find(
        (g) => g.dataset.id === target?.node
      );
      targetElement?.classList.add('connection-near');
      const source = nodes.find((n) => n.id === canvasState.connecting.source);
      if (!source) {
        cancelConnection();
        return;
      }
      const from = portPosition(nodeRect(source), canvasState.connecting.port),
        to = target?.port || {
          ...point,
          nx: -from.nx,
          ny: -from.ny
        };
      let path = $('connectionPreview');
      if (!path) {
        path = svg('path', {
          id: 'connectionPreview',
          class: 'edge connection-preview'
        });
        $('scene').append(path);
      }
      const start = from.nx < 0 ? to : from,
        end = from.nx < 0 ? from : to;
      if (start.x - 20 <= end.x) {
        const distance = end.x >= start.x ? (end.x - start.x) / 2 : 25 * Math.sqrt(start.x - end.x);
        path.setAttribute(
          'd',
          `M ${start.x} ${start.y} C ${start.x + distance} ${start.y}, ${end.x - distance} ${end.y}, ${end.x} ${end.y}`
        );
      } else {
        path.setAttribute(
          'd',
          ArgusRouting.curvePath(
            ArgusRouting.roundedRoute([
              start,
              { x: start.x + 40, y: start.y },
              { x: start.x + 40, y: start.y + 130 },
              { x: end.x - 40, y: start.y + 130 },
              { x: end.x - 40, y: end.y },
              end
            ])
          )
        );
      }
    }
    function finishConnection(event) {
      updateConnection(event);
      const state = canvasState.connecting;
      cancelConnection();
      if ($('graph').hasPointerCapture(event.pointerId))
        $('graph').releasePointerCapture(event.pointerId);
      if (!state?.target) return;
      const doc = workspaceState.project.document;
      const source = state.port.startsWith('left') ? state.target : state.source;
      const target = state.port.startsWith('left') ? state.source : state.target;
      if (doc.edges.some((e) => e.source === source && e.target === target)) return;
      doc.edges.push({
        id: uid(),
        source,
        target,
        source_port: 'right',
        target_port: state.port.startsWith('left') ? state.port : state.targetPort,
        label: t('verbunden mit')
      });
      change();
      render();
    }
    function cancelConnection() {
      canvasState.connecting = null;
      $('connectionPreview')?.remove();
      if ($('scene'))
        for (const g of $('scene').querySelectorAll('.connection-near,.connection-source')) {
          g.classList.remove('connection-near');
          g.classList.remove('connection-source');
        }
    }
    return {
      startGroupDrag,
      updateDrag,
      zoomAt,
      zoomStep,
      nextZoomPercent,
      frameRect,
      removeSelectionFrame,
      drawSelectionFrame,
      boxSelection,
      canvasPointerDown,
      canvasPointerUp,
      touchMetrics,
      touchGestureEvent,
      nodePorts,
      nearestConnectionTarget,
      updateConnection,
      finishConnection,
      cancelConnection
    };
  }
};
export { canvas_input_default };
export default canvas_input_default;
