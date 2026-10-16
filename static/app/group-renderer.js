import { t } from '../i18n.js';
var group_renderer_default = {
  name: 'group-renderer',
  dependencies: [
    '$',
    'change',
    'groupBounds',
    'groupNodeIds',
    'groupTitle',
    'inspectGroup',
    'moveGroup',
    'render',
    'short',
    'startGroupDrag',
    'svg',
    'toggleGroup'
  ],
  create({
    selectionState,
    persistenceState,
    $,
    change,
    groupBounds,
    groupNodeIds,
    groupTitle,
    inspectGroup,
    moveGroup,
    render,
    short,
    startGroupDrag,
    svg,
    toggleGroup
  }) {
    function renderGroups({ scene, groupModel, groupViews, groupEdges }) {
      for (const group of groupModel.groups) {
        const b = groupBounds(group);
        const g = svg('g', {
          class:
            'group' +
            (group.collapsed ? ' collapsed' : '') +
            (selectionState.selectedGroups.has(group.id) ? ' selected' : ''),
          'data-group': group.id,
          tabindex: 0,
          role: 'group',
          'aria-label': group.label
        });
        g.append(
          svg('rect', {
            x: b.x,
            y: b.y,
            width: group.collapsed ? 220 : b.w,
            height: group.collapsed ? 76 : b.h,
            rx: 10
          })
        );
        for (const x of [b.x, b.x + (group.collapsed ? 220 : b.w)])
          g.append(
            svg('circle', {
              class: 'group-port',
              cx: x,
              cy: b.y + (group.collapsed ? 76 : b.h) / 2,
              r: 5
            })
          );
        const toggle = svg('g', {
          class: 'group-toggle',
          role: 'button',
          tabindex: 0,
          'aria-label': (group.collapsed ? t('Aufklappen: ') : t('Einklappen: ')) + group.label,
          'aria-expanded': String(!group.collapsed)
        });
        toggle.append(
          svg('rect', {
            x: b.x + 4,
            y: b.y + 4,
            width: 28,
            height: 28,
            rx: 5
          }),
          svg(
            'text',
            {
              x: b.x + 18,
              y: b.y + 19,
              'text-anchor': 'middle',
              'dominant-baseline': 'central',
              'font-size': 20
            },
            group.collapsed ? '\u25B8' : '\u25BE'
          )
        );
        toggle.addEventListener('pointerdown', (e) => e.stopPropagation());
        toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleGroup(group);
        });
        toggle.addEventListener('keydown', (e) => {
          if (['Enter', ' '].includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            toggleGroup(group);
          }
        });
        g.append(
          toggle,
          svg(
            'text',
            {
              class: 'group-title',
              x: b.x + 39,
              y: b.y + 23,
              'font-size': 12
            },
            short(
              groupTitle(group),
              group.collapsed ? 23 : Math.max(20, Math.floor((b.w - 45) / 8))
            )
          )
        );
        if (group.collapsed)
          g.append(
            svg(
              'text',
              {
                x: b.x + 12,
                y: b.y + 50,
                'font-size': 11
              },
              groupNodeIds(group).size + t(' Datenknoten \xB7 Ziehen zum Verschieben')
            )
          );
        g.addEventListener('pointerdown', (e) => startGroupDrag(group, e));
        g.addEventListener('keydown', (e) => {
          if (e.target !== g) return;
          const delta = {
            ArrowLeft: [-10, 0],
            ArrowRight: [10, 0],
            ArrowUp: [0, -10],
            ArrowDown: [0, 10]
          }[e.key];
          if (!delta || persistenceState.busy) return;
          e.preventDefault();
          moveGroup(group, ...delta);
          change();
          render();
          $('scene')
            .querySelector('[data-group="' + group.id + '"]')
            .focus();
        });
        g.addEventListener('click', (e) => {
          if (e.target.closest('.node,.edge-hit,.edge-edit,.edge-delete')) return;
          e.stopPropagation();
          if (e.shiftKey && !selectionState.selectedGroups.has(group.id)) return;
          inspectGroup(group);
        });
        groupViews.set(group.id, g);
        if (!group.collapsed) {
          const defs = svg('defs'),
            clip = svg('clipPath', {
              id: 'group-edges-' + group.id,
              clipPathUnits: 'userSpaceOnUse'
            });
          clip.append(
            svg('rect', {
              x: b.x,
              y: b.y + 30,
              width: b.w,
              height: Math.max(0, b.h - 30),
              rx: 8
            })
          );
          defs.append(clip);
          const layer = svg('g', {
            class: 'group-internal-edges'
          });
          g.append(defs, layer);
          groupEdges.set(group.id, layer);
        }
        const parentView = groupViews.get(group.parent_id);
        (parentView || scene).append(g);
      }
    }
    return { renderGroups };
  }
};
export { group_renderer_default };
export default group_renderer_default;
