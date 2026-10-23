import layout_spec_default from '../layout-spec.json';
import { t } from '../i18n.js';
import { language } from '../i18n.js';
var canvas_renderer_default = {
  name: 'canvas-renderer',
  dependencies: [
    'formatLocation',
    'graphGroupModel',
    'locationDisplayLines',
    'nodeBadgeHeight',
    'pluginText',
    'resourceActions'
  ],
  create({
    workspaceState,
    canvasState,
    pluginsState,
    executionState,
    selectionState,
    formatLocation,
    graphGroupModel,
    locationDisplayLines,
    nodeBadgeHeight,
    pluginText,
    resourceActions
  }) {
    function nodeRect(node) {
      const size = layout_spec_default[node.type] || layout_spec_default.base;
      let w = size.width,
        h = size.height;
      if (['note', 'marker'].includes(node.type)) {
        w = node.appearance?.width || w;
        h = node.appearance?.height || h;
      }
      if (node.type === 'video' && node.display?.preview)
        h = layout_spec_default.videoPreviewHeight;
      if (node.type === 'image' && node.display?.preview)
        h = layout_spec_default.imagePreviewHeight;
      if (node.type === 'location') {
        h = Math.max(
          size.height,
          76 + (Math.min(5, locationDisplayLines(node.data || {}, w).length) - 1) * size.line
        );
        if (
          node.display?.map &&
          (formatLocation(node.data || {}) ||
            node.data.formatted_address ||
            node.data.original_input ||
            (node.data.latitude !== null &&
              node.data.latitude !== '' &&
              node.data.latitude !== undefined &&
              node.data.longitude !== null &&
              node.data.longitude !== '' &&
              node.data.longitude !== undefined))
        )
          h += layout_spec_default.mapHeight;
      }
      h += nodeBadgeHeight(node, w);
      h +=
        layout_spec_default.quickActionHeight *
        resourceActions(node).filter((a) => node.display?.[a.key]).length;
      return {
        x: node.x,
        y: node.y,
        w,
        h,
        inputCount:
          node.type === 'actor'
            ? Math.max(
                1,
                pluginsState.catalog
                  .find((p) => p.id === node.data.plugin)
                  ?.actions.find((a) => a.id === node.data.action)?.min_inputs || 1
              )
            : 1
      };
    }
    function dataIcon(type) {
      if (pluginsState.dataTypes.get(type)?.node.icon)
        return pluginsState.dataTypes.get(type).node.icon;
      return (
        {
          video: 'video',
          email: 'email',
          phone: 'phone',
          username: 'account',
          url: 'link',
          location: 'map',
          note: 'note',
          image: 'image',
          file: 'file',
          datetime: 'calendar',
          value: 'value'
        }[type] || 'nodes'
      );
    }
    function actorIcon(plugin, action) {
      return (
        pluginsState.catalog.find((p) => p.id === plugin)?.actions.find((a) => a.id === action)
          ?.icon ||
        pluginsState.catalog.find((p) => p.id === plugin)?.icon ||
        {
          email: 'email-search',
          phone: 'phone-search',
          username: 'account-search',
          holehe: 'email-search',
          phoneinfoga: 'phone-search',
          profiles: 'account-search',
          maigret: 'account-search',
          location: 'map-search',
          metadata: 'file',
          transform: 'code'
        }[plugin] ||
        'plugin'
      );
    }
    function summary(n) {
      if (n.type === 'database') return n.data.database_title || t('ui.choose_database');
      if (n.type === 'actor')
        return executionState.activeActors.has(n.id)
          ? t('ui.running')
          : executionState.actorQueue.some((job) => job.id === n.id)
            ? t('ui.queued')
            : t(n.data.status) || t('ui.ready_7f2ffe9a');
      if (n.type === 'person')
        return [
          n.data.birth_date,
          n.data.birth_place,
          n.data.birth_country
            ? /^[A-Z]{2}$/.test(n.data.birth_country)
              ? new Intl.DisplayNames([language], {
                  type: 'region'
                }).of(n.data.birth_country)
              : n.data.birth_country
            : ''
        ]
          .filter(Boolean)
          .join(' \xB7 ');
      if (n.type === 'error') return n.data.message || '';
      if (n.type === 'profile')
        return [n.data.identifier, n.data.url].filter(Boolean).join(' \xB7 ');
      if (n.type === 'datetime')
        return [n.data.date, n.data.time, n.data.timezone].filter(Boolean).join(' \xB7 ');
      if (n.type === 'location')
        return formatLocation(n.data) || n.data.formatted_address || t('ui.location');
      return (
        (n.type === 'value' && n.evidence?.run_id
          ? pluginText(
              pluginsState.catalog.find((p) => p.id === n.evidence.plugin),
              n.data.value
            )
          : n.data.value) ??
        n.data.text ??
        n.data.filename ??
        Object.keys(n.data).join(', ')
      );
    }
    function short(s, n = 27) {
      return String(s).length > n ? String(s).slice(0, n - 1) + '\u2026' : String(s);
    }
    function measureEdgeText(text) {
      if (!measureEdgeText.context) {
        const canvas = document.createElement('canvas');
        measureEdgeText.context = canvas.getContext('2d');
      }
      const context = measureEdgeText.context;
      if (!context) return text.length * 7;
      context.font = '11px ' + (measureEdgeText.font || 'sans-serif');
      const cache = measureEdgeText.cache || (measureEdgeText.cache = new Map());
      if (!cache.has(text)) cache.set(text, context.measureText(text).width);
      return cache.get(text);
    }
    function fitNodeText(value, width, size = 13, spacing = 0) {
      const text = String(value);
      const measure = (label) =>
        (measureEdgeText(label) * size) / 11 + Math.max(0, label.length - 1) * spacing;
      if (measure(text) <= width) return text;
      let out = '';
      for (const char of text) {
        if (measure(out + char + '\u2026') > width) break;
        out += char;
      }
      return out + '\u2026';
    }
    function edgeBundleIds(id) {
      if (!workspaceState.project) return [id];
      const model = graphGroupModel(),
        edge = workspaceState.project.document.edges.find((e) => e.id === id),
        visual = edge && model.connection(edge);
      if (!visual) return edge ? [id] : [];
      return workspaceState.project.document.edges
        .filter((e) => model.connection(e)?.key === visual.key)
        .map((e) => e.id);
    }
    return {
      nodeRect,
      dataIcon,
      actorIcon,
      summary,
      short,
      measureEdgeText,
      fitNodeText,
      edgeBundleIds
    };
  }
};
export { canvas_renderer_default };
export default canvas_renderer_default;
