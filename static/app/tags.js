import { t } from '../i18n.js';
var tags_default = {
  name: 'tags',
  dependencies: ['measureEdgeText'],
  create({ preferencesState, canvasState, measureEdgeText }) {
    function nodeBadgeRows(node, width) {
      if (['actor', 'marker'].includes(node.type)) return [];
      const status = ['unverified', 'unclear', 'verified'].includes(node.verification)
          ? node.verification
          : 'unverified',
        states = {
          unverified: {
            name: t('ui.unverified'),
            color: '#e66a78'
          },
          unclear: {
            name: t('ui.unclear'),
            color: '#eab65c'
          },
          verified: {
            name: t('ui.verified'),
            color: '#6fc58c'
          }
        },
        items = [
          ...(['note', 'error'].includes(node.type) ? [] : [states[status]]),
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
      const rows = nodeBadgeRows(node, width).filter((row) => row.length);
      return rows.length ? rows.length * 22 + 8 : 0;
    }
    return { nodeBadgeRows, nodeBadgeHeight };
  }
};
export { tags_default };
export default tags_default;
