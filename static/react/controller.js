/** UI-independent command registry. React supplies view callbacks; domains keep their stores. */
import * as features from '../main.js';
import { flushSync } from 'react-dom';
import UI from '../ui.js';
import { t } from '../i18n.js';

export function createController() {
  const state = features.createState();
  const listeners = new Set();
  let revision = 0,
    frame = null;
  const ui = { view: 'home', message: '', dialog: null, ready: false, activeGroup: null };
  const methods = {};
  const emit = () => {
    revision++;
    for (const listener of listeners) listener();
  };
  const redraw = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      emit();
    });
  };
  function dialog(request) {
    if (ui.dialog) return Promise.reject(Error('Please close the current dialog first.'));
    return new Promise((resolve) => {
      ui.dialog = { ...request, resolve };
      emit();
    });
  }
  const overrides = {
    render: () => {
      state.canvasState.groupBoundsCache = null;
      redraw();
    },
    renderPalette: redraw,
    renderProjects: redraw,
    renderInstalled: redraw,
    saveButtons: redraw,
    updateStatus: redraw,
    async checkBackend() {
      try {
        const response = await fetch('/api/health', {
          signal: AbortSignal.timeout(5000),
          cache: 'no-store'
        });
        state.shellState.backendOnline = response.ok && (await response.json()).status === 'ok';
      } catch {
        state.shellState.backendOnline = false;
      }
      state.shellState.backendCheckAt = new Date();
      redraw();
    },
    historyButtons: redraw,
    updateDeleteButtons: redraw,
    applyGraphHighlights: redraw,
    panelVisibility: redraw,
    renderTagManager: redraw,
    settingsState: redraw,
    renderDisplayDefaults: redraw,
    renderLogs: redraw,
    inspect(preserveGroups = false) {
      if (!preserveGroups) {
        state.selectionState.selectedGroup = null;
        state.selectionState.selectedGroups.clear();
        ui.activeGroup = null;
      }
      const key = [...state.selectionState.selected, ...state.selectionState.selectedEdges]
        .sort()
        .join(',');
      overrides.inspectorAvailability(key);
      redraw();
    },
    inspectorAvailability(key) {
      if (key && key !== state.selectionState.inspectorSelectionKey)
        state.canvasState.rightCollapsed = false;
      if (!key) state.canvasState.rightCollapsed = true;
      state.selectionState.inspectorSelectionKey = key;
      redraw();
    },
    inspectGroup(group) {
      state.selectionState.selectedGroup = group.id;
      ui.activeGroup = group.id;
      overrides.inspectorAvailability('group:' + group.id);
    },
    show(view) {
      ui.view = view;
      document.body.classList.toggle('workspace-mode', view === 'workspace');
      flushSync(emit);
      window.scrollTo(0, 0);
    },
    toast(message) {
      ui.message = String(message || '');
      redraw();
      clearTimeout(ui.toastTimer);
      ui.toastTimer = setTimeout(() => {
        ui.message = '';
        redraw();
      }, 6000);
    },
    modalChoice: (title, message, choices) => dialog({ title, message, choices }),
    parameterModal: (request, values = {}) => dialog({ ...request, values, mode: 'fields' }),
    askText: (title, label, value = '') => dialog({ title, mode: 'text', label, value }),
    askConfirm: (title, message) => dialog({ title, message, mode: 'confirm' }),
    async pluginsHome() {
      await methods.leaveWorkspace();
      await methods.refreshCatalog();
      overrides.show('pluginsView');
    },
    async settingsHome() {
      await methods.leaveWorkspace();
      const data = await methods.api('/api/settings');
      state.preferencesState.appSettings = data.settings;
      ui.languages = data.languages;
      overrides.show('settingsView');
    },
    async openPluginSettings(id) {
      state.pluginsState.pluginSettingsOpen.add(id);
      await overrides.pluginsHome();
    },
    async openLogs() {
      await methods.save();
      overrides.show('logsView');
    },
    renderViewport() {
      const { x, y, scale } = state.canvasState.pan;
      document
        .getElementById('scene')
        ?.setAttribute('transform', `translate(${x} ${y}) scale(${scale})`);
      document
        .getElementById('grid')
        ?.setAttribute('patternTransform', `translate(${x} ${y}) scale(${scale})`);
      const zoom = document.getElementById('zoomLevel');
      if (zoom) zoom.value = Math.round(scale * 100) + '%';
    },
    selectEdge(id, add = false) {
      const selection = state.selectionState,
        ids = methods.edgeBundleIds(id);
      const remove = add && ids.every((key) => selection.selectedEdges.has(key));
      if (!add) selection.selectedEdges.clear();
      for (const key of ids)
        remove ? selection.selectedEdges.delete(key) : selection.selectedEdges.add(key);
      selection.selected.clear();
      selection.selectedGroup = null;
      selection.selectedGroups.clear();
      overrides.inspect();
      redraw();
    },
    async home() {
      await methods.leaveWorkspace();
      state.libraryState.projectIndex = await methods.api('/api/projects');
      ui.activeGroup = null;
      overrides.show('home');
    },
    async setArchived(project, archived) {
      await methods.api('/api/projects/' + project.id + '/archive', {
        archived,
        revision: project.revision
      });
      state.libraryState.projectIndex = await methods.api('/api/projects');
      redraw();
    },
    async deleteProject(project) {
      if (!(await overrides.askConfirm(t('ui.delete_project'), project.title))) return;
      await methods.api('/api/projects/' + project.id + '/delete', { revision: project.revision });
      state.libraryState.projectIndex = await methods.api('/api/projects');
      redraw();
    }
  };
  const domains = features.createApplication(state, overrides);
  Object.assign(methods, domains.commands);
  Object.assign(methods, overrides);
  UI.configure({ notice: (request) => dialog({ ...request, mode: 'notice' }) });
  return {
    state,
    ui,
    commands: methods,
    redraw,
    emit,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => revision,
    settle(value) {
      const request = ui.dialog;
      ui.dialog = null;
      emit();
      request?.resolve(value);
    },
    async safely(action) {
      try {
        return await action();
      } catch (error) {
        overrides.toast(error.message);
      }
    }
  };
}
