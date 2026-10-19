import { t } from '../i18n.js';
import { displayOptions } from './labels.js';
import { icon } from '../icons.js';
var resources_default = {
  name: 'resources',
  dependencies: [
    '$',
    'api',
    'button',
    'change',
    'el',
    'locationDisplayLines',
    'makeRoomForNode',
    'nodeRect',
    'render',
    'renderNodeBadges',
    'svg',
    'toast'
  ],
  create({
    pluginsState,
    canvasState,
    workspaceState,
    $,
    api,
    button,
    change,
    el,
    locationDisplayLines,
    makeRoomForNode,
    nodeRect,
    render,
    renderNodeBadges,
    svg,
    toast
  }) {
    function safeLink(value) {
      try {
        const url = new URL(value);
        return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
      } catch {
        return null;
      }
    }
    function openLink(node) {
      const link = safeLink(node.data.value);
      if (link) window.open(link, '_blank', 'noopener,noreferrer');
      else toast(t('ui.invalid_url'));
    }
    function mapSources(kind) {
      const entry = pluginsState.dataTypes.get('location'),
        node = entry?.node,
        key = kind === 'preview' ? 'map_preview_sources' : 'map_action_sources';
      return (node?.[key] || []).filter((source) => source.enabled !== false);
    }
    function resourceActions(node) {
      if (node.type === 'location') {
        const actions = {
          google: {
            key: 'mapsButton',
            label: 'In Google Maps \xF6ffnen',
            icon: 'map',
            provider: 'google'
          },
          apple: {
            key: 'appleMapsButton',
            label: 'In Apple Maps \xF6ffnen',
            icon: 'map',
            provider: 'apple'
          },
          osm: {
            key: 'osmButton',
            label: 'In OpenStreetMap \xF6ffnen',
            icon: 'map',
            provider: 'osm'
          }
        };
        return mapSources('actions')
          .map((source) => actions[source.id])
          .filter(Boolean);
      }
      if (node.type === 'video')
        return [{ key: 'videoButton', label: 'Video öffnen', icon: 'video' }];
      return ['url', 'profile'].includes(node.type)
        ? [
            {
              key: 'openButton',
              label: 'Link \xF6ffnen',
              icon: 'external'
            }
          ]
        : node.type === 'image'
          ? [
              {
                key: 'imageButton',
                label: 'Bild anzeigen',
                icon: 'image'
              }
            ]
          : node.type === 'file'
            ? [
                {
                  key: 'fileButton',
                  label: 'Datei \xF6ffnen',
                  icon: 'file'
                }
              ]
            : [];
    }
    function displayControls(panel, node) {
      panel.append(el('h3', {}, t('ui.quick_actions_glances')));
      for (const action of resourceActions(node))
        panel.append(
          button(t(action.label), () => openNodeResource(node, action.provider), 'quick-action')
        );
      if (node.type === 'location') {
        const box = el('div', {
          class: 'detail-map'
        });
        panel.append(box);
        refreshDetailMap(panel, node);
      }
      for (const [key, text] of (displayOptions[node.type] || []).filter(
        ([key2]) =>
          !['mapsButton', 'appleMapsButton', 'osmButton'].includes(key2) ||
          resourceActions(node).some((a) => a.key === key2)
      )) {
        const label = el('label', {
            class: 'checkbox-label'
          }),
          checkbox = el('input', {
            type: 'checkbox'
          });
        checkbox.checked = Boolean(node.display?.[key]);
        label.append(checkbox, document.createTextNode(t(text)));
        checkbox.addEventListener('change', async () => {
          if (
            node.type === 'image' &&
            key === 'preview' &&
            checkbox.checked &&
            !node.data.file_id &&
            node.data.url
          ) {
            checkbox.disabled = true;
            try {
              const cached = await api('/api/media/store', { url: node.data.url });
              node.data.file_id = cached.file_id;
            } catch (error) {
              checkbox.checked = false;
              toast(error.message);
              return;
            } finally {
              checkbox.disabled = false;
            }
          }
          node.display = {
            ...node.display,
            [key]: checkbox.checked
          };
          canvasState.groupBoundsCache = null;
          makeRoomForNode(node);
          change(node.id);
          render();
        });
        panel.append(label);
      }
    }
    function locationQuery(node) {
      const d = node.data;
      if (
        d.latitude !== null &&
        d.latitude !== '' &&
        d.longitude !== null &&
        d.longitude !== '' &&
        Number.isFinite(Number(d.latitude)) &&
        Number.isFinite(Number(d.longitude))
      )
        return Number(d.latitude) + ',' + Number(d.longitude);
      return (
        d.formatted_address ||
        d.original_input ||
        [d.street, d.house_number, d.postal_code, d.locality, d.admin_area_1, d.country]
          .filter(Boolean)
          .join(' ')
      );
    }
    function mapsUrl(node, embed = false, provider = 'google') {
      if (!locationQuery(node)) return null;
      if (embed) {
        const source = mapSources('preview')[0];
        if (!source) return null;
        const d = node.data;
        return (
          '/api/map-preview?' +
          new URLSearchParams({
            provider: source.id,
            lat: d.latitude ?? '',
            lon: d.longitude ?? '',
            q: locationQuery(node) || ''
          })
        );
      }
      const query = locationQuery(node);
      if (!query) return null;
      if (provider === 'apple') return 'https://maps.apple.com/?q=' + encodeURIComponent(query);
      if (provider === 'osm') {
        const d = node.data,
          hasCoords =
            d.latitude !== null &&
            d.latitude !== '' &&
            d.longitude !== null &&
            d.longitude !== '' &&
            Number.isFinite(Number(d.latitude)) &&
            Number.isFinite(Number(d.longitude));
        return hasCoords
          ? 'https://www.openstreetmap.org/?mlat=' +
              Number(d.latitude) +
              '&mlon=' +
              Number(d.longitude) +
              '#map=16/' +
              Number(d.latitude) +
              '/' +
              Number(d.longitude)
          : 'https://www.openstreetmap.org/search?query=' + encodeURIComponent(query);
      }
      return (
        (embed
          ? 'https://maps.google.com/maps?output=embed&z=14&q='
          : 'https://www.google.com/maps/search/?api=1&query=') + encodeURIComponent(query)
      );
    }
    function openNodeResource(node, provider = 'google') {
      if (node.type === 'profile') {
        if (safeResourceUrl(node.data.url))
          openLink({
            data: {
              value: node.data.url
            }
          });
        else toast(t('ui.no_public_profile_url'));
        return;
      }
      if (node.type === 'image' && !node.data.file_id && safeResourceUrl(node.data.url)) {
        window.open(safeResourceUrl(node.data.url), '_blank', 'noopener,noreferrer');
        return;
      }
      if (node.type === 'url') {
        openLink(node);
        return;
      }
      const url =
        ['image', 'file', 'video'].includes(node.type) && node.data.file_id
          ? '/api/files/' + encodeURIComponent(node.data.file_id)
          : node.type === 'location'
            ? mapsUrl(node, false, provider)
            : null;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      else toast(t('ui.no_displayable_data_yet'));
    }
    function refreshDetailMap(panel, node) {
      const box = panel.querySelector('.detail-map');
      if (!box) return;
      const src = mapsUrl(node, true);
      if (!src) {
        box.replaceChildren(el('p', {}, t('ui.enter_a_location_to_display_the_map')));
        return;
      }
      let frame = box.querySelector('iframe');
      if (!frame) {
        frame = el('iframe', {
          class: 'embedded-map',
          title: t('ui.map_preview'),
          loading: 'lazy',
          referrerpolicy: 'no-referrer'
        });
        box.replaceChildren(frame);
      }
      if (frame.getAttribute('src') !== src) frame.src = src;
    }
    function safeResourceUrl(value) {
      try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
          ? '/api/media?url=' + encodeURIComponent(url.href)
          : '';
      } catch {
        return '';
      }
    }
    function nodeExtras(g, node, bounds) {
      renderNodeBadges(g, node, bounds);
      const actions = resourceActions(node).filter((a) => node.display?.[a.key]),
        start = bounds.h - actions.length * 48;
      actions.forEach((action, index) => {
        const y = start + index * 48,
          b = svg('g', {
            class: 'node-open',
            role: 'button',
            tabindex: 0,
            'aria-label': t(action.label)
          });
        b.append(
          svg('rect', {
            x: 12,
            y,
            width: bounds.w - 24,
            height: 36,
            rx: 4
          })
        );
        const glyph = icon(action.icon);
        for (const [key, value] of Object.entries({
          x: 22,
          y: y + 9,
          width: 18,
          height: 18
        }))
          glyph.setAttribute(key, value);
        b.append(
          glyph,
          svg(
            'text',
            {
              x: 48,
              y: y + 18,
              'font-size': 11,
              'dominant-baseline': 'central'
            },
            t(action.label)
          )
        );
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          openNodeResource(node, action.provider);
        });
        b.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') openNodeResource(node, action.provider);
        });
        g.append(b);
      });
      if (
        node.type === 'image' &&
        node.display?.preview &&
        (node.data.file_id || safeResourceUrl(node.data.url))
      ) {
        const clip = svg('clipPath', {
          id: 'preview-' + node.id
        });
        clip.append(
          svg('rect', {
            x: 8,
            y: 80,
            width: bounds.w - 16,
            height: 120,
            rx: 8
          })
        );
        g.append(
          clip,
          svg('image', {
            x: 8,
            y: 80,
            width: bounds.w - 16,
            height: 120,
            href: node.data.file_id
              ? '/api/files/' + encodeURIComponent(node.data.file_id)
              : safeResourceUrl(node.data.url),
            'clip-path': 'url(#preview-' + node.id + ')',
            preserveAspectRatio: 'xMidYMid slice'
          })
        );
      }
    }
    function updateMapOverlays(hidden) {
      const root = $('mapOverlays');
      if (!root) return;
      const keep = /* @__PURE__ */ new Set();
      for (const node of workspaceState.project.document.nodes) {
        if (node.type !== 'location' || !node.display?.map || hidden.has(node.id)) continue;
        const src = mapsUrl(node, true);
        if (!src) continue;
        keep.add(node.id);
        let wrap = root.querySelector('[data-map-node="' + node.id + '"]');
        if (!wrap) {
          wrap = el('div', {
            class: 'node-map',
            'data-map-node': node.id
          });
          wrap.append(
            el('iframe', {
              class: 'embedded-map',
              title: t('ui.map_preview'),
              referrerpolicy: 'no-referrer',
              loading: 'lazy'
            })
          );
          root.append(wrap);
        }
        const frame = wrap.firstChild;
        if (frame.getAttribute('src') !== src) frame.src = src;
        wrap.style.width = nodeRect(node).w - 16 + 'px';
        wrap.style.height = '210px';
        wrap.style.transform = `translate(${canvasState.pan.x + (node.x + 8) * canvasState.pan.scale}px,${canvasState.pan.y + (node.y + Math.max(76, 64 + locationDisplayLines(node.data, nodeRect(node).w).length * 16)) * canvasState.pan.scale}px) scale(${canvasState.pan.scale})`;
      }
      for (const node of workspaceState.project.document.nodes) {
        if (
          node.type !== 'video' ||
          !node.display?.preview ||
          !node.data.file_id ||
          hidden.has(node.id)
        )
          continue;
        keep.add(node.id);
        let wrap = root.querySelector('[data-map-node="' + node.id + '"]');
        if (!wrap) {
          wrap = el('div', { class: 'node-video', 'data-map-node': node.id });
          const video = el('video', {
            controls: '',
            preload: 'metadata',
            'aria-label': node.label
          });
          video.src = '/api/files/' + encodeURIComponent(node.data.file_id);
          wrap.append(video);
          root.append(wrap);
          for (const name of ['pointerdown', 'wheel', 'dblclick'])
            wrap.addEventListener(name, (e) => e.stopPropagation());
        }
        const videoSource = '/api/files/' + encodeURIComponent(node.data.file_id);
        if (wrap.firstChild.getAttribute('src') !== videoSource) wrap.firstChild.src = videoSource;
        wrap.style.width = nodeRect(node).w - 24 + 'px';
        wrap.style.height = '144px';
        wrap.style.transform = `translate(${canvasState.pan.x + (node.x + 12) * canvasState.pan.scale}px,${canvasState.pan.y + (node.y + 64) * canvasState.pan.scale}px) scale(${canvasState.pan.scale})`;
      }
      for (const wrap of [...root.children]) if (!keep.has(wrap.dataset.mapNode)) wrap.remove();
    }
    return {
      safeLink,
      openLink,
      mapSources,
      resourceActions,
      displayControls,
      locationQuery,
      mapsUrl,
      openNodeResource,
      refreshDetailMap,
      safeResourceUrl,
      nodeExtras,
      updateMapOverlays
    };
  }
};
export { resources_default };
export default resources_default;
