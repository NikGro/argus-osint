var bindings_navigation_default = {
  name: 'bindNavigation',
  dependencies: [
    '$',
    'api',
    'bind',
    'draggableDialog',
    'home',
    'openLibrary',
    'openProject',
    'openRepositories',
    'persistLanguage',
    'pluginsHome',
    'refreshLibrary',
    'renderInstalled',
    'renderLibrary',
    'renderProjects',
    'renderRepositories',
    'settingsHome',
    'settingsState',
    'toast'
  ],
  create({
    libraryState,
    preferencesState,
    $,
    api,
    bind,
    draggableDialog,
    home,
    openLibrary,
    openProject,
    openRepositories,
    persistLanguage,
    pluginsHome,
    refreshLibrary,
    renderInstalled,
    renderLibrary,
    renderProjects,
    renderRepositories,
    settingsHome,
    settingsState,
    toast
  }) {
    function bindNavigation() {
      bind('homeActive', () => {
        libraryState.homeMode = 'active';
        renderProjects();
      });
      bind('homeArchive', () => {
        libraryState.homeMode = 'archive';
        renderProjects();
      });
      $('homeSearch').addEventListener('input', () => {
        libraryState.homeQueries[libraryState.homeMode] = $('homeSearch').value;
        renderProjects();
        $('homeSearch').focus();
      });
      bind('brandHome', home);
      bind('projectsTab', home);
      bind('back', home);
      bind('newProject', () => {
        $('newProjectTitle').value = '';
        $('projectDialog').style.transform = '';
        $('projectDialog').dataset.dx = 0;
        $('projectDialog').dataset.dy = 0;
        $('projectDialog').showModal();
        $('newProjectTitle').focus();
      });
      bind('cancelProject', () => $('projectDialog').close());
      $('createProjectForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = $('newProjectTitle').value.trim();
        if (!title) return;
        try {
          const p = await api('/api/projects', {
            title
          });
          $('projectDialog').close();
          await openProject(p.id);
        } catch (error) {
          toast(error.message);
        }
      });
      bind('pluginsTab', pluginsHome);
      bind('settingsTab', settingsHome);
      bind('addPlugin', () => openLibrary());
      bind('manageRepos', () => openRepositories());
      $('pluginSearch').addEventListener('input', renderInstalled);
      $('librarySearch').addEventListener('input', renderLibrary);
      for (const id of ['libraryDialog', 'reposDialog']) {
        draggableDialog($(id));
        $(id)
          .querySelector('[data-close]')
          .addEventListener('click', () => $(id).close());
      }
      $('repoForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = $('repoAdd');
        button.disabled = true;
        try {
          await api('/api/repositories/add', {
            url: $('repoUrl').value
          });
          $('repoUrl').value = '';
          await refreshLibrary();
          renderRepositories();
        } catch (error) {
          toast(error.message);
        } finally {
          button.disabled = false;
        }
      });
      $('settingsForm').addEventListener('submit', (event) => {
        event.preventDefault();
        persistLanguage().catch((error) => toast(error.message));
      });
      $('languageSelect').addEventListener('change', () => {
        preferencesState.settingsDirty = true;
        settingsState();
        clearTimeout(preferencesState.pendingSettingsTimer);
        preferencesState.pendingSettingsTimer = setTimeout(
          () => persistLanguage().catch((error) => toast(error.message)),
          150
        );
      });
    }
    return { bindNavigation };
  }
};
export { bindings_navigation_default };
export default bindings_navigation_default;
