import { t } from '../i18n.js';
import { diagnostic } from '../i18n.js';
var node_renderer_default = {
  name: 'node-renderer',
  dependencies: [
    '$',
    'actorTitle',
    'change',
    'dataLabel',
    'el',
    'fitNodeText',
    'inspect',
    'nodeBadgeHeight',
    'nodeExtras',
    'nodeIcon',
    'nodePorts',
    'nodeRect',
    'nodeTitle',
    'noteInk',
    'providerName',
    'render',
    'renderLocationAddress',
    'short',
    'summary',
    'svg'
  ],
  create({
    selectionState,
    canvasState,
    persistenceState,
    $,
    actorTitle,
    change,
    dataLabel,
    el,
    fitNodeText,
    inspect,
    nodeBadgeHeight,
    nodeExtras,
    nodeIcon,
    nodePorts,
    nodeRect,
    nodeTitle,
    noteInk,
    providerName,
    render,
    renderLocationAddress,
    short,
    summary,
    svg
  }) {
    function renderNodes({ doc, hidden, groupModel, groupViews, scene, previousPositions }) {
      const visibleNodes = doc.nodes.filter((item) => !hidden.has(item.id));
      const keyboardNode =
        visibleNodes.find((item) => item.id === canvasState.keyboardNode) ||
        visibleNodes.find((item) => selectionState.selected.has(item.id)) ||
        visibleNodes[0];
      for (const node of doc.nodes) {
        if (hidden.has(node.id)) continue;
        const bounds = nodeRect(node),
          g = svg('g', {
            class:
              'node ' +
              (node.type === 'actor' ? 'actor ' : '') +
              (node.type === 'note' ? 'note ' : '') +
              (node.type === 'error' ? 'error ' : '') +
              (selectionState.selected.has(node.id) ? 'selected' : ''),
            transform: `translate(${node.x} ${node.y})`,
            'data-id': node.id,
            'data-type': node.type,
            tabindex: node.id === keyboardNode?.id ? 0 : -1,
            role: 'group',
            'aria-roledescription': t('Graph-Knoten'),
            'aria-label': dataLabel(node.type) + ': ' + nodeTitle(node),
            'aria-describedby': 'graphKeyboardHint'
          });
        const rect = svg('rect', {
          width: bounds.w,
          height: bounds.h,
          rx: 10
        });
        g.append(
          rect,
          svg('rect', {
            class: 'node-hover-area',
            x: -10,
            y: -10,
            width: bounds.w + 20,
            height: bounds.h + 20,
            rx: 20
          })
        );
        if (node.type === 'note') {
          const color = node.appearance?.color || '#ffcc70',
            ink = noteInk(color);
          rect.style.fill = color;
          rect.style.stroke = color;
          g.append(
            svg(
              'text',
              {
                x: 12,
                y: 25,
                fill: ink,
                'font-size': 13
              },
              short(node.label, Math.floor((bounds.w - 24) / 8))
            )
          );
          const foreign = svg('foreignObject', {
            x: 10,
            y: 38,
            width: bounds.w - 20,
            height: bounds.h - 52 - nodeBadgeHeight(node, bounds.w)
          });
          const editor = el('div', {
            class: 'note-editor',
            contenteditable: 'plaintext-only',
            role: 'textbox',
            'aria-label': t('Notizinhalt'),
            'aria-multiline': 'true',
            spellcheck: 'true'
          });
          editor.style.color = ink;
          editor.textContent = node.data.text || '';
          editor.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
            selectionState.selectedEdges.clear();
            if (!selectionState.selected.has(node.id)) {
              selectionState.selected = /* @__PURE__ */ new Set([node.id]);
              for (const element of document.querySelectorAll('.node.selected'))
                element.classList.remove('selected');
              g.classList.add('selected');
              inspect();
            }
          });
          editor.addEventListener('input', () => {
            node.data.text = editor.innerText;
            change(node.id);
          });
          foreign.append(editor);
          g.append(foreign);
          const grip = svg('g', {
            class: 'note-resize',
            role: 'button',
            'aria-label': t('Notizgr\xF6\xDFe \xE4ndern')
          });
          grip.append(
            svg('rect', {
              x: bounds.w - 24,
              y: bounds.h - 24,
              width: 24,
              height: 24,
              fill: 'transparent',
              stroke: 'none'
            }),
            svg('path', {
              d: `M ${bounds.w - 16} ${bounds.h - 4} L ${bounds.w - 4} ${bounds.h - 16} M ${bounds.w - 10} ${bounds.h - 4} L ${bounds.w - 4} ${bounds.h - 10}`,
              stroke: ink,
              'stroke-width': 1.5,
              fill: 'none'
            })
          );
          grip.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            selectionState.selected = /* @__PURE__ */ new Set([node.id]);
            canvasState.drag = {
              kind: 'note-resize',
              id: node.id,
              startX: event.clientX,
              startY: event.clientY,
              width: bounds.w,
              height: node.appearance?.height || 180,
              moved: false
            };
            $('graph').setPointerCapture(event.pointerId);
            inspect();
          });
          g.append(grip);
        } else
          g.append(
            svg(
              'text',
              {
                x: 34,
                y: 23,
                fill: node.type === 'actor' ? 'var(--actor-accent)' : '#ff9d45',
                'font-size': 10,
                'letter-spacing': 1
              },
              fitNodeText(
                node.type === 'value'
                  ? nodeTitle(node)
                  : (node.type === 'actor' ? actorTitle(node) : dataLabel(node.type)).toUpperCase(),
                bounds.w - 46,
                10,
                1
              )
            ),
            svg(
              'text',
              {
                x: 12,
                y: 40,
                fill: '#e4ecf7',
                'font-size': 13
              },
              fitNodeText(
                node.type === 'value'
                  ? summary(node)
                  : node.type === 'profile'
                    ? providerName(node.data.provider) || nodeTitle(node)
                    : node.type === 'error'
                      ? diagnostic(node.data.title || nodeTitle(node))
                      : node.type === 'person'
                        ? [node.data.first_name, node.data.middle_name, node.data.last_name]
                            .filter(Boolean)
                            .join(' ') || nodeTitle(node)
                        : nodeTitle(node),
                bounds.w - 24,
                13
              )
            ),
            svg(
              'text',
              {
                x: 12,
                y: 60,
                fill: '#95a9c1',
                'font-size': 10
              },
              node.type === 'value' ? '' : short(summary(node), 34)
            )
          );
        if (node.type === 'error') {
          g.lastChild.remove();
          const words = diagnostic(node.data.message || '').split(/\s+/),
            lines = [];
          let line = '';
          for (const word of words) {
            if ((line + ' ' + word).length > 42 && line) {
              lines.push(line);
              line = word;
            } else line += (line ? ' ' : '') + word;
          }
          if (line) lines.push(line);
          for (const [i, line2] of lines.slice(0, 3).entries())
            g.append(
              svg(
                'text',
                {
                  x: 12,
                  y: 61 + i * 16,
                  fill: '#e5afb5',
                  'font-size': 10
                },
                fitNodeText(
                  line2 + (i === 2 && lines.length > 3 ? ' \u2026' : ''),
                  bounds.w - 24,
                  10
                )
              )
            );
        }
        if (node.type === 'profile') {
          g.lastChild.remove();
          for (const [index, text] of [
            node.data.identifier
              ? `${t('Identifier')}: ${node.data.identifier}`
              : t('Kein Identifier'),
            node.data.url || t('Keine \xF6ffentliche Profil-URL')
          ].entries()) {
            const line = svg(
              'text',
              {
                x: 12,
                y: 61 + index * 17,
                fill: '#95a9c1',
                'font-size': 10
              },
              fitNodeText(text, bounds.w - 24, 10)
            );
            line.append(svg('title', {}, text));
            g.append(line);
          }
        }
        if (node.type === 'location') {
          g.lastChild.remove();
          renderLocationAddress(g, node, bounds);
        }
        g.addEventListener('keydown', (event) => {
          if (
            event.target !== g ||
            persistenceState.busy ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey
          )
            return;
          let target = node;
          if (event.key.startsWith('Arrow')) {
            const horizontal = ['ArrowLeft', 'ArrowRight'].includes(event.key);
            const sign = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
            const axis = horizontal ? 'x' : 'y',
              cross = horizontal ? 'y' : 'x';
            target =
              visibleNodes
                .filter((item) => (item[axis] - node[axis]) * sign > 0)
                .sort(
                  (a, b) =>
                    Math.abs(a[axis] - node[axis]) +
                    Math.abs(a[cross] - node[cross]) * 2 -
                    (Math.abs(b[axis] - node[axis]) + Math.abs(b[cross] - node[cross]) * 2)
                )[0] || node;
          } else if (event.key === 'Home') target = visibleNodes[0];
          else if (event.key === 'End') target = visibleNodes.at(-1);
          else if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          canvasState.keyboardNode = target.id;
          if (event.key === 'Enter' || event.key === ' ') {
            if (event.shiftKey) {
              if (selectionState.selected.has(node.id)) selectionState.selected.delete(node.id);
              else selectionState.selected.add(node.id);
            } else selectionState.selected = new Set([node.id]);
            selectionState.selectedEdges.clear();
            render();
            inspect();
          } else {
            const viewport = $('graph').getBoundingClientRect(),
              bounds = nodeRect(target);
            const pan = canvasState.pan,
              margin = 28;
            const left = target.x * pan.scale + pan.x,
              top = target.y * pan.scale + pan.y;
            if (left < margin || left + bounds.w * pan.scale > viewport.width - margin)
              pan.x = viewport.width / 2 - (target.x + bounds.w / 2) * pan.scale;
            if (top < margin || top + bounds.h * pan.scale > viewport.height - margin)
              pan.y = viewport.height / 2 - (target.y + bounds.h / 2) * pan.scale;
            render();
          }
          requestAnimationFrame(() => {
            const focused = [...$('scene').querySelectorAll('.node')].find(
              (item) => item.dataset.id === target.id
            );
            focused?.focus({ preventScroll: true });
          });
        });
        g.addEventListener('pointerdown', (event) => {
          if (
            persistenceState.busy ||
            event.button > 0 ||
            canvasState.spacePressed ||
            canvasState.pinchGesture ||
            event.target.closest('.note-editor,.note-resize,.node-open,.dock')
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          canvasState.keyboardNode = node.id;
          if (event.shiftKey || canvasState.touchSelection) {
            selectionState.selected.has(node.id)
              ? selectionState.selected.delete(node.id)
              : selectionState.selected.add(node.id);
          } else if (!selectionState.selected.has(node.id))
            selectionState.selected = /* @__PURE__ */ new Set([node.id]);
          selectionState.selectedEdges.clear();
          canvasState.drag = {
            kind: 'nodes',
            startX: event.clientX,
            startY: event.clientY,
            positions: doc.nodes
              .filter((n) => selectionState.selected.has(n.id))
              .map((n) => ({
                id: n.id,
                x: n.x,
                y: n.y
              })),
            moved: false
          };
          $('graph').setPointerCapture(event.pointerId);
          render();
          inspect(event.shiftKey || canvasState.touchSelection);
        });
        nodeExtras(g, node, bounds);
        nodeIcon(g, node);
        nodePorts(g, node, bounds);
        const owner = (groupModel.nodePaths.get(node.id) || []).at(-1);
        (groupViews.get(owner) || scene).append(g);
        const old = previousPositions.get(node.id);
        if (
          old &&
          old !== g.getAttribute('transform') &&
          !canvasState.drag &&
          !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ) {
          const values = old.match(/translate\(([-\d.]+) ([-\d.]+)\)/);
          if (values)
            g.animate(
              [
                {
                  transform: `translate(${values[1]}px,${values[2]}px)`
                },
                {
                  transform: `translate(${node.x}px,${node.y}px)`
                }
              ],
              {
                duration: 170,
                easing: 'ease-out'
              }
            );
        }
      }
    }
    return { renderNodes };
  }
};
export { node_renderer_default };
export default node_renderer_default;
