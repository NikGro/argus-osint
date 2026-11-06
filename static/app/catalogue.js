import { nodeLabels } from './labels.js';
var catalogue_default = {
  name: 'catalogue',
  dependencies: ['api', 'providerSearchKey', 'renderPalette'],
  create({
    pluginsState,
    workspaceState,
    preferencesState,
    api,
    providerSearchKey,
    renderPalette
  }) {
    async function refreshCatalog() {
      const [info, providers] = await Promise.all([api('/api/plugins'), api('/api/providers')]);
      pluginsState.providerCatalogue = providers.providers || [];
      pluginsState.providerIndex = new Map(
        pluginsState.providerCatalogue.flatMap((p) =>
          [p.id, p.name, ...p.aliases].map((name) => [providerSearchKey(name), p])
        )
      );
      pluginsState.catalog = info.plugins;
      pluginsState.dataPlugins =
        info.data_plugins || pluginsState.catalog.filter((p) => p.nodes?.length);
      pluginsState.dataTypes = /* @__PURE__ */ new Map();
      for (const plugin of pluginsState.dataPlugins)
        for (const node of plugin.nodes || [])
          pluginsState.dataTypes.set(node.type, {
            plugin,
            node,
            installed: pluginsState.catalog.some((p) => p.id === plugin.id)
          });
      for (const [type, defaults] of Object.entries(info.node_defaults || {}))
        workspaceState.templates[type] = structuredClone(defaults);
      preferencesState.appSettings.node_display_defaults =
        info.node_display_defaults || preferencesState.appSettings.node_display_defaults || {};
      if (workspaceState.project) renderPalette();
    }
    function nodePlugin(type) {
      return pluginsState.dataTypes.get(type)?.plugin;
    }
    function dataLabel(type) {
      const entry = pluginsState.dataTypes.get(type);
      return entry ? entry.node.name : nodeLabels[type] || type;
    }
    function nodeTitle(node) {
      if (node.evidence?.label_custom) return node.label;
      if (node.evidence?.label_key) return node.evidence.label_key;
      if (node.evidence?.origin === 'manual') return node.label;
      return node.label;
    }
    function pluginDisplayName(plugin) {
      return plugin.actions?.length === 1 ? plugin.actions[0].name : plugin.name;
    }
    function sourceLabel(key) {
      return (
        {
          consensus: 'Consensus',
          argus: 'Argus Web',
          sherlock: 'Sherlock',
          maigret: 'Maigret',
          holehe: 'Holehe',
          user_scanner: 'User Scanner',
          blackbird: 'Blackbird',
          phoneinfoga: 'PhoneInfoga',
          ignorant: 'Ignorant',
          toutatis: 'Toutatis',
          photon: 'Photon',
          nominatim: 'Nominatim'
        }[key] || key
      );
    }
    function newNodeLabel(type) {
      const entry = pluginsState.dataTypes.get(type);
      if (entry) return entry.node.new_label || entry.node.name;
      return (
        {
          email: 'New email',
          phone: 'New phone number',
          url: 'New URL',
          username: 'New username',
          value: 'New value',
          note: 'New note',
          location: 'New place',
          datetime: 'New date / time',
          image: 'New image',
          file: 'New file'
        }[type] || 'New information'
      );
    }
    function actorTitle(node) {
      const plugin = pluginsState.catalog.find((p) => p.id === node.data.plugin);
      return plugin?.actions.find((a) => a.id === node.data.action)?.name || node.label;
    }
    return {
      refreshCatalog,
      nodePlugin,
      dataLabel,
      nodeTitle,
      pluginDisplayName,
      sourceLabel,
      newNodeLabel,
      actorTitle
    };
  }
};
export { catalogue_default };
export default catalogue_default;
