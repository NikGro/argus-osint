import { t } from '../i18n.js';
import { setLanguage } from '../i18n.js';
import ui_default from '../ui.js';
import { icon } from '../icons.js';
import { buttonContent } from '../icons.js';
import { decorateStaticIcons } from '../icons.js';
var shell_default = {
  name: 'shell',
  dependencies: [
    'api',
    'cancelConnection',
    'home',
    'refreshCatalog',
    'setupProviderDismissal',
    'startJobMonitor'
  ],
  create({
    shellState,
    executionState,
    persistenceState,
    preferencesState,
    pluginsState,
    workspaceState,
    canvasState,
    selectionState,
    api,
    cancelConnection,
    home,
    refreshCatalog,
    setupProviderDismissal,
    startJobMonitor
  }) {
    function toast(msg) {
      $('toast').textContent = t(msg);
      $('toast').hidden = false;
      clearTimeout(toast.timer);
      toast.timer = setTimeout(() => ($('toast').hidden = true), 6e3);
    }
    function finishDialog(accepted) {
      const request = shellState.dialogRequest;
      if (!request) return;
      shellState.dialogRequest = null;
      const value =
        request.mode === 'confirm' ? accepted : accepted ? $('inputDialogValue').value : null;
      $('inputDialog').close();
      request.resolve(value);
    }
    function appDialog(mode, title, message, value = '') {
      if (shellState.dialogRequest)
        return Promise.reject(Error(t('Bitte zuerst das offene Fenster schlie\xDFen.')));
      return new Promise((resolve) => {
        shellState.dialogRequest = {
          mode,
          resolve
        };
        $('inputDialogTitle').textContent = title;
        $('inputDialogMessage').textContent = message;
        $('inputDialogLabel').textContent = message;
        $('inputDialogLabel').hidden = mode === 'confirm';
        $('inputDialogMessage').hidden = mode === 'text';
        $('inputDialogValue').hidden = mode === 'confirm';
        $('inputDialogValue').value = value;
        $('inputDialogSubmit').textContent =
          mode === 'confirm' ? t('Best\xE4tigen') : t('\xDCbernehmen');
        $('inputDialog').style.transform = '';
        $('inputDialog').dataset.dx = 0;
        $('inputDialog').dataset.dy = 0;
        $('inputDialog').showModal();
        (mode === 'confirm' ? $('inputDialogCancel') : $('inputDialogValue')).focus();
      });
    }
    const askText = (title, label, value) => appDialog('text', title, label, value);
    const askConfirm = (title, message) => appDialog('confirm', title, message);
    function draggableDialog(...args) {
      return ui_default.draggableDialog(...args);
    }
    function saveIndicator(element, state, error = '') {
      if (!element) return;
      element.replaceChildren(
        icon(
          state === 'saving'
            ? 'spinner'
            : state === 'saved'
              ? 'check'
              : state === 'error'
                ? 'logs'
                : 'save'
        ),
        document.createTextNode(
          t(
            state === 'saving'
              ? 'Speichert \u2026'
              : state === 'saved'
                ? 'Gespeichert'
                : state === 'error'
                  ? 'Speichern fehlgeschlagen'
                  : 'Noch zu speichern'
          )
        )
      );
      const glyph = element.querySelector('svg');
      if (state === 'saved' && glyph) glyph.setAttribute('viewBox', '3.5 5.5 18 14');
      element.dataset.state = state;
      element.title = error;
      element.classList.add('save-indicator');
      element.setAttribute('role', 'status');
    }
    function el(...args) {
      return ui_default.el(...args);
    }
    function svg(...args) {
      return ui_default.svg(...args);
    }
    function button(...args) {
      return ui_default.button(...args);
    }
    function show(view) {
      if (view !== 'workspace') {
        $('mapOverlays')?.replaceChildren();
        cancelConnection();
      }
      for (const id of [
        'home',
        'workspace',
        'pluginsView',
        'settingsView',
        'reportView',
        'logsView'
      ])
        if ($(id)) $(id).hidden = id !== view;
      document.body.classList.toggle('workspace-mode', view === 'workspace');
      $('projectHeading').hidden = view !== 'workspace';

      $('projectsTab').classList.toggle(
        'active',
        ['home', 'workspace', 'reportView', 'logsView'].includes(view)
      );
      $('pluginsTab').classList.toggle('active', view === 'pluginsView');
      $('settingsTab')?.classList.toggle('active', view === 'settingsView');
    }
    function searchText(value) {
      return String(value)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase();
    }
    function decorateButton(button2, label) {
      if (label === t('L\xE4uft \u2026')) {
        buttonContent(button2, label, 'spinner', false, true);
        return;
      }
      const trash = [
        t('Knoten l\xF6schen'),
        t('L\xF6schen'),
        t('Entfernen'),
        t('Plugin entfernen')
      ].includes(label);
      const name = trash
        ? 'trash'
        : label === t('Archivieren')
          ? 'archive'
          : label === t('Wiederherstellen')
            ? 'restore'
            : label === t('Einstellungen speichern')
              ? 'save'
              : label === t('\xD6ffnen')
                ? 'file'
                : label === t('Link \xF6ffnen')
                  ? 'link'
                  : null;
      buttonContent(button2, label, name, trash || label === t('Archivieren'));
    }
    function iconActionButton(text, fn, glyph, cls) {
      const b = button(text, fn, cls);
      buttonContent(b, text, glyph);
      return b;
    }
    function bind(id, fn) {
      $(id).addEventListener('click', () =>
        Promise.resolve()
          .then(fn)
          .catch((e) => toast(e.message))
      );
    }
    function modalChoice(...args) {
      return ui_default.modalChoice(...args);
    }
    function parameterModal(...args) {
      return ui_default.parameterModal(...args);
    }
    function updateStatus() {
      if ($('cancelActor')) $('cancelActor').hidden = !executionState.currentActorJob;
      if ($('actorActivity')) {
        const running = executionState.queueRunning || executionState.actorQueue.length > 0;
        $('actorActivity').hidden = false;
        $('actorActivity').classList.toggle('inactive', !running);
        $('actorActivity').replaceChildren(
          icon('spinner'),
          el(
            'span',
            {
              class: 'actor-current',
              title: executionState.currentActorJob?.label || ''
            },
            t(executionState.vpnWaiting ? 'Warte auf VPN' : 'Aktor wird ausgef\xFChrt')
          ),
          ...(executionState.actorQueue.length
            ? [
                el(
                  'span',
                  {
                    class: 'queue-count'
                  },
                  ' | ' + t('Wartend') + ': ' + (executionState.actorQueue.length || 0)
                )
              ]
            : [])
        );
      }
      if (!$('statusLight')) return;
      let state = 'yellow',
        label = t('Verbindung wird gepr\xFCft');
      if (shellState.backendOnline === false) {
        state = 'red';
        label = t('Backend nicht erreichbar');
      } else if (persistenceState.saveError || preferencesState.settingsError) {
        state = 'red';
        label = t('Speichern fehlgeschlagen');
      } else if (
        persistenceState.savePromise ||
        preferencesState.settingsPromise ||
        pluginsState.pendingPluginSaves.size
      ) {
        label = t('Speichert \u2026');
      } else if (persistenceState.dirty || preferencesState.settingsDirty) {
        label = t('Noch zu speichern');
      } else if (shellState.backendOnline === true) {
        state = 'green';
        label =
          workspaceState.project || !$('settingsView').hidden ? t('Gespeichert') : t('Verbunden');
      }
      $('statusLight').dataset.state = state;
      $('statusText').textContent = label;
      $('status').title =
        label +
        (shellState.backendCheckAt
          ? ' \xB7 ' +
            t('Letzte Pr\xFCfung') +
            ': ' +
            shellState.backendCheckAt.toLocaleTimeString()
          : '');
    }
    async function checkBackend() {
      try {
        const response = await fetch('/api/health', {
          signal: AbortSignal.timeout(5e3),
          cache: 'no-store'
        });
        const body = await response.json();
        shellState.backendOnline = response.ok && body.status === 'ok';
      } catch {
        shellState.backendOnline = false;
      }
      shellState.backendCheckAt = /* @__PURE__ */ new Date();
      updateStatus();
    }
    function panelVisibility() {
      if (!$('palette')) return;
      $('palette').hidden = canvasState.leftCollapsed;
      $('leftResize').hidden = canvasState.leftCollapsed;
      $('inspector').hidden = canvasState.rightCollapsed;
      $('rightResize').hidden = canvasState.rightCollapsed;
      $('toggleLeft').replaceChildren(
        icon(canvasState.leftCollapsed ? 'chevron-right' : 'chevron-left')
      );
      $('toggleLeft').setAttribute('aria-expanded', String(!canvasState.leftCollapsed));
      $('toggleRight').replaceChildren(
        icon(canvasState.rightCollapsed ? 'chevron-left' : 'chevron-right')
      );
      $('toggleRight').setAttribute('aria-expanded', String(!canvasState.rightCollapsed));
      $('toggleRight').disabled = !selectionState.inspectorSelectionKey;
    }
    function inspectorAvailability(key) {
      if (!key) {
        canvasState.rightCollapsed = true;
        selectionState.inspectorSelectionKey = '';
      } else if (key !== selectionState.inspectorSelectionKey) {
        canvasState.rightCollapsed = false;
        selectionState.inspectorSelectionKey = key;
      }
      panelVisibility();
    }
    function resizablePanel(handle, panel, side) {
      let resize = null;
      handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        resize = {
          x: event.clientX,
          width: panel.getBoundingClientRect().width
        };
        handle.setPointerCapture(event.pointerId);
        document.body.classList.add('resizing');
      });
      handle.addEventListener('pointermove', (event) => {
        if (!resize) return;
        const direction = side === 'left' ? 1 : -1,
          desired = resize.width + (event.clientX - resize.x) * direction;
        const other = $(side === 'left' ? 'inspector' : 'palette').getBoundingClientRect().width,
          available = document.querySelector('.workbody').getBoundingClientRect().width;
        const min = side === 'left' ? 150 : 240,
          max = Math.max(min, Math.min(side === 'left' ? 420 : 600, available - other - 300));
        panel.style.width = Math.max(min, Math.min(max, desired)) + 'px';
      });
      handle.addEventListener('pointerup', () => {
        resize = null;
        document.body.classList.remove('resizing');
        try {
          localStorage.setItem('argus.panel.' + side, panel.style.width);
        } catch {}
      });
      handle.addEventListener('pointercancel', () => {
        resize = null;
        document.body.classList.remove('resizing');
      });
      try {
        const stored = localStorage.getItem('argus.panel.' + side);
        if (stored && /^\d+(\.\d+)?px$/.test(stored)) panel.style.width = stored;
      } catch {}
    }
    function resizePaletteSplit() {
      const handle = $('paletteSplit');
      let state = null;
      handle.addEventListener('pointerdown', (e) => {
        state = {
          y: e.clientY,
          height: $('dataWindow').getBoundingClientRect().height
        };
        handle.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      handle.addEventListener('pointermove', (e) => {
        if (!state) return;
        const max = $('palette').clientHeight - 130;
        $('dataWindow').style.flex =
          '0 0 ' + Math.max(100, Math.min(max, state.height + e.clientY - state.y)) + 'px';
      });
      for (const name of ['pointerup', 'pointercancel'])
        handle.addEventListener(name, () => (state = null));
    }
    async function bootstrap() {
      setupProviderDismissal();
      const data = await api('/api/settings');
      preferencesState.appSettings = data.settings;
      await setLanguage(preferencesState.appSettings.language);
      decorateStaticIcons();
      await refreshCatalog();
      await home();
      startJobMonitor();
      await checkBackend();
      setInterval(checkBackend, 2e4);
    }
    const $ = (id) => document.getElementById(id);
    const uid = () => {
      if (typeof crypto.randomUUID === 'function') return crypto.randomUUID().replaceAll('-', '');
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    };
    return {
      toast,
      finishDialog,
      appDialog,
      askText,
      askConfirm,
      draggableDialog,
      saveIndicator,
      el,
      svg,
      button,
      show,
      searchText,
      decorateButton,
      iconActionButton,
      bind,
      modalChoice,
      parameterModal,
      updateStatus,
      checkBackend,
      panelVisibility,
      inspectorAvailability,
      resizablePanel,
      resizePaletteSplit,
      bootstrap,
      $,
      uid
    };
  }
};
export { shell_default };
export default shell_default;
