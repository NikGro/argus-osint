import { t } from '../i18n.js';
import { language } from '../i18n.js';
import { buttonContent } from '../icons.js';
var projects_default = {
  name: 'projects',
  dependencies: [
    '$',
    'api',
    'askConfirm',
    'button',
    'el',
    'historyButtons',
    'inspect',
    'panelVisibility',
    'parameterModal',
    'projectSnapshot',
    'render',
    'save',
    'saveButtons',
    'searchText',
    'show',
    'toast',
    'updateStatus'
  ],
  create({
    libraryState,
    persistenceState,
    workspaceState,
    selectionState,
    canvasState,
    historyState,
    $,
    api,
    askConfirm,
    button,
    el,
    historyButtons,
    inspect,
    panelVisibility,
    parameterModal,
    projectSnapshot,
    render,
    save,
    saveButtons,
    searchText,
    show,
    toast,
    updateStatus
  }) {
    function renderProjects() {
      const query = searchText(libraryState.homeQueries[libraryState.homeMode]);
      $('homeSearch').value = libraryState.homeQueries[libraryState.homeMode];
      $('homeActive').classList.toggle('active', libraryState.homeMode === 'active');
      $('homeArchive').classList.toggle('active', libraryState.homeMode === 'archive');
      $('newProject').hidden = false;
      const visible = libraryState.projectIndex.filter(
        (p) =>
          Boolean(p.archived_at) === (libraryState.homeMode === 'archive') &&
          searchText(p.title).includes(query)
      );
      $('projectCount').textContent = visible.length + t('ui.projects_ef54f9a8');
      $('projectList').replaceChildren();
      for (const p of visible) {
        const tile = el('article', {
          class: 'tile project-tile',
          'data-project': p.id
        });
        const date = p.archived_at || p.updated_at;
        tile.append(
          el('small', {}, new Date(date).toLocaleString(language)),
          el(
            'h2',
            {
              title: p.title
            },
            p.title
          ),
          el(
            'p',
            {
              class: 'project-kind'
            },
            p.archived_at ? t('ui.archived') : t('ui.active_project')
          )
        );
        const actions = el('div', {
          class: 'tile-actions'
        });
        if (p.archived_at) {
          actions.append(
            button(t('ui.restore'), () => setArchived(p, false)),
            button(t('ui.delete'), () => deleteProject(p), 'danger-filled')
          );
        } else
          actions.append(
            button(t('ui.open_bc385a30'), () => openProject(p.id), 'primary'),
            button(t('ui.archive_a54c8deb'), () => setArchived(p, true), 'archive-action')
          );
        const rename = button(t('ui.edit_title'), async () => {
          const result = await parameterModal(
            {
              title: 'Projekttitel bearbeiten',
              fields: [{ key: 'title', label: 'Projekttitel', required: true, maxLength: 200 }]
            },
            { title: p.title }
          );
          if (!result?.title?.trim()) return;
          await api('/api/projects/' + p.id + '/rename', {
            title: result.title.trim(),
            revision: p.revision
          });
          libraryState.projectIndex = await api('/api/projects');
          renderProjects();
        });
        buttonContent(rename, t('ui.edit_title'), 'edit', true);
        actions.insertBefore(rename, actions.children[1] || null);
        tile.append(actions);
        $('projectList').append(tile);
      }
      if (!visible.length)
        $('projectList').append(
          el(
            'p',
            {
              class: 'empty-state'
            },
            query
              ? t('ui.no_matching_projects_found')
              : libraryState.homeMode === 'archive'
                ? t('ui.the_archive_is_empty')
                : t('ui.no_projects_yet')
          )
        );
    }
    async function setArchived(p, archived) {
      await api('/api/projects/' + p.id + '/archive', {
        archived,
        revision: p.revision
      });
      libraryState.projectIndex = await api('/api/projects');
      renderProjects();
      toast(archived ? t('ui.project_archived') : t('ui.project_restored'));
    }
    async function deleteProject(p) {
      if (
        !(await askConfirm(
          t('ui.delete_project'),
          '\u201E' + p.title + t('ui.permanently_from_the_archive')
        ))
      )
        return;
      await api('/api/projects/' + p.id + '/delete', {
        revision: p.revision
      });
      libraryState.projectIndex = await api('/api/projects');
      renderProjects();
      toast(t('ui.project_deleted'));
    }
    async function home() {
      if (persistenceState.dirty) await save();
      clearTimeout(persistenceState.autosaveTimer);
      persistenceState.dirtyNodes.clear();
      persistenceState.dirty = false;
      show('home');
      workspaceState.project = null;
      libraryState.projectIndex = await api('/api/projects');
      renderProjects();
      updateStatus();
    }
    async function openProject(id) {
      workspaceState.project = await api('/api/projects/' + id);
      selectionState.selected.clear();
      selectionState.selectedEdges.clear();
      persistenceState.dirtyNodes.clear();
      persistenceState.saveError = '';
      persistenceState.dirty = false;
      canvasState.pan = {
        x: 60,
        y: 70,
        scale: 1
      };
      $('projectTitle').textContent = workspaceState.project.title;
      show('workspace');
      selectionState.inspectorSelectionKey = '';
      canvasState.rightCollapsed = true;
      panelVisibility();
      updateStatus();
      workspaceState.lastServerSnapshot = structuredClone(workspaceState.project.document);
      workspaceState.lastServerTitle = workspaceState.project.title;
      historyState.lastSnapshot = projectSnapshot();
      historyState.undoStack = [];
      historyState.redoStack = [];
      render();
      inspect();
      saveButtons();
      historyButtons();
    }
    async function leaveWorkspace() {
      if (persistenceState.dirty) await save();
      clearTimeout(persistenceState.autosaveTimer);
      workspaceState.project = null;
      persistenceState.dirty = false;
      selectionState.selectedGroup = null;
      selectionState.selected.clear();
    }
    return { renderProjects, setArchived, deleteProject, home, openProject, leaveWorkspace };
  }
};
export { projects_default };
export default projects_default;
