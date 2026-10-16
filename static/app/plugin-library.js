import { t } from '../i18n.js';
var plugin_library_default = {
  name: 'plugin-library',
  dependencies: [
    '$',
    'api',
    'askConfirm',
    'button',
    'el',
    'pluginDisplayName',
    'pluginText',
    'refreshCatalog',
    'renderInstalled',
    'searchText'
  ],
  create({
    pluginsState,
    $,
    api,
    askConfirm,
    button,
    el,
    pluginDisplayName,
    pluginText,
    refreshCatalog,
    renderInstalled,
    searchText
  }) {
    async function refreshLibrary() {
      const info = await api('/api/plugin-library');
      pluginsState.libraryItems = info.plugins;
      pluginsState.repositories = info.repositories;
    }
    async function openLibrary() {
      await refreshLibrary();
      renderLibrary();
      $('libraryDialog').showModal();
    }
    function renderLibrary() {
      const root = $('libraryList');
      root.replaceChildren();
      const query = searchText($('librarySearch').value);
      for (const plugin of pluginsState.libraryItems.filter((p) =>
        searchText(
          t(p.name) + ' ' + p.name + ' ' + p.id + ' ' + pluginText(p, p.description || '')
        ).includes(query)
      )) {
        const row = el('article', {
          class: 'plugin-row'
        });
        row.append(
          el('h3', {}, pluginDisplayName(plugin)),
          el('p', {}, pluginText(plugin, plugin.description || '')),
          el('small', {}, plugin.origin === 'builtin' ? t('Mitgeliefert') : t('Community'))
        );
        const install = button(
          plugin.installed ? t('Installiert') : t('Installieren'),
          async () => {
            if (plugin.origin === 'community') {
              const accepted = await askConfirm(
                t('Community-Plugin installieren'),
                t(
                  'Der Python-Code dieses Repositories wird im Argus-Container ausgef\xFChrt. Nur vertrauensw\xFCrdige Repositories installieren.'
                )
              );
              if (!accepted) return;
            }
            install.disabled = true;
            install.setAttribute('aria-busy', 'true');
            install.textContent = t('Wird installiert …');
            try {
              await api('/api/plugin/install', {
                id: plugin.id
              });
              await refreshCatalog();
              await refreshLibrary();
              renderLibrary();
              renderInstalled();
            } finally {
              install.disabled = false;
              install.removeAttribute('aria-busy');
              if (install.isConnected) install.textContent = t('Installieren');
            }
          },
          'primary'
        );
        install.disabled = plugin.installed;
        row.append(install);
        root.append(row);
      }
      if (!root.children.length)
        root.append(el('p', { class: 'empty-state' }, t('Keine passenden Plugins gefunden.')));
    }
    async function openRepositories() {
      await refreshLibrary();
      renderRepositories();
      $('reposDialog').showModal();
    }
    function renderRepositories() {
      const root = $('repoList');
      root.replaceChildren();
      for (const repo of pluginsState.repositories) {
        const row = el('article', {
          class: 'plugin-row'
        });
        row.append(
          el('strong', {}, repo.url),
          el('p', {}, t(repo.error) || repo.manifest.plugins.length + t(' Plugins'))
        );
        row.append(
          button(t('Aktualisieren'), async () => {
            await api('/api/repositories/refresh', {
              id: repo.id
            });
            await refreshLibrary();
            renderRepositories();
            renderLibrary();
          }),
          button(
            t('Entfernen'),
            async () => {
              await api('/api/repositories/remove', {
                id: repo.id
              });
              await refreshLibrary();
              renderRepositories();
              renderLibrary();
            },
            'danger-filled'
          )
        );
        root.append(row);
      }
      if (!pluginsState.repositories.length)
        root.append(el('p', {}, t('Noch keine Community-Repositories hinzugef\xFCgt.')));
    }
    return { refreshLibrary, openLibrary, renderLibrary, openRepositories, renderRepositories };
  }
};
export { plugin_library_default };
export default plugin_library_default;
