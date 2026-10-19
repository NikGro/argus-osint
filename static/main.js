/** Explicit composition root. Each view receives named domain stores and narrow callbacks. */
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
import { createState } from './app/state.js';

/** The only composition path: React renders; these modules own domain behavior.
 * Callbacks resolve lazily so tests and adapters can replace narrow capabilities.
 */
export function instantiateFeature(feature, dependencies) {
  for (const name of feature.dependencies || [])
    if (typeof dependencies[name] !== 'function')
      throw new TypeError(`Feature ${feature.name}: missing callback ${name}`);
  return feature.create(dependencies);
}
const registry = [
  shellFeature,
  apiFeature,
  projectsFeature,
  persistenceFeature,
  nodeCommandsFeature,
  layoutFeature,
  groupsFeature,
  canvasRendererFeature,
  canvasInputFeature,
  geometryFeature,
  inspectorFeature,
  fieldsFeature,
  paletteFeature,
  actorsFeature,
  historyFeature,
  clipboardFeature,
  catalogueFeature,
  pluginSourcesFeature,
  pluginSettingsFeature,
  pluginLibraryFeature,
  settingsFeature,
  resourcesFeature,
  locationFieldsFeature,
  uploadsFeature,
  providersFeature,
  tagsFeature,
  logsFeature
];
export function createApplication(state = createState(), overrides = {}) {
  const owners = new Map(),
    features = {},
    commands = {};
  for (const descriptor of registry) {
    const dependencies = Object.fromEntries(
      (descriptor.dependencies || []).map((name) => [
        name,
        (...args) => {
          const owner = owners.get(name),
            method = overrides[name] || owner?.[name];
          if (typeof method !== 'function')
            throw Error(`Unregistered command: ${descriptor.name}.${name}`);
          return method(...args);
        }
      ])
    );
    const domain = instantiateFeature(descriptor, { ...state, ...dependencies });
    features[descriptor.name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = domain;
    for (const [name, method] of Object.entries(domain)) {
      if (owners.has(name)) throw Error(`Duplicate command: ${name}`);
      owners.set(name, domain);
      commands[name] = method;
    }
  }
  Object.assign(commands, overrides);
  return { state, features, commands };
}
export {
  createState,
  shellFeature,
  apiFeature,
  projectsFeature,
  persistenceFeature,
  nodeCommandsFeature,
  layoutFeature,
  groupsFeature,
  canvasRendererFeature,
  canvasInputFeature,
  geometryFeature,
  inspectorFeature,
  fieldsFeature,
  paletteFeature,
  actorsFeature,
  historyFeature,
  clipboardFeature,
  catalogueFeature,
  pluginSourcesFeature,
  pluginSettingsFeature,
  pluginLibraryFeature,
  settingsFeature,
  resourcesFeature,
  locationFieldsFeature,
  uploadsFeature,
  providersFeature,
  tagsFeature,
  logsFeature
};
export { default as routing } from './graph-routing.js';
