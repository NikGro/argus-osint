import { t } from '../i18n.js';
var resources_default = {
  name: 'resources',
  dependencies: ['toast'],
  create({ pluginsState, canvasState, workspaceState, toast }) {
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
    return {
      safeLink,
      openLink,
      mapSources,
      resourceActions,
      locationQuery,
      mapsUrl,
      openNodeResource,
      safeResourceUrl
    };
  }
};
export { resources_default };
export default resources_default;
