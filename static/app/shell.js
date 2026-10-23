var shell_default = {
  name: 'shell',
  dependencies: [],
  create({
    shellState,
    executionState,
    persistenceState,
    preferencesState,
    pluginsState,
    workspaceState,
    canvasState,
    selectionState
  }) {
    const $ = (id) => document.getElementById(id);
    const uid = () => {
      if (typeof crypto.randomUUID === 'function') return crypto.randomUUID().replaceAll('-', '');
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    };
    return { $, uid };
  }
};
export { shell_default };
export default shell_default;
