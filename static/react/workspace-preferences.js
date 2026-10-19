const key = 'argus.workspace.layout';
const defaults = { leftWidth: 220, rightWidth: 320, paletteHeight: 435 };
export function workspacePreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    return Object.fromEntries(
      Object.entries(defaults).map(([name, fallback]) => [
        name,
        Number.isFinite(saved[name])
          ? Math.max(
              name === 'paletteHeight' ? 120 : 220,
              Math.min(name === 'paletteHeight' ? 650 : 600, saved[name])
            )
          : fallback
      ])
    );
  } catch {
    return { ...defaults };
  }
}
export function saveWorkspacePreferences(values) {
  try {
    localStorage.setItem(key, JSON.stringify({ ...workspacePreferences(), ...values }));
  } catch {
    /* Storage-disabled browsers still keep the current in-memory layout. */
  }
}
