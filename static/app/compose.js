/** Wire feature callbacks without cyclic imports or implicit window globals.
 * Dependencies are declared by name and validated before any UI event is attached.
 * Deferred callbacks allow two views to refresh each other without importing views.
 */
export function composeFeatures(appState, features) {
  const commands = Object.create(null);
  const required = new Set(features.flatMap((feature) => feature.dependencies));
  const callbacks = Object.fromEntries(
    [...required].map((name) => [name, (...args) => commands[name](...args)])
  );
  for (const feature of features) {
    const dependencies = Object.fromEntries(
      feature.dependencies.map((name) => [name, callbacks[name]])
    );
    for (const [name, command] of Object.entries(feature.create({ appState, ...dependencies }))) {
      if (commands[name]) throw new Error('Duplicate application command: ' + name);
      if (typeof command !== 'function')
        throw new TypeError('Invalid application command: ' + name);
      commands[name] = command;
    }
  }
  for (const name of required)
    if (!commands[name]) throw new Error('Missing application command: ' + name);
  return commands;
}
