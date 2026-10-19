/** Explicit composition root. Each view receives named domain stores and narrow callbacks. */
import configureUiFeature from './app/bindings-configure-ui.js';
import bindNavigationFeature from './app/bindings-navigation.js';
import bindWorkspaceFeature from './app/bindings-workspace.js';
import bindCanvasFeature from './app/bindings-canvas.js';
import bindShortcutsFeature from './app/bindings-shortcuts.js';
import bindLifecycleFeature from './app/bindings-lifecycle.js';
import nodeRendererFeature from './app/node-renderer.js';
import edgeRendererFeature from './app/edge-renderer.js';
import groupRendererFeature from './app/group-renderer.js';
import shellFeature from './app/shell.js';
import apiFeature from './app/api.js';
import projectsFeature from './app/projects.js';
import persistenceFeature from './app/persistence.js';
import nodeCommandsFeature from './app/node-commands.js';
import layoutFeature from './app/layout.js';
import groupsFeature from './app/groups.js';
import canvasRendererFeature from './app/canvas-renderer.js';
import canvasInputFeature from './app/canvas-input.js';
import geometryFeature from './app/geometry.js';
import inspectorFeature from './app/inspector.js';
import fieldsFeature from './app/fields.js';
import paletteFeature from './app/palette.js';
import actorsFeature from './app/actors.js';
import historyFeature from './app/history.js';
import clipboardFeature from './app/clipboard.js';
import catalogueFeature from './app/catalogue.js';
import pluginSourcesFeature from './app/plugin-sources.js';
import pluginSettingsFeature from './app/plugin-settings.js';
import pluginLibraryFeature from './app/plugin-library.js';
import settingsFeature from './app/settings.js';
import resourcesFeature from './app/resources.js';
import locationFieldsFeature from './app/location-fields.js';
import uploadsFeature from './app/uploads.js';
import providersFeature from './app/providers.js';
import tagsFeature from './app/tags.js';
import logsFeature from './app/logs.js';
import bindingsFeature from './app/bindings.js';
import { createState } from './app/state.js';

export function instantiateFeature(feature, dependencies) {
  for (const name of feature.dependencies || []) {
    if (typeof dependencies[name] !== 'function') {
      throw new TypeError(`Feature ${feature.name}: missing callback ${name}`);
    }
  }
  return feature.create(dependencies);
}

export function createApplication(state = createState()) {
  const {
    workspaceState,
    persistenceState,
    selectionState,
    canvasState,
    executionState,
    pluginsState,
    preferencesState,
    historyState,
    uploadsState,
    libraryState,
    shellState,
    logsState
  } = state;
  const configureUi = instantiateFeature(configureUiFeature, {
    decorateButton: (...args) => shell.decorateButton(...args),
    fieldName: (...args) => fields.fieldName(...args),
    toast: (...args) => shell.toast(...args),
    uid: (...args) => shell.uid(...args)
  });
  const bindNavigation = instantiateFeature(bindNavigationFeature, {
    libraryState,
    preferencesState,
    $: (...args) => shell.$(...args),
    api: (...args) => api.api(...args),
    bind: (...args) => shell.bind(...args),
    draggableDialog: (...args) => shell.draggableDialog(...args),
    home: (...args) => projects.home(...args),
    openLibrary: (...args) => pluginLibrary.openLibrary(...args),
    openProject: (...args) => projects.openProject(...args),
    openRepositories: (...args) => pluginLibrary.openRepositories(...args),
    persistLanguage: (...args) => settings.persistLanguage(...args),
    pluginsHome: (...args) => pluginSettings.pluginsHome(...args),
    refreshLibrary: (...args) => pluginLibrary.refreshLibrary(...args),
    renderInstalled: (...args) => pluginSettings.renderInstalled(...args),
    renderLibrary: (...args) => pluginLibrary.renderLibrary(...args),
    renderProjects: (...args) => projects.renderProjects(...args),
    renderRepositories: (...args) => pluginLibrary.renderRepositories(...args),
    settingsHome: (...args) => settings.settingsHome(...args),
    settingsState: (...args) => settings.settingsState(...args),
    toast: (...args) => shell.toast(...args)
  });
  const bindWorkspace = instantiateFeature(bindWorkspaceFeature, {
    parameterModal: (...args) => shell.parameterModal(...args),
    canvasState,
    selectionState,
    workspaceState,
    $: (...args) => shell.$(...args),
    applyHistory: (...args) => history.applyHistory(...args),
    arrangeProject: (...args) => layout.arrangeProject(...args),
    bind: (...args) => shell.bind(...args),
    cancelConnection: (...args) => canvasInput.cancelConnection(...args),
    centerProject: (...args) => layout.centerProject(...args),
    change: (...args) => persistence.change(...args),
    createGroupFromSelection: (...args) => groups.createGroupFromSelection(...args),
    deleteSelection: (...args) => nodeCommands.deleteSelection(...args),
    deleteSelectionWithChildren: (...args) => nodeCommands.deleteSelectionWithChildren(...args),
    detachNodes: (...args) => groups.detachNodes(...args),
    dissolveSelectedGroups: (...args) => groups.dissolveSelectedGroups(...args),
    inspect: (...args) => inspector.inspect(...args),
    panelVisibility: (...args) => shell.panelVisibility(...args),
    render: (...args) => canvasRenderer.render(...args),
    save: (...args) => persistence.save(...args),
    setAllGroups: (...args) => groups.setAllGroups(...args),
    setupPaletteControls: (...args) => palette.setupPaletteControls(...args),
    show: (...args) => shell.show(...args),
    toast: (...args) => shell.toast(...args),
    zoomAt: (...args) => canvasInput.zoomAt(...args),
    zoomStep: (...args) => canvasInput.zoomStep(...args)
  });
  const bindCanvas = instantiateFeature(bindCanvasFeature, {
    canvasState,
    workspaceState,
    uploadsState,
    $: (...args) => shell.$(...args),
    cancelConnection: (...args) => canvasInput.cancelConnection(...args),
    canvasPointerDown: (...args) => canvasInput.canvasPointerDown(...args),
    canvasPointerUp: (...args) => canvasInput.canvasPointerUp(...args),
    dropPalette: (...args) => palette.dropPalette(...args),
    removeSelectionFrame: (...args) => canvasInput.removeSelectionFrame(...args),
    render: (...args) => canvasRenderer.render(...args),
    renderViewport: (...args) => canvasRenderer.renderViewport(...args),
    resizablePanel: (...args) => shell.resizablePanel(...args),
    textEditing: (...args) => clipboard.textEditing(...args),
    toast: (...args) => shell.toast(...args),
    touchGestureEvent: (...args) => canvasInput.touchGestureEvent(...args),
    updateDrag: (...args) => canvasInput.updateDrag(...args),
    uploadNodeFile: (...args) => uploads.uploadNodeFile(...args),
    zoomAt: (...args) => canvasInput.zoomAt(...args)
  });
  const bindShortcuts = instantiateFeature(bindShortcutsFeature, {
    workspaceState,
    selectionState,
    historyState,
    persistenceState,
    $: (...args) => shell.$(...args),
    applyHistory: (...args) => history.applyHistory(...args),
    copyGraph: (...args) => clipboard.copyGraph(...args),
    deleteSelection: (...args) => nodeCommands.deleteSelection(...args),
    graphClipboardText: (...args) => clipboard.graphClipboardText(...args),
    inspect: (...args) => inspector.inspect(...args),
    pasteGraph: (...args) => clipboard.pasteGraph(...args),
    render: (...args) => canvasRenderer.render(...args),
    textEditing: (...args) => clipboard.textEditing(...args)
  });
  const bindLifecycle = instantiateFeature(bindLifecycleFeature, {
    persistenceState,
    preferencesState,
    pluginsState,
    executionState,
    $: (...args) => shell.$(...args),
    bind: (...args) => shell.bind(...args),
    bootstrap: (...args) => shell.bootstrap(...args),
    cancelCurrentActor: (...args) => actors.cancelCurrentActor(...args),
    clearLogs: (...args) => logs.clearLogs(...args),
    draggableDialog: (...args) => shell.draggableDialog(...args),
    exportLogs: (...args) => logs.exportLogs(...args),
    finishDialog: (...args) => shell.finishDialog(...args),
    openLogs: (...args) => logs.openLogs(...args),
    renderLogs: (...args) => logs.renderLogs(...args),
    resizePaletteSplit: (...args) => shell.resizePaletteSplit(...args),
    show: (...args) => shell.show(...args),
    toast: (...args) => shell.toast(...args)
  });
  const nodeRenderer = instantiateFeature(nodeRendererFeature, {
    selectionState,
    canvasState,
    persistenceState,
    $: (...args) => shell.$(...args),
    actorTitle: (...args) => catalogue.actorTitle(...args),
    change: (...args) => persistence.change(...args),
    dataLabel: (...args) => catalogue.dataLabel(...args),
    el: (...args) => shell.el(...args),
    fitNodeText: (...args) => canvasRenderer.fitNodeText(...args),
    inspect: (...args) => inspector.inspect(...args),
    nodeBadgeHeight: (...args) => tags.nodeBadgeHeight(...args),
    nodeExtras: (...args) => resources.nodeExtras(...args),
    nodeIcon: (...args) => canvasRenderer.nodeIcon(...args),
    nodePorts: (...args) => canvasInput.nodePorts(...args),
    nodeRect: (...args) => canvasRenderer.nodeRect(...args),
    nodeTitle: (...args) => catalogue.nodeTitle(...args),
    noteInk: (...args) => inspector.noteInk(...args),
    providerName: (...args) => providers.providerName(...args),
    render: (...args) => canvasRenderer.render(...args),
    renderLocationAddress: (...args) => locationFields.renderLocationAddress(...args),
    short: (...args) => canvasRenderer.short(...args),
    summary: (...args) => canvasRenderer.summary(...args),
    svg: (...args) => shell.svg(...args)
  });
  const edgeRenderer = instantiateFeature(edgeRendererFeature, {
    askText: (...args) => shell.askText(...args),
    change: (...args) => persistence.change(...args),
    deleteEdges: (...args) => nodeCommands.deleteEdges(...args),
    edgeBundleIds: (...args) => canvasRenderer.edgeBundleIds(...args),
    measureEdgeText: (...args) => canvasRenderer.measureEdgeText(...args),
    nodeRect: (...args) => canvasRenderer.nodeRect(...args),
    render: (...args) => canvasRenderer.render(...args),
    routeConnection: (...args) => geometry.routeConnection(...args),
    selectEdge: (...args) => canvasRenderer.selectEdge(...args),
    svg: (...args) => shell.svg(...args),
    toast: (...args) => shell.toast(...args)
  });
  const groupRenderer = instantiateFeature(groupRendererFeature, {
    selectionState,
    persistenceState,
    $: (...args) => shell.$(...args),
    change: (...args) => persistence.change(...args),
    groupBounds: (...args) => groups.groupBounds(...args),
    groupNodeIds: (...args) => groups.groupNodeIds(...args),
    groupTitle: (...args) => groups.groupTitle(...args),
    inspectGroup: (...args) => inspector.inspectGroup(...args),
    moveGroup: (...args) => groups.moveGroup(...args),
    render: (...args) => canvasRenderer.render(...args),
    short: (...args) => canvasRenderer.short(...args),
    startGroupDrag: (...args) => canvasInput.startGroupDrag(...args),
    svg: (...args) => shell.svg(...args),
    toggleGroup: (...args) => groups.toggleGroup(...args)
  });
  const shell = instantiateFeature(shellFeature, {
    shellState,
    executionState,
    persistenceState,
    preferencesState,
    pluginsState,
    workspaceState,
    canvasState,
    selectionState,
    api: (...args) => api.api(...args),
    cancelConnection: (...args) => canvasInput.cancelConnection(...args),
    home: (...args) => projects.home(...args),
    refreshCatalog: (...args) => catalogue.refreshCatalog(...args),
    setupProviderDismissal: (...args) => providers.setupProviderDismissal(...args),
    startJobMonitor: (...args) => actors.startJobMonitor(...args)
  });
  const api = instantiateFeature(apiFeature, {
    shellState,
    updateStatus: (...args) => shell.updateStatus(...args)
  });
  const projects = instantiateFeature(projectsFeature, {
    libraryState,
    persistenceState,
    workspaceState,
    selectionState,
    canvasState,
    historyState,
    $: (...args) => shell.$(...args),
    api: (...args) => api.api(...args),
    askConfirm: (...args) => shell.askConfirm(...args),
    button: (...args) => shell.button(...args),
    el: (...args) => shell.el(...args),
    historyButtons: (...args) => history.historyButtons(...args),
    inspect: (...args) => inspector.inspect(...args),
    panelVisibility: (...args) => shell.panelVisibility(...args),
    projectSnapshot: (...args) => history.projectSnapshot(...args),
    parameterModal: (...args) => shell.parameterModal(...args),
    render: (...args) => canvasRenderer.render(...args),
    save: (...args) => persistence.save(...args),
    saveButtons: (...args) => persistence.saveButtons(...args),
    searchText: (...args) => shell.searchText(...args),
    show: (...args) => shell.show(...args),
    toast: (...args) => shell.toast(...args),
    updateStatus: (...args) => shell.updateStatus(...args)
  });
  const persistence = instantiateFeature(persistenceFeature, {
    persistenceState,
    workspaceState,
    canvasState,
    $: (...args) => shell.$(...args),
    api: (...args) => api.api(...args),
    recordHistory: (...args) => history.recordHistory(...args),
    saveIndicator: (...args) => shell.saveIndicator(...args),
    toast: (...args) => shell.toast(...args),
    updateStatus: (...args) => shell.updateStatus(...args)
  });
  const nodeCommands = instantiateFeature(nodeCommandsFeature, {
    preferencesState,
    canvasState,
    pluginsState,
    workspaceState,
    selectionState,
    persistenceState,
    uploadsState,
    $: (...args) => shell.$(...args),
    actionAcceptsNode: (...args) => palette.actionAcceptsNode(...args),
    actorIncompatible: (...args) => palette.actorIncompatible(...args),
    change: (...args) => persistence.change(...args),
    freeNodeSpot: (...args) => layout.freeNodeSpot(...args),
    groupDescendantIds: (...args) => groups.groupDescendantIds(...args),
    groupNodeIds: (...args) => groups.groupNodeIds(...args),
    inspect: (...args) => inspector.inspect(...args),
    newNodeLabel: (...args) => catalogue.newNodeLabel(...args),
    nodeRect: (...args) => canvasRenderer.nodeRect(...args),
    pluginText: (...args) => catalogue.pluginText(...args),
    pruneGroups: (...args) => groups.pruneGroups(...args),
    render: (...args) => canvasRenderer.render(...args),
    uid: (...args) => shell.uid(...args)
  });
  const layout = instantiateFeature(layoutFeature, {
    workspaceState,
    persistenceState,
    canvasState,
    $: (...args) => shell.$(...args),
    change: (...args) => persistence.change(...args),
    groupAncestors: (...args) => groups.groupAncestors(...args),
    groupBounds: (...args) => groups.groupBounds(...args),
    groupDescendantIds: (...args) => groups.groupDescendantIds(...args),
    groupNodeIds: (...args) => groups.groupNodeIds(...args),
    hiddenGroupIds: (...args) => groups.hiddenGroupIds(...args),
    intersects: (...args) => geometry.intersects(...args),
    nodeRect: (...args) => canvasRenderer.nodeRect(...args),
    orderedGroups: (...args) => groups.orderedGroups(...args),
    render: (...args) => canvasRenderer.render(...args)
  });
  const groups = instantiateFeature(groupsFeature, {
    canvasState,
    workspaceState,
    persistenceState,
    selectionState,
    pluginsState,
    askText: (...args) => shell.askText(...args),
    change: (...args) => persistence.change(...args),
    freeNodeSpot: (...args) => layout.freeNodeSpot(...args),
    inspect: (...args) => inspector.inspect(...args),
    inspectGroup: (...args) => inspector.inspectGroup(...args),
    makeRoomForGroup: (...args) => layout.makeRoomForGroup(...args),
    nodeRect: (...args) => canvasRenderer.nodeRect(...args),
    pluginText: (...args) => catalogue.pluginText(...args),
    render: (...args) => canvasRenderer.render(...args),
    uid: (...args) => shell.uid(...args)
  });
  const canvasRenderer = instantiateFeature(canvasRendererFeature, {
    workspaceState,
    canvasState,
    pluginsState,
    executionState,
    selectionState,
    $: (...args) => shell.$(...args),
    formatLocation: (...args) => locationFields.formatLocation(...args),
    graphGroupModel: (...args) => groups.graphGroupModel(...args),
    groupNodeIds: (...args) => groups.groupNodeIds(...args),
    inspect: (...args) => inspector.inspect(...args),
    locationDisplayLines: (...args) => locationFields.locationDisplayLines(...args),
    nodeBadgeHeight: (...args) => tags.nodeBadgeHeight(...args),
    noteInk: (...args) => inspector.noteInk(...args),
    pluginText: (...args) => catalogue.pluginText(...args),
    renderEdges: (...args) => edgeRenderer.renderEdges(...args),
    renderGroups: (...args) => groupRenderer.renderGroups(...args),
    renderNodes: (...args) => nodeRenderer.renderNodes(...args),
    resourceActions: (...args) => resources.resourceActions(...args),
    svg: (...args) => shell.svg(...args),
    updateMapOverlays: (...args) => resources.updateMapOverlays(...args)
  });
  const canvasInput = instantiateFeature(canvasInputFeature, {
    selectionState,
    persistenceState,
    canvasState,
    workspaceState,
    $: (...args) => shell.$(...args),
    change: (...args) => persistence.change(...args),
    groupBounds: (...args) => groups.groupBounds(...args),
    groupNodeIds: (...args) => groups.groupNodeIds(...args),
    inspect: (...args) => inspector.inspect(...args),
    inspectGroup: (...args) => inspector.inspectGroup(...args),
    nodeRect: (...args) => canvasRenderer.nodeRect(...args),
    portPosition: (...args) => geometry.portPosition(...args),
    render: (...args) => canvasRenderer.render(...args),
    renderViewport: (...args) => canvasRenderer.renderViewport(...args),
    svg: (...args) => shell.svg(...args),
    uid: (...args) => shell.uid(...args)
  });
  const geometry = instantiateFeature(geometryFeature, {});
  const inspector = instantiateFeature(inspectorFeature, {
    selectionState,
    workspaceState,
    pluginsState,
    executionState,
    canvasState,
    $: (...args) => shell.$(...args),
    actorIncompatible: (...args) => palette.actorIncompatible(...args),
    applyFields: (...args) => fields.applyFields(...args),
    applyGraphHighlights: (...args) => canvasRenderer.applyGraphHighlights(...args),
    button: (...args) => shell.button(...args),
    change: (...args) => persistence.change(...args),
    dataLabel: (...args) => catalogue.dataLabel(...args),
    deleteEdges: (...args) => nodeCommands.deleteEdges(...args),
    deleteGroup: (...args) => nodeCommands.deleteGroup(...args),
    deleteNodes: (...args) => nodeCommands.deleteNodes(...args),
    detachNodes: (...args) => groups.detachNodes(...args),
    displayControls: (...args) => resources.displayControls(...args),
    dissolveGroup: (...args) => groups.dissolveGroup(...args),
    editFields: (...args) => fields.editFields(...args),
    editableNodeData: (...args) => nodeCommands.editableNodeData(...args),
    el: (...args) => shell.el(...args),
    facts: (...args) => fields.facts(...args),
    formatLocation: (...args) => locationFields.formatLocation(...args),
    groupNodeIds: (...args) => groups.groupNodeIds(...args),
    groupTitle: (...args) => groups.groupTitle(...args),
    iconActionButton: (...args) => shell.iconActionButton(...args),
    inputField: (...args) => fields.inputField(...args),
    inspectorAvailability: (...args) => shell.inspectorAvailability(...args),
    makeRoomForGroup: (...args) => layout.makeRoomForGroup(...args),
    nodePlugin: (...args) => catalogue.nodePlugin(...args),
    phoneControls: (...args) => locationFields.phoneControls(...args),
    pluginText: (...args) => catalogue.pluginText(...args),
    refreshDetailMap: (...args) => resources.refreshDetailMap(...args),
    render: (...args) => canvasRenderer.render(...args),
    renderPalette: (...args) => palette.renderPalette(...args),
    reviewControls: (...args) => tags.reviewControls(...args),
    run: (...args) => actors.run(...args),
    saveButtons: (...args) => persistence.saveButtons(...args),
    toast: (...args) => shell.toast(...args),
    toggleGroup: (...args) => groups.toggleGroup(...args)
  });
  const fields = instantiateFeature(fieldsFeature, {
    countryRegionSelect: (...args) => locationFields.countryRegionSelect(...args),
    el: (...args) => shell.el(...args),
    providerField: (...args) => providers.providerField(...args),
    uid: (...args) => shell.uid(...args)
  });
  const palette = instantiateFeature(paletteFeature, {
    libraryState,
    workspaceState,
    pluginsState,
    persistenceState,
    selectionState,
    canvasState,
    $: (...args) => shell.$(...args),
    actorIcon: (...args) => canvasRenderer.actorIcon(...args),
    addActor: (...args) => nodeCommands.addActor(...args),
    addData: (...args) => nodeCommands.addData(...args),
    button: (...args) => shell.button(...args),
    dataIcon: (...args) => canvasRenderer.dataIcon(...args),
    dataLabel: (...args) => catalogue.dataLabel(...args),
    dropFiles: (...args) => uploads.dropFiles(...args),
    el: (...args) => shell.el(...args),
    pluginText: (...args) => catalogue.pluginText(...args),
    providerSearchKey: (...args) => providers.providerSearchKey(...args),
    render: (...args) => canvasRenderer.render(...args),
    searchText: (...args) => shell.searchText(...args),
    selectedData: (...args) => nodeCommands.selectedData(...args),
    toast: (...args) => shell.toast(...args),
    updateDeleteButtons: (...args) => nodeCommands.updateDeleteButtons(...args)
  });
  const actors = instantiateFeature(actorsFeature, {
    workspaceState,
    executionState,
    pluginsState,
    actorTitle: (...args) => catalogue.actorTitle(...args),
    api: (...args) => api.api(...args),
    change: (...args) => persistence.change(...args),
    inspect: (...args) => inspector.inspect(...args),
    reconcileWorkspace: (...args) => persistence.reconcileWorkspace(...args),
    modalChoice: (...args) => shell.modalChoice(...args),
    openPluginSettings: (...args) => pluginSettings.openPluginSettings(...args),
    parameterModal: (...args) => shell.parameterModal(...args),
    render: (...args) => canvasRenderer.render(...args),
    save: (...args) => persistence.save(...args),
    toast: (...args) => shell.toast(...args),
    updateStatus: (...args) => shell.updateStatus(...args)
  });
  const history = instantiateFeature(historyFeature, {
    workspaceState,
    persistenceState,
    historyState,
    selectionState,
    $: (...args) => shell.$(...args),
    change: (...args) => persistence.change(...args),
    inspect: (...args) => inspector.inspect(...args),
    render: (...args) => canvasRenderer.render(...args)
  });
  const clipboard = instantiateFeature(clipboardFeature, {
    workspaceState,
    historyState,
    selectionState,
    persistenceState,
    canvasState,
    $: (...args) => shell.$(...args),
    api: (...args) => api.api(...args),
    change: (...args) => persistence.change(...args),
    groupNodeIds: (...args) => groups.groupNodeIds(...args),
    inspect: (...args) => inspector.inspect(...args),
    openProject: (...args) => projects.openProject(...args),
    render: (...args) => canvasRenderer.render(...args),
    toast: (...args) => shell.toast(...args),
    uid: (...args) => shell.uid(...args)
  });
  const catalogue = instantiateFeature(catalogueFeature, {
    pluginsState,
    workspaceState,
    preferencesState,
    api: (...args) => api.api(...args),
    providerSearchKey: (...args) => providers.providerSearchKey(...args),
    renderPalette: (...args) => palette.renderPalette(...args)
  });
  const pluginSources = instantiateFeature(pluginSourcesFeature, {
    button: (...args) => shell.button(...args),
    editFields: (...args) => fields.editFields(...args),
    el: (...args) => shell.el(...args),
    pluginText: (...args) => catalogue.pluginText(...args),
    sourceLabel: (...args) => catalogue.sourceLabel(...args)
  });
  const pluginSettings = instantiateFeature(pluginSettingsFeature, {
    pluginsState,
    preferencesState,
    $: (...args) => shell.$(...args),
    api: (...args) => api.api(...args),
    applyFields: (...args) => fields.applyFields(...args),
    button: (...args) => shell.button(...args),
    dataPluginSettings: (...args) => pluginSources.dataPluginSettings(...args),
    editFields: (...args) => fields.editFields(...args),
    el: (...args) => shell.el(...args),
    iconActionButton: (...args) => shell.iconActionButton(...args),
    leaveWorkspace: (...args) => projects.leaveWorkspace(...args),
    parameterModal: (...args) => shell.parameterModal(...args),
    pluginDisplayName: (...args) => catalogue.pluginDisplayName(...args),
    pluginText: (...args) => catalogue.pluginText(...args),
    providerFieldKeys: (...args) => pluginSources.providerFieldKeys(...args),
    refreshCatalog: (...args) => catalogue.refreshCatalog(...args),
    saveIndicator: (...args) => shell.saveIndicator(...args),
    searchText: (...args) => shell.searchText(...args),
    show: (...args) => shell.show(...args),
    sourceOrderControl: (...args) => pluginSources.sourceOrderControl(...args),
    toast: (...args) => shell.toast(...args),
    updateStatus: (...args) => shell.updateStatus(...args)
  });
  const pluginLibrary = instantiateFeature(pluginLibraryFeature, {
    pluginsState,
    $: (...args) => shell.$(...args),
    api: (...args) => api.api(...args),
    askConfirm: (...args) => shell.askConfirm(...args),
    button: (...args) => shell.button(...args),
    el: (...args) => shell.el(...args),
    pluginDisplayName: (...args) => catalogue.pluginDisplayName(...args),
    pluginText: (...args) => catalogue.pluginText(...args),
    refreshCatalog: (...args) => catalogue.refreshCatalog(...args),
    renderInstalled: (...args) => pluginSettings.renderInstalled(...args),
    searchText: (...args) => shell.searchText(...args)
  });
  const settings = instantiateFeature(settingsFeature, {
    preferencesState,
    $: (...args) => shell.$(...args),
    api: (...args) => api.api(...args),
    askText: (...args) => shell.askText(...args),
    el: (...args) => shell.el(...args),
    iconActionButton: (...args) => shell.iconActionButton(...args),
    leaveWorkspace: (...args) => projects.leaveWorkspace(...args),
    renderProjects: (...args) => projects.renderProjects(...args),
    saveIndicator: (...args) => shell.saveIndicator(...args),
    show: (...args) => shell.show(...args),
    toast: (...args) => shell.toast(...args),
    uid: (...args) => shell.uid(...args),
    updateStatus: (...args) => shell.updateStatus(...args)
  });
  const resources = instantiateFeature(resourcesFeature, {
    api: (...args) => api.api(...args),
    pluginsState,
    canvasState,
    workspaceState,
    $: (...args) => shell.$(...args),
    button: (...args) => shell.button(...args),
    change: (...args) => persistence.change(...args),
    el: (...args) => shell.el(...args),
    locationDisplayLines: (...args) => locationFields.locationDisplayLines(...args),
    makeRoomForNode: (...args) => layout.makeRoomForNode(...args),
    nodeRect: (...args) => canvasRenderer.nodeRect(...args),
    render: (...args) => canvasRenderer.render(...args),
    renderNodeBadges: (...args) => tags.renderNodeBadges(...args),
    svg: (...args) => shell.svg(...args),
    toast: (...args) => shell.toast(...args)
  });
  const locationFields = instantiateFeature(locationFieldsFeature, {
    el: (...args) => shell.el(...args),
    measureEdgeText: (...args) => canvasRenderer.measureEdgeText(...args),
    svg: (...args) => shell.svg(...args)
  });
  const uploads = instantiateFeature(uploadsFeature, {
    workspaceState,
    canvasState,
    $: (...args) => shell.$(...args),
    modalChoice: (...args) => shell.modalChoice(...args),
    newNode: (...args) => nodeCommands.newNode(...args)
  });
  const providers = instantiateFeature(providersFeature, {
    pluginsState,
    button: (...args) => shell.button(...args),
    el: (...args) => shell.el(...args)
  });
  const tags = instantiateFeature(tagsFeature, {
    preferencesState,
    canvasState,
    change: (...args) => persistence.change(...args),
    el: (...args) => shell.el(...args),
    fitNodeText: (...args) => canvasRenderer.fitNodeText(...args),
    makeRoomForNode: (...args) => layout.makeRoomForNode(...args),
    measureEdgeText: (...args) => canvasRenderer.measureEdgeText(...args),
    render: (...args) => canvasRenderer.render(...args),
    resourceActions: (...args) => resources.resourceActions(...args),
    svg: (...args) => shell.svg(...args)
  });
  const logs = instantiateFeature(logsFeature, {
    workspaceState,
    logsState,
    $: (...args) => shell.$(...args),
    api: (...args) => api.api(...args),
    el: (...args) => shell.el(...args),
    save: (...args) => persistence.save(...args),
    show: (...args) => shell.show(...args)
  });
  const bindings = instantiateFeature(bindingsFeature, {
    configureUi: (...args) => configureUi.configureUi(...args),
    bindNavigation: (...args) => bindNavigation.bindNavigation(...args),
    bindWorkspace: (...args) => bindWorkspace.bindWorkspace(...args),
    bindCanvas: (...args) => bindCanvas.bindCanvas(...args),
    bindShortcuts: (...args) => bindShortcuts.bindShortcuts(...args),
    bindLifecycle: (...args) => bindLifecycle.bindLifecycle(...args)
  });
  return {
    initialize: bindings.initialize,
    state,
    features: {
      configureUi,
      bindNavigation,
      bindWorkspace,
      bindCanvas,
      bindShortcuts,
      bindLifecycle,
      nodeRenderer,
      edgeRenderer,
      groupRenderer,
      shell,
      api,
      projects,
      persistence,
      nodeCommands,
      layout,
      groups,
      canvasRenderer,
      canvasInput,
      geometry,
      inspector,
      fields,
      palette,
      actors,
      history,
      clipboard,
      catalogue,
      pluginSources,
      pluginSettings,
      pluginLibrary,
      settings,
      resources,
      locationFields,
      uploads,
      providers,
      tags,
      logs,
      bindings
    }
  };
}
export { createState };
export { configureUiFeature };
export { bindNavigationFeature };
export { bindWorkspaceFeature };
export { bindCanvasFeature };
export { bindShortcutsFeature };
export { bindLifecycleFeature };
export { nodeRendererFeature };
export { edgeRendererFeature };
export { groupRendererFeature };
export { shellFeature };
export { apiFeature };
export { projectsFeature };
export { persistenceFeature };
export { nodeCommandsFeature };
export { layoutFeature };
export { groupsFeature };
export { canvasRendererFeature };
export { canvasInputFeature };
export { geometryFeature };
export { inspectorFeature };
export { fieldsFeature };
export { paletteFeature };
export { actorsFeature };
export { historyFeature };
export { clipboardFeature };
export { catalogueFeature };
export { pluginSourcesFeature };
export { pluginSettingsFeature };
export { pluginLibraryFeature };
export { settingsFeature };
export { resourcesFeature };
export { locationFieldsFeature };
export { uploadsFeature };
export { providersFeature };
export { tagsFeature };
export { logsFeature };
export { bindingsFeature };

export { default as routing } from './graph-routing.js';
