import { icon } from '../icons.js';
import ArgusSelect from '../searchable-select.js';
import { t } from '../i18n.js';
var tags_default = {
  name: 'tags',
  dependencies: [
    'change',
    'el',
    'fitNodeText',
    'makeRoomForNode',
    'measureEdgeText',
    'render',
    'resourceActions',
    'svg'
  ],
  create({
    preferencesState,
    canvasState,
    change,
    el,
    fitNodeText,
    makeRoomForNode,
    measureEdgeText,
    render,
    resourceActions,
    svg
  }) {
    function nodeBadgeRows(node, width) {
      if (node.type === 'actor') return [];
      const status = ['unverified', 'unclear', 'verified'].includes(node.verification)
          ? node.verification
          : 'unverified',
        states = {
          unverified: {
            name: t('Unverifiziert'),
            color: '#e66a78'
          },
          unclear: {
            name: t('Unklar'),
            color: '#eab65c'
          },
          verified: {
            name: t('Verifiziert'),
            color: '#6fc58c'
          }
        },
        items = [
          states[status],
          ...(preferencesState.appSettings.tags || []).filter((tag) =>
            (node.tags || []).includes(tag.id)
          )
        ],
        rows = [[]];
      let used = 0;
      for (const item of items) {
        const size = Math.min(width - 24, 24 + Math.ceil((measureEdgeText(item.name) * 10) / 11));
        if (used && used + size > width - 24) {
          rows.push([]);
          used = 0;
        }
        rows.at(-1).push({
          ...item,
          x: 12 + used,
          w: size
        });
        used += size + 5;
      }
      return rows;
    }
    function nodeBadgeHeight(node, width) {
      const rows = nodeBadgeRows(node, width);
      return rows.length ? rows.length * 22 + 8 : 0;
    }
    function renderNodeBadges(g, node, bounds) {
      const rows = nodeBadgeRows(node, bounds.w);
      if (!rows.length) return;
      const start =
          bounds.h -
          resourceActions(node).filter((a) => node.display?.[a.key]).length * 32 -
          nodeBadgeHeight(node, bounds.w),
        group = svg('g', {
          class: 'node-badges'
        });
      for (const [index, row] of rows.entries())
        for (const tag of row) {
          const color = /^#[0-9a-f]{6}$/i.test(tag.color) ? tag.color : '#8799b2',
            y = start + index * 22;
          group.append(
            svg('rect', {
              x: tag.x,
              y,
              width: tag.w,
              height: 18,
              rx: 5,
              fill: color + '32',
              stroke: color,
              'stroke-width': 0.7
            }),
            svg('circle', {
              cx: tag.x + 7,
              cy: y + 9,
              r: 2.5,
              fill: color
            }),
            svg(
              'text',
              {
                x: tag.x + 14,
                y: y + 12,
                'font-size': 10,
                fill: '#e4ecf7'
              },
              fitNodeText(tag.name, tag.w - 19, 10)
            )
          );
        }
      g.append(group);
    }
    function reviewControls(panel, node) {
      const section = el('section', {
        class: 'node-review'
      });
      section.append(el('h3', {}, t('Verifizierung')));
      const status = el('select', {
        class: 'verification-select',
        'aria-label': t('Verifizierung')
      });
      for (const [value, label] of [
        ['unverified', 'Unverifiziert'],
        ['unclear', 'Unklar'],
        ['verified', 'Verifiziert']
      ])
        status.append(
          el(
            'option',
            {
              value
            },
            t(label)
          )
        );
      status.value = node.verification || 'unverified';
      status.addEventListener('change', () => {
        node.verification = status.value;
        canvasState.groupBoundsCache = null;
        makeRoomForNode(node);
        change(node.id);
        render();
      });
      section.append(status);
      const list = el('div', {
        class: 'node-tag-options'
      });
      list.append(el('h3', {}, t('Tags')));
      const allTags = preferencesState.appSettings.tags || [];
      const picker = el('select', { 'aria-label': t('Tag hinzufügen') });
      const badges = el('div', { class: 'selected-tag-badges' });
      list.append(badges, picker);
      function updateTags() {
        canvasState.groupBoundsCache = null;
        makeRoomForNode(node);
        change(node.id);
        render();
        paintTags();
      }
      function paintTags() {
        badges.replaceChildren();
        picker.replaceChildren(el('option', { value: '' }, t('Tag hinzufügen …')));
        for (const tag of allTags) {
          if (!(node.tags || []).includes(tag.id)) {
            picker.append(el('option', { value: tag.id }, tag.name));
            continue;
          }
          const badge = el('span', { class: 'selected-tag-badge' });
          badge.append(el('span', { class: 'tag-label' }, tag.name));
          if (/^#[0-9a-f]{6}$/i.test(tag.color)) badge.style.setProperty('--tag-color', tag.color);
          const remove = el('button', {
            type: 'button',
            class: 'tag-remove borderless danger-text',
            'aria-label': t('Tag entfernen') + ': ' + tag.name,
            title: t('Tag entfernen')
          });
          remove.append(icon('close'));
          remove.addEventListener('click', () => {
            node.tags = (node.tags || []).filter((id) => id !== tag.id);
            updateTags();
          });
          badge.append(remove);
          badges.append(badge);
        }
        picker.disabled = !allTags.some((tag) => !(node.tags || []).includes(tag.id));
        ArgusSelect.refresh(picker);
      }
      picker.addEventListener('change', () => {
        if (!allTags.some((tag) => tag.id === picker.value)) return;
        node.tags = [...new Set([...(node.tags || []), picker.value])];
        updateTags();
      });
      paintTags();
      if (!allTags.length)
        list.append(
          el('p', { class: 'source-help' }, t('Globale Tags in den Einstellungen anlegen.'))
        );
      section.append(list);
      panel.append(section);
    }
    return { nodeBadgeRows, nodeBadgeHeight, renderNodeBadges, reviewControls };
  }
};
export { tags_default };
export default tags_default;
