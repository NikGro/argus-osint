import layout_spec_default from '../layout-spec.json';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { language } from '../i18n.js';
var canvas_renderer_default = {
  name: 'canvas-renderer',
  dependencies: [
    '$',
    'formatLocation',
    'graphGroupModel',
    'groupNodeIds',
    'inspect',
    'locationDisplayLines',
    'nodeBadgeHeight',
    'noteInk',
    'pluginText',
    'renderEdges',
    'renderGroups',
    'renderNodes',
    'resourceActions',
    'svg',
    'updateMapOverlays'
  ],
  create({
    workspaceState,
    canvasState,
    pluginsState,
    executionState,
    selectionState,
    $,
    formatLocation,
    graphGroupModel,
    groupNodeIds,
    inspect,
    locationDisplayLines,
    nodeBadgeHeight,
    noteInk,
    pluginText,
    renderEdges,
    renderGroups,
    renderNodes,
    resourceActions,
    svg,
    updateMapOverlays
  }) {
    function render() {
      if (!workspaceState.project) return;
      canvasState.groupBoundsCache = null;
      if ($('zoomLevel')) $('zoomLevel').value = Math.round(canvasState.pan.scale * 100) + '%';
      const scene = $('scene');
      const previousPositions = new Map(
        [...scene.querySelectorAll('.node')].map((g) => [g.dataset.id, g.getAttribute('transform')])
      );
      scene.replaceChildren();
      $('grid').setAttribute(
        'patternTransform',
        `translate(${canvasState.pan.x} ${canvasState.pan.y}) scale(${canvasState.pan.scale})`
      );
      scene.setAttribute(
        'transform',
        `translate(${canvasState.pan.x} ${canvasState.pan.y}) scale(${canvasState.pan.scale})`
      );
      const doc = workspaceState.project.document,
        hidden = /* @__PURE__ */ new Map(),
        groupModel = graphGroupModel(),
        groupViews = /* @__PURE__ */ new Map(),
        groupEdges = /* @__PURE__ */ new Map(),
        labelsByContext = /* @__PURE__ */ new Map(),
        externalEdges = svg('g', {
          class: 'external-edges'
        }),
        labelOverlay = svg('g', {
          class: 'edge-label-overlay'
        });
      scene.append(externalEdges, labelOverlay);
      for (const id of groupModel.hidden) hidden.set(id, true);
      renderGroups({ scene, groupModel, groupViews, groupEdges });
      renderEdges({
        doc,
        hidden,
        groupModel,
        groupEdges,
        externalEdges,
        labelOverlay,
        labelsByContext
      });
      renderNodes({ doc, hidden, groupModel, groupViews, scene, previousPositions });
      for (const view of groupViews.values())
        for (const control of [...view.children].filter(
          (n) => n.classList.contains('group-toggle') || n.classList.contains('group-title')
        ))
          view.append(control);
      scene.append(labelOverlay);
      applyGraphHighlights(groupModel);
      updateMapOverlays(hidden);
    }
    function nodeRect(node) {
      const size = layout_spec_default[node.type] || layout_spec_default.base;
      let w = size.width,
        h = size.height;
      if (['note', 'marker'].includes(node.type)) {
        w = node.appearance?.width || w;
        h = node.appearance?.height || h;
      }
      if (node.type === 'image' && node.display?.preview)
        h = layout_spec_default.imagePreviewHeight;
      if (node.type === 'location') {
        h = Math.max(
          size.height,
          size.header + locationDisplayLines(node.data || {}, w).length * size.line
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
    function nodeIcon(g, node) {
      const n = icon(node.type === 'actor' ? actorIcon(node.data.plugin) : dataIcon(node.type));
      n.setAttribute('x', 11);
      n.setAttribute('y', node.type === 'note' ? 12 : 10);
      n.setAttribute('width', 16);
      n.setAttribute('height', 16);
      n.style.color =
        node.type === 'note'
          ? noteInk(node.appearance?.color || '#ffcc70')
          : node.type === 'actor'
            ? 'var(--actor-accent)'
            : '#ff9d45';
      g.append(n);
      if (node.type === 'note') g.querySelector('text').setAttribute('x', 34);
    }
    function dataIcon(type) {
      if (pluginsState.dataTypes.get(type)?.node.icon)
        return pluginsState.dataTypes.get(type).node.icon;
      return (
        {
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
    function actorIcon(plugin) {
      return (
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
      if (n.type === 'actor')
        return executionState.activeActors.has(n.id)
          ? t('L\xE4uft \u2026')
          : executionState.actorQueue.some((job) => job.id === n.id)
            ? t('In Warteschlange')
            : t(n.data.status) || t('bereit');
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
        return formatLocation(n.data) || n.data.formatted_address || t('Standortangabe');
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
      context.font = '11px ' + getComputedStyle(document.body).fontFamily;
      return context.measureText(text).width;
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
    function selectEdge(id, add = false) {
      const ids = edgeBundleIds(id),
        remove = add && ids.every((id2) => selectionState.selectedEdges.has(id2));
      if (!add) selectionState.selectedEdges.clear();
      for (const edge of ids)
        if (remove) selectionState.selectedEdges.delete(edge);
        else selectionState.selectedEdges.add(edge);
      selectionState.selected.clear();
      selectionState.selectedGroup = null;
      selectionState.selectedGroups.clear();
      render();
      inspect();
    }
    function applyGraphHighlights(providedModel = null) {
      if (!workspaceState.project) return;
      const connected = /* @__PURE__ */ new Set(),
        model = providedModel || graphGroupModel(),
        bundles = /* @__PURE__ */ new Map(),
        byId = new Map(workspaceState.project.document.edges.map((e) => [e.id, e]));
      for (const edge of workspaceState.project.document.edges) {
        const visual = model.connection(edge);
        if (!visual) continue;
        if (!bundles.has(visual.key)) bundles.set(visual.key, []);
        bundles.get(visual.key).push(edge);
        if (selectionState.selectedEdges.has(edge.id)) {
          connected.add(edge.source);
          connected.add(edge.target);
        }
      }
      for (const path of $('scene').querySelectorAll('[data-edge-path]')) {
        const edge = byId.get(path.dataset.edgePath),
          visual = edge && model.connection(edge),
          bundle = visual ? bundles.get(visual.key) || [] : [];
        path.classList.toggle(
          'highlighted',
          bundle.some(
            (e) =>
              selectionState.selected.has(e.source) ||
              selectionState.selected.has(e.target) ||
              selectionState.selectedEdges.has(e.id)
          )
        );
        path.classList.toggle(
          'selected-edge',
          bundle.some((e) => selectionState.selectedEdges.has(e.id))
        );
        if (path.dataset.hasArrow === 'true')
          path.style.markerEnd =
            'url(#' + (path.classList.contains('highlighted') ? 'arrow-highlight' : 'arrow') + ')';
      }
      for (const label of $('scene').querySelectorAll('[data-edge-label]'))
        label.classList.toggle(
          'edge-selected',
          selectionState.selectedEdges.has(label.dataset.edgeLabel)
        );
      for (const node of $('scene').querySelectorAll('.node'))
        node.classList.toggle('edge-connected', connected.has(node.dataset.id));
      for (const group of $('scene').querySelectorAll('.group')) {
        const item = workspaceState.project.document.groups.find(
          (g) => g.id === group.dataset.group
        );
        group.classList.toggle(
          'edge-connected',
          Boolean(connected.size && item && [...groupNodeIds(item)].some((id) => connected.has(id)))
        );
      }
    }
    return {
      render,
      nodeRect,
      nodeIcon,
      dataIcon,
      actorIcon,
      summary,
      short,
      measureEdgeText,
      fitNodeText,
      edgeBundleIds,
      selectEdge,
      applyGraphHighlights
    };
  }
};
export { canvas_renderer_default };
export default canvas_renderer_default;
