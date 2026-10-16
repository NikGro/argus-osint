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
      $('projectCount').textContent = visible.length + t(' Projekte');
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
            p.archived_at ? t('Archiviert') : t('Aktives Projekt')
          )
        );
        const actions = el('div', {
          class: 'tile-actions'
        });
        if (p.archived_at) {
          actions.append(
            button(t('Wiederherstellen'), () => setArchived(p, false)),
            button(t('L\xF6schen'), () => deleteProject(p), 'danger-filled')
          );
        } else
          actions.append(
            button(t('\xD6ffnen'), () => openProject(p.id), 'primary'),
            button(t('Archivieren'), () => setArchived(p, true), 'archive-action')
          );
        const rename = button(t('Titel bearbeiten'), async () => {
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
        buttonContent(rename, t('Titel bearbeiten'), 'edit', true);
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
              ? t('Keine passenden Projekte gefunden.')
              : libraryState.homeMode === 'archive'
                ? t('Das Archiv ist leer.')
                : t('Noch keine Projekte vorhanden.')
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
      toast(archived ? t('Projekt archiviert.') : t('Projekt wiederhergestellt.'));
    }
    async function deleteProject(p) {
      if (
        !(await askConfirm(
          t('Projekt l\xF6schen'),
          '\u201E' + p.title + t('\u201C endg\xFCltig aus dem Archiv l\xF6schen?')
        ))
      )
        return;
      await api('/api/projects/' + p.id + '/delete', {
        revision: p.revision
      });
      libraryState.projectIndex = await api('/api/projects');
      renderProjects();
      toast(t('Projekt gel\xF6scht.'));
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
