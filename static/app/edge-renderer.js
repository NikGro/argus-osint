import { t } from '../i18n.js';
import { icon } from '../icons.js';
var edge_renderer_default = {
  name: 'edge-renderer',
  dependencies: [
    'askText',
    'change',
    'deleteEdges',
    'edgeBundleIds',
    'measureEdgeText',
    'nodeRect',
    'render',
    'routeConnection',
    'selectEdge',
    'svg',
    'toast'
  ],
  create({
    askText,
    change,
    deleteEdges,
    edgeBundleIds,
    measureEdgeText,
    nodeRect,
    render,
    routeConnection,
    selectEdge,
    svg,
    toast
  }) {
    function renderEdges({
      doc,
      hidden,
      groupModel,
      groupEdges,
      externalEdges,
      labelOverlay,
      labelsByContext
    }) {
      const nodeObstacles = doc.nodes
        .filter((n) => n.type !== 'marker' && !hidden.has(n.id))
        .map(nodeRect);
      const incoming = new Map();
      for (const edge of doc.edges) {
        if (!incoming.has(edge.target)) incoming.set(edge.target, []);
        incoming.get(edge.target).push(edge.id);
      }
      const shownConnections = /* @__PURE__ */ new Set();
      for (const edge of doc.edges) {
        const visual = groupModel.connection(edge);
        if (!visual || shownConnections.has(visual.key)) continue;
        shownConnections.add(visual.key);
        const { context } = visual,
          a = visual.a.rect,
          b = visual.b.rect,
          edgeLayer = context ? groupEdges.get(context) : externalEdges;
        if (!edgeLayer) continue;
        if (!labelsByContext.has(context)) labelsByContext.set(context, []);
        const occupiedLabels = labelsByContext.get('all') || [];
        labelsByContext.set('all', occupiedLabels);
        const ancestorIds = context
          ? (groupModel.nodePaths.get(edge.source) || []).slice(
              0,
              (groupModel.nodePaths.get(edge.source) || []).indexOf(context) + 1
            )
          : [];
        const labelObstacles = [
          ...nodeObstacles,
          ...groupModel.groups
            .filter((g) => !ancestorIds.includes(g.id))
            .map((g) => groupModel.rects.get(g.id)),
          ...ancestorIds.map((id) => {
            const b2 = groupModel.rects.get(id);
            return {
              ...b2,
              h: 32
            };
          })
        ];
        const labelLayer = svg('g', {
          class: 'connection-label',
          'data-edge-label': edge.id
        });
        labelOverlay.append(labelLayer);
        const labelText = t(String(edge.label || ''));
        const route = routeConnection(
            a,
            b,
            labelText,
            labelObstacles,
            occupiedLabels,
            {
              ...edge,
              source_port: 'right',
              target_port:
                b.inputCount > 1 && visual.b.key.startsWith('node:')
                  ? `left:${
                      Math.max(0, incoming.get(edge.target).indexOf(edge.id)) % b.inputCount
                    }:${b.inputCount}`
                  : 'left'
            },
            measureEdgeText(labelText)
          ),
          { labelX, labelY } = route;
        const hit = svg('path', {
          class: 'edge-hit',
          d: route.path,
          'data-edge-hit': edge.id,
          tabindex: 0,
          role: 'button',
          'aria-label': t('Verbindung ausw\xE4hlen')
        });
        hit.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          selectEdge(edge.id, e.shiftKey);
        });
        hit.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            selectEdge(edge.id, e.shiftKey);
          }
        });
        for (const visible of route.visiblePaths || [
          {
            path: route.path,
            arrow: true
          }
        ]) {
          if (!visible.path) continue;
          const stroke = svg('path', {
            class: 'edge',
            d: visible.path,
            'data-edge-path': edge.id,
            'data-has-arrow': String(visible.arrow)
          });
          if (!visible.arrow) stroke.style.markerEnd = 'none';
          edgeLayer.append(stroke);
        }
        edgeLayer.append(hit);
        const text = svg(
          'text',
          {
            class: 'edgeLabel',
            x: labelX,
            y: labelY,
            'text-anchor': 'middle',
            'dominant-baseline': 'central'
          },
          labelText
        );
        labelLayer.append(text);
        const labelWidth = measureEdgeText(labelText),
          labelHeight = 28;
        const backdrop = svg('rect', {
          class: 'edge-label-backdrop',
          x: labelX - labelWidth / 2 - 59,
          y: labelY - labelHeight / 2,
          width: labelWidth + 118,
          height: labelHeight,
          rx: 3
        });
        backdrop.style.fill = 'transparent';
        backdrop.style.pointerEvents = 'all';
        labelLayer.insertBefore(backdrop, text);
        labelLayer.addEventListener('pointerdown', (event) => event.stopPropagation());
        backdrop.addEventListener('click', (event) => {
          event.stopPropagation();
          selectEdge(edge.id, event.shiftKey);
        });
        // Separate stroked paths provide control gaps without expensive per-edge SVG masks.
        const strokes = [
          ...edgeLayer.querySelectorAll('[data-edge-path="' + CSS.escape(edge.id) + '"]')
        ];
        labelLayer.addEventListener('pointerenter', () =>
          strokes.forEach((stroke, i) =>
            stroke.setAttribute('d', route.controlPaths?.[i]?.path || route.visiblePaths[i].path)
          )
        );
        labelLayer.addEventListener('pointerleave', () =>
          strokes.forEach((stroke, i) => stroke.setAttribute('d', route.visiblePaths[i].path))
        );
        labelLayer.addEventListener('focusin', () =>
          strokes.forEach((stroke, i) =>
            stroke.setAttribute('d', route.controlPaths?.[i]?.path || route.visiblePaths[i].path)
          )
        );
        labelLayer.addEventListener('focusout', () =>
          strokes.forEach((stroke, i) => stroke.setAttribute('d', route.visiblePaths[i].path))
        );
        const pen = svg('g', {
          class: 'edge-edit',
          role: 'button',
          tabindex: 0,
          'aria-label': t('Verbindung bearbeiten'),
          'data-edge': edge.id
        });
        pen.append(
          svg('rect', {
            class: 'edge-edit-hit',
            x: labelX + labelWidth / 2 + 7,
            y: labelY - 11,
            width: 22,
            height: 22
          })
        );
        const glyph = icon('edit');
        glyph.setAttribute('x', labelX + labelWidth / 2 + 11);
        glyph.setAttribute('y', labelY - 7);
        glyph.setAttribute('width', 14);
        glyph.setAttribute('height', 14);
        pen.append(glyph);
        const edit = async () => {
          const text2 = await askText(
            t('Verbindung bearbeiten'),
            t('Bezeichnung'),
            edge.label || ''
          );
          if (text2 !== null) {
            edge.label = text2;
            change();
            render();
          }
        };
        pen.addEventListener('pointerdown', (e) => e.stopPropagation());
        pen.addEventListener('click', (e) => {
          e.stopPropagation();
          edit().catch((error) => toast(error.message));
        });
        pen.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            edit().catch((error) => toast(error.message));
          }
        });
        labelLayer.append(pen);
        const trash = svg('g', {
          class: 'edge-delete',
          role: 'button',
          tabindex: 0,
          'aria-label': t('Verbindung l\xF6schen')
        });
        trash.append(
          svg('rect', {
            x: labelX + labelWidth / 2 + 31,
            y: labelY - 11,
            width: 22,
            height: 22,
            fill: 'transparent'
          })
        );
        const trashIcon = icon('trash');
        for (const [key, value] of Object.entries({
          x: labelX + labelWidth / 2 + 35,
          y: labelY - 7,
          width: 14,
          height: 14
        }))
          trashIcon.setAttribute(key, value);
        trash.append(trashIcon);
        trash.addEventListener('pointerdown', (e) => e.stopPropagation());
        trash.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteEdges(edgeBundleIds(edge.id));
        });
        trash.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            deleteEdges(edgeBundleIds(edge.id));
          }
        });
        labelLayer.append(trash);
      }
    }
    return { renderEdges };
  }
};
export { edge_renderer_default };
export default edge_renderer_default;
