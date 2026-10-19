import { language } from '../i18n.js';
import { systemLogs } from '../system-logs.js';
import { vpnSettings } from '../vpn-settings.js';
import { setLanguage } from '../i18n.js';
import { t } from '../i18n.js';
import { decorateStaticIcons } from '../icons.js';
import { buttonContent } from '../icons.js';
var settings_default = {
  name: 'settings',
  dependencies: [
    '$',
    'api',
    'askText',
    'el',
    'iconActionButton',
    'leaveWorkspace',
    'renderProjects',
    'saveIndicator',
    'show',
    'toast',
    'uid',
    'updateStatus'
  ],
  create({
    preferencesState,
    $,
    api,
    askText,
    el,
    iconActionButton,
    leaveWorkspace,
    renderProjects,
    saveIndicator,
    show,
    toast,
    uid,
    updateStatus
  }) {
    async function settingsHome() {
      await leaveWorkspace();
      const data = await api('/api/settings');
      show('settingsView');
      preferencesState.appSettings = data.settings;
      $('languageSelect').replaceChildren(
        ...data.languages.map((lang) =>
          el(
            'option',
            {
              value: lang.code
            },
            lang.name
          )
        )
      );
      $('languageSelect').value = preferencesState.appSettings.language;
      renderDisplayDefaults();
      renderTagManager();
      preferencesState.settingsDirty = false;
      settingsState();
      systemLogs($('systemLogs'), { api, el, iconActionButton, toast });
      vpnSettings($('vpnSettings'), { api, el, iconActionButton, toast });
    }
    function settingsState() {
      $('settingsSave').hidden = true;
      saveIndicator(
        $('settingsSave'),
        preferencesState.settingsPromise
          ? 'saving'
          : preferencesState.settingsError
            ? 'error'
            : preferencesState.settingsDirty
              ? 'pending'
              : 'saved',
        preferencesState.settingsError
      );
      updateStatus();
    }
    function renderDisplayDefaults() {
      $('displayDefaults').replaceChildren();
    }
    async function persistLanguage() {
      if (preferencesState.settingsPromise) return preferencesState.settingsPromise;
      const languageChoice = $('languageSelect').value,
        defaults = structuredClone(preferencesState.appSettings.node_display_defaults || {});
      for (const input of $('displayDefaults').querySelectorAll('input')) {
        defaults[input.dataset.displayType] ??= {};
        defaults[input.dataset.displayType][input.dataset.displayKey] = input.checked;
      }
      const sentTags = structuredClone(preferencesState.appSettings.tags || []),
        signature = JSON.stringify({
          language: languageChoice,
          node_display_defaults: defaults,
          tags: sentTags
        });
      preferencesState.settingsError = '';
      preferencesState.settingsPromise = api('/api/settings', JSON.parse(signature))
        .then(async (saved) => {
          const newerTags = preferencesState.appSettings.tags;
          const tagsChanged = JSON.stringify(newerTags || []) !== JSON.stringify(sentTags);
          if (!tagsChanged)
            for (const tag of newerTags || []) {
              const stored = saved.tags?.find((item) => item.id === tag.id);
              if (stored) Object.assign(tag, stored);
            }
          preferencesState.appSettings = {
            ...preferencesState.appSettings,
            ...saved,
            tags: newerTags || saved.tags || []
          };
          const priorLanguage = language;
          await setLanguage(saved.language);
          if (priorLanguage !== saved.language) renderTagManager();
          decorateStaticIcons();
          const now = {
            language: $('languageSelect').value,
            node_display_defaults: structuredClone(saved.node_display_defaults),
            tags: structuredClone(preferencesState.appSettings.tags || [])
          };
          for (const input of $('displayDefaults').querySelectorAll('input'))
            now.node_display_defaults[input.dataset.displayType][input.dataset.displayKey] =
              input.checked;
          preferencesState.settingsDirty = JSON.stringify(now) !== signature;
          renderProjects();
        })
        .catch((error) => {
          preferencesState.settingsError = error.message;
          preferencesState.settingsDirty = true;
          throw error;
        })
        .finally(() => {
          preferencesState.settingsPromise = null;
          settingsState();
          if (preferencesState.settingsDirty) {
            clearTimeout(preferencesState.pendingSettingsTimer);
            preferencesState.pendingSettingsTimer = setTimeout(
              () => persistLanguage().catch((error) => toast(error.message)),
              preferencesState.settingsError ? 5e3 : 150
            );
          }
        });
      settingsState();
      return preferencesState.settingsPromise;
    }
    function scheduleGlobalSettings() {
      preferencesState.settingsDirty = true;
      settingsState();
      clearTimeout(preferencesState.pendingSettingsTimer);
      preferencesState.pendingSettingsTimer = setTimeout(
        () => persistLanguage().catch((error) => toast(error.message)),
        500
      );
    }
    function renderTagManager() {
      let root = $('globalTagManager');
      if (!root) {
        root = el('section', {
          id: 'globalTagManager'
        });
        $('displayDefaults').after(root);
      }
      root.replaceChildren(el('h2', {}, t('ui.global_tags')));
      const list = el('div');
      for (const tag of preferencesState.appSettings.tags || []) {
        const row = el('div', {
            class: 'tag-manager-row',
            'data-global-tag': tag.id
          }),
          name = el('input', {
            type: 'text',
            maxlength: 40,
            'aria-label': t('ui.tag_name')
          }),
          color = el('input', {
            type: 'color',
            'aria-label': t('ui.tag_color')
          });
        name.value = tag.name;
        color.value = tag.color;
        name.addEventListener('input', () => {
          tag.name = name.value;
          scheduleGlobalSettings();
        });
        color.addEventListener('input', () => {
          tag.color = color.value;
          scheduleGlobalSettings();
        });
        const remove = iconActionButton(
          t('ui.delete_tag'),
          () => {
            preferencesState.appSettings.tags = preferencesState.appSettings.tags.filter(
              (item) => item.id !== tag.id
            );
            renderTagManager();
            scheduleGlobalSettings();
          },
          'trash',
          'danger-filled'
        );
        buttonContent(remove, t('ui.delete_tag'), 'trash', true);
        row.append(name, color, remove);
        list.append(row);
      }
      root.append(
        list,
        iconActionButton(
          t('ui.add_tag'),
          async () => {
            const value = await askText(t('ui.create_tag'), t('ui.tag_name'), '');
            if (!value?.trim()) return;
            if (
              (preferencesState.appSettings.tags || []).some(
                (tag) => tag.name.toLocaleLowerCase() === value.trim().toLocaleLowerCase()
              )
            )
              throw Error(t('ui.a_tag_with_this_name_already_exists'));
            preferencesState.appSettings.tags = [
              ...(preferencesState.appSettings.tags || []),
              {
                id: uid(),
                name: value.trim(),
                color: '#8799b2'
              }
            ];
            renderTagManager();
            scheduleGlobalSettings();
          },
          'plus'
        )
      );
    }
    return {
      settingsHome,
      settingsState,
      renderDisplayDefaults,
      persistLanguage,
      scheduleGlobalSettings,
      renderTagManager
    };
  }
};
export { settings_default };
export default settings_default;
