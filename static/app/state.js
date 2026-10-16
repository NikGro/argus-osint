function createState() {
  return {
    workspaceState: {
      project: null,
      lastServerSnapshot: null,
      lastServerTitle: null,
      templates: {}
    },
    persistenceState: {
      dirty: false,
      busy: false,
      savePromise: null,
      changeVersion: 0,
      autosaveTimer: null,
      saveError: '',
      dirtyNodes: /* @__PURE__ */ new Set()
    },
    selectionState: {
      selected: /* @__PURE__ */ new Set(),
      selectedEdges: /* @__PURE__ */ new Set(),
      selectedGroup: null,
      selectedGroups: /* @__PURE__ */ new Set(),
      inspectorSelectionKey: '',
      lastPaletteSelection: ''
    },
    canvasState: {
      pan: {
        x: 60,
        y: 70,
        scale: 1
      },
      drag: null,
      keyboardNode: null,
      groupBoundsCache: null,
      connecting: null,
      touchSelection: false,
      spacePressed: false,
      touchPointers: /* @__PURE__ */ new Map(),
      pinchGesture: null,
      gestureBlocked: false,
      leftCollapsed: false,
      rightCollapsed: true
    },
    executionState: {
      preflighting: /* @__PURE__ */ new Set(),
      activeActors: /* @__PURE__ */ new Set(),
      actorQueue: [],
      queueRunning: false,
      currentActorJob: null
    },
    pluginsState: {
      pluginSettingsOpen: /* @__PURE__ */ new Set(),
      pendingPluginTimers: /* @__PURE__ */ new Map(),
      activePluginForms: /* @__PURE__ */ new Map(),
      pendingPluginDirty: /* @__PURE__ */ new Set(),
      pendingPluginSaves: /* @__PURE__ */ new Set(),
      providerCatalogue: [],
      providerIndex: /* @__PURE__ */ new Map(),
      dataPlugins: [],
      dataTypes: /* @__PURE__ */ new Map(),
      catalog: [],
      libraryItems: [],
      repositories: []
    },
    preferencesState: {
      appSettings: {
        language: 'de'
      },
      settingsPromise: null,
      settingsError: '',
      settingsDirty: false,
      pendingSettingsTimer: null
    },
    historyState: {
      undoStack: [],
      redoStack: [],
      lastSnapshot: null,
      lastHistoryScope: '',
      lastHistoryAt: 0,
      historyMuted: false,
      internalClipboard: '',
      pendingClipboardPaste: null
    },
    uploadsState: {
      pendingImagePosition: null,
      pendingUploadType: 'image'
    },
    libraryState: {
      homeMode: 'active',
      projectIndex: [],
      homeQueries: {
        active: '',
        archive: ''
      },
      paletteState: {
        node: {
          query: '',
          categories: [],
          sort: 'category_az'
        },
        actor: {
          query: '',
          categories: [],
          sort: 'category_az'
        }
      }
    },
    shellState: {
      backendOnline: null,
      backendCheckAt: null,
      dialogRequest: null
    },
    logsState: {
      logRecords: [],
      logTotal: 0
    }
  };
}
export { createState };
