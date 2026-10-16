import { icon } from '../icons.js';
import { language } from '../i18n.js';
import { t } from '../i18n.js';
import { pollJob } from '../jobs-client.js';
var plugin_settings_default = {
  name: 'plugin-settings',
  dependencies: [
    '$',
    'api',
    'applyFields',
    'button',
    'dataPluginSettings',
    'editFields',
    'el',
    'iconActionButton',
    'leaveWorkspace',
    'parameterModal',
    'pluginDisplayName',
    'pluginText',
    'providerFieldKeys',
    'refreshCatalog',
    'saveIndicator',
    'searchText',
    'show',
    'sourceOrderControl',
    'toast',
    'updateStatus'
  ],
  create({
    pluginsState,
    preferencesState,
    $,
    api,
    applyFields,
    button,
    dataPluginSettings,
    editFields,
    el,
    iconActionButton,
    leaveWorkspace,
    parameterModal,
    pluginDisplayName,
    pluginText,
    providerFieldKeys,
    refreshCatalog,
    saveIndicator,
    searchText,
    show,
    sourceOrderControl,
    toast,
    updateStatus
  }) {
    async function pluginsHome() {
      await leaveWorkspace();
      show('pluginsView');
      await refreshCatalog();
      renderInstalled();
    }
    function renderInstalled() {
      const root = $('pluginList');
      root.replaceChildren();
      const query = searchText($('pluginSearch').value),
        sections = /* @__PURE__ */ new Map();
      for (const plugin of pluginsState.catalog.filter((p) =>
        searchText(
          pluginDisplayName(p) +
            ' ' +
            p.name +
            ' ' +
            p.id +
            ' ' +
            pluginText(p, p.description || '')
        ).includes(query)
      )) {
        const row = el('article', {
            class: 'plugin-row',
            'data-plugin-row': plugin.id
          }),
          header = el('div', {
            class: 'plugin-header'
          }),
          copy = el('div', {
            class: 'plugin-copy'
          });
        copy.append(
          el('strong', {}, pluginDisplayName(plugin)),
          el(
            'p',
            {
              title: pluginText(plugin, plugin.description || '')
            },
            pluginText(plugin, plugin.description || '')
          )
        );
        let model = pluginsState.activePluginForms.get(plugin.id);
        if (
          model &&
          model.language !== language &&
          !pluginsState.pendingPluginDirty.has(plugin.id) &&
          !pluginsState.pendingPluginSaves.has(plugin.id)
        ) {
          pluginsState.activePluginForms.delete(plugin.id);
          model = null;
        }
        let form = model?.form;
        if (!form) {
          form = el('form', {
            class: 'plugin-settings'
          });
          form.id = 'plugin-settings-' + plugin.id;
          const indicator = el('span', {
              class: 'save-indicator'
            }),
            defaults = {},
            nodes = {};
          model = {
            form,
            indicator,
            defaults,
            nodes,
            version: 0,
            settings: plugin.settings,
            language
          };
          pluginsState.activePluginForms.set(plugin.id, model);
          const changed = () => {
            model.version++;
            pluginsState.pendingPluginDirty.add(plugin.id);
            saveIndicator(indicator, 'pending');
            clearTimeout(pluginsState.pendingPluginTimers.get(plugin.id));
            pluginsState.pendingPluginTimers.set(
              plugin.id,
              setTimeout(() => persistPluginForm(plugin.id), 500)
            );
          };
          form.append(el('small', {}, plugin.id + ' \xB7 ' + (plugin.version || '')));
          for (const node of plugin.nodes || [])
            nodes[node.type] = dataPluginSettings(form, plugin, node, changed);
          for (const action of plugin.actions || []) {
            form.append(el('h3', {}, pluginText(plugin, action.name)));
            const parameters = structuredClone(action.default_params || {});
            delete parameters.code;
            const actual = el('section', { class: 'plugin-config-section' }),
              preset = el('section', { class: 'plugin-default-section' });
            actual.append(
              el('h4', {}, t('Plugin-Einstellungen')),
              el(
                'p',
                { class: 'source-help' },
                t(
                  'Gilt für das gesamte Plugin, zum Beispiel Zugangsdaten und Quellenkonfiguration.'
                )
              )
            );
            preset.append(
              el('h4', {}, t('Standardwerte für neue Tools')),
              el(
                'p',
                { class: 'source-help' },
                t('Diese Werte kannst du später für jedes Tool in den Knotendetails ändern.')
              )
            );
            form.append(actual, preset);
            const sourceReader = sourceOrderControl(actual, parameters, changed, {
              profileCatalog: action.research_profiles,
              profileContainer: preset,
              translate: (key) => pluginText(plugin, key)
            });
            const data = Object.fromEntries(
              Object.entries(parameters).filter(
                ([key]) =>
                  !key.startsWith('use_') &&
                  key !== 'source_order' &&
                  key !== 'search_profiles' &&
                  !providerFieldKeys(parameters).includes(key)
              )
            );
            const settingsOnly = new Set(action.settings_only || []);
            const isSetting = (key) =>
              settingsOnly.has(key) ||
              action.parameter_schema?.[key]?.secret === true ||
              /(password|token|secret|api_key|sessionid)$/.test(key);
            const readers = [];
            for (const [container, fields] of [
              [actual, Object.fromEntries(Object.entries(data).filter(([key]) => isSetting(key)))],
              [preset, Object.fromEntries(Object.entries(data).filter(([key]) => !isSetting(key)))]
            ]) {
              readers.push(
                ...editFields(container, fields, [], (key) => pluginText(plugin, key), {
                  schema: action.parameter_schema,
                  sections: action.parameter_sections,
                  help: action.parameter_help
                })
              );
            }
            if (actual.children.length === 2) actual.remove();
            if (preset.children.length === 2) preset.remove();
            defaults[action.id] = {
              data,
              readers,
              sourceReader
            };
          }
          if (plugin.connection_action)
            form.append(
              iconActionButton(
                pluginText(plugin, plugin.connection_action.label),
                () => connectPlugin(plugin),
                'play',
                'primary wide'
              )
            );
          form.append(indicator);
          saveIndicator(indicator, 'saved');
          form.addEventListener('input', changed);
          form.addEventListener('change', changed);
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            persistPluginForm(plugin.id);
          });
        }
        form.hidden = !pluginsState.pluginSettingsOpen.has(plugin.id);
        const expand = button(
          form.hidden ? '\u25B8' : '\u25BE',
          () => {
            form.hidden = !form.hidden;
            if (form.hidden) pluginsState.pluginSettingsOpen.delete(plugin.id);
            else pluginsState.pluginSettingsOpen.add(plugin.id);
            expand.textContent = form.hidden ? '\u25B8' : '\u25BE';
            expand.setAttribute('aria-expanded', String(!form.hidden));
          },
          'plugin-expand'
        );
        expand.setAttribute('aria-label', t('Plugin-Einstellungen'));
        expand.setAttribute('aria-expanded', String(!form.hidden));
        expand.setAttribute('aria-controls', form.id);
        const remove = button(
          t('Entfernen'),
          async () => {
            if (pluginsState.pendingPluginDirty.has(plugin.id)) await persistPluginForm(plugin.id);
            if (pluginsState.pendingPluginSaves.has(plugin.id))
              throw Error(t('Bitte das Speichern abwarten.'));
            clearTimeout(pluginsState.pendingPluginTimers.get(plugin.id));
            await api('/api/plugin/remove', {
              id: plugin.id
            });
            pluginsState.activePluginForms.delete(plugin.id);
            pluginsState.pendingPluginDirty.delete(plugin.id);
            await refreshCatalog();
            renderInstalled();
          },
          'danger-filled'
        );
        header.append(expand, copy, remove);
        row.append(header, form);
        const category = plugin.actions?.length ? 'Aktoren' : 'Daten-Nodes';
        if (!sections.has(category)) {
          const section = el('section', {
            class: 'installed-plugin-section',
            'data-plugin-kind': category === 'Aktoren' ? 'actor' : 'data'
          });
          section.append(el('h2', {}, t(category)));
          const list = el('div', {
            class: 'installed-plugin-items'
          });
          section.append(list);
          sections.set(category, {
            section,
            list
          });
        }
        sections.get(category).list.append(row);
      }
      for (const category of ['Daten-Nodes', 'Aktoren'])
        if (sections.has(category)) root.append(sections.get(category).section);
      if (!root.children.length)
        root.append(el('p', {}, t('Keine passenden Plugins installiert.')));
    }
    async function persistPluginForm(id) {
      const model = pluginsState.activePluginForms.get(id);
      if (
        !model ||
        !pluginsState.pendingPluginDirty.has(id) ||
        pluginsState.pendingPluginSaves.has(id)
      )
        return;
      clearTimeout(pluginsState.pendingPluginTimers.get(id));
      pluginsState.pendingPluginSaves.add(id);
      const version = model.version;
      saveIndicator(model.indicator, 'saving');
      preferencesState.settingsError = '';
      updateStatus();
      let failed = false;
      try {
        const settings = {
          ...model.settings,
          defaults: {},
          nodes: {
            ...(model.settings?.nodes || {})
          }
        };
        for (const [type, read] of Object.entries(model.nodes || {})) settings.nodes[type] = read();
        for (const [action, item] of Object.entries(model.defaults))
          settings.defaults[action] = {
            ...applyFields(item.data, item.readers),
            ...(item.sourceReader ? item.sourceReader() : {})
          };
        await api('/api/plugin/settings', {
          id,
          settings
        });
        model.settings = settings;
        if (version === model.version) pluginsState.pendingPluginDirty.delete(id);
        await refreshCatalog();
        if (version === model.version) {
          const stored = pluginsState.catalog.find((plugin) => plugin.id === id);
          model.settings = stored?.settings || model.settings;
          for (const [actionId, form] of Object.entries(model.defaults)) {
            const defaults =
              stored?.actions.find((action) => action.id === actionId)?.default_params || {};
            for (const field of form.readers)
              if (field.control.type === 'password') {
                const key = field.path.at(-1);
                form.data[key] = defaults[key] || '';
              }
          }
        }
        saveIndicator(
          model.indicator,
          pluginsState.pendingPluginDirty.has(id) ? 'pending' : 'saved'
        );
      } catch (error) {
        failed = true;
        preferencesState.settingsError = error.message;
        saveIndicator(model.indicator, 'error', error.message);
      } finally {
        pluginsState.pendingPluginSaves.delete(id);
        updateStatus();
        if (pluginsState.pendingPluginDirty.has(id))
          pluginsState.pendingPluginTimers.set(
            id,
            setTimeout(() => persistPluginForm(id), failed ? 5e3 : 500)
          );
      }
    }
    async function openPluginSettings(id) {
      pluginsState.pluginSettingsOpen.add(id);
      await pluginsHome();
      document.querySelector('[data-plugin-row="' + CSS.escape(id) + '"]')?.scrollIntoView({
        block: 'center',
        behavior: 'smooth'
      });
    }
    async function connectPlugin(plugin) {
      const model = pluginsState.activePluginForms.get(plugin.id);
      if (model?.connecting) return;
      const control = model?.form.querySelector('button.primary.wide');
      if (model) model.connecting = true;
      const originalIcon = control?.querySelector('.ui-icon')?.cloneNode(true);
      if (control) {
        control.querySelector('.ui-icon')?.replaceWith(icon('spinner'));
        control.disabled = true;
        control.classList.add('connection-pending');
        control.setAttribute('aria-busy', 'true');
      }
      try {
        await performConnection(plugin);
      } finally {
        if (model) model.connecting = false;
        if (control) {
          if (originalIcon) control.querySelector('.ui-icon')?.replaceWith(originalIcon);
          control.disabled = false;
          control.classList.remove('connection-pending');
          control.removeAttribute('aria-busy');
        }
      }
    }
    async function performConnection(plugin) {
      if (pluginsState.pendingPluginDirty.has(plugin.id)) await persistPluginForm(plugin.id);
      if (
        pluginsState.pendingPluginDirty.has(plugin.id) ||
        pluginsState.pendingPluginSaves.has(plugin.id)
      )
        throw Error(t('Bitte das Speichern abwarten.'));
      let transient = {};
      for (let attempt = 0; attempt < 4; attempt++) {
        const submitted = await api('/api/plugin/connection', {
          request_key: Array.from(crypto.getRandomValues(new Uint8Array(24)), (n) =>
            n.toString(16).padStart(2, '0')
          ).join(''),
          id: plugin.id,
          action: plugin.connection_action.id,
          transient
        });
        const job = await pollJob(submitted.id);
        if (job.state !== 'completed')
          throw Error(t('errors.' + (job.error_code || 'execution_interrupted')));
        const result = job.result;
        if (result.input_request) {
          const values = await parameterModal(result.input_request, {});
          if (values === null) return;
          transient = values;
          continue;
        }
        if (!result.authenticated)
          throw Error((result.warnings || []).join(' \xB7 ') || t('Anmeldung fehlgeschlagen.'));
        toast(t('Instagram-Anmeldung erfolgreich.'));
        await refreshCatalog();
        return;
      }
      throw Error(t('Zu viele aufeinanderfolgende Eingabeanforderungen.'));
    }
    return { pluginsHome, renderInstalled, persistPluginForm, openPluginSettings, connectPlugin };
  }
};
export { plugin_settings_default };
export default plugin_settings_default;
