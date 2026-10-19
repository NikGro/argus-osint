import { t } from './i18n.js';
import { icon } from './icons.js';

/** Ordered scopes stay provider-local; text inputs survive autosave without repainting. */
export function researchProfiles(parent, initial, catalog, changed) {
  const rows = structuredClone(initial || []);
  const root = document.createElement('div');
  root.className = 'research-profiles';
  const label = document.createElement('label');
  label.textContent = t('ui.add_search_profile');
  const select = document.createElement('select');
  select.setAttribute('aria-label', t('ui.add_search_profile'));
  select.append(new Option(t('ui.add_search_profile_a2a8ee86'), ''));
  for (const entry of catalog) select.append(new Option(entry.label, entry.id));
  select.append(new Option(t('ui.custom_websites'), 'custom'));
  label.append(select);
  const list = document.createElement('div');
  list.className = 'profile-list';
  const help = document.createElement('p');
  help.className = 'source-help';
  root.append(label, list, help);
  parent.append(root);
  let dragging = null;
  function move(index, to) {
    if (to < 0 || to >= rows.length || index === to) return;
    rows.splice(to, 0, rows.splice(index, 1)[0]);
    paint();
    changed();
    list.children[to]?.querySelector('button')?.focus();
  }
  function control(title, glyph, callback) {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = t(title);
    button.setAttribute('aria-label', t(title));
    button.append(icon(glyph));
    button.addEventListener('click', callback);
    return button;
  }
  function paint() {
    list.replaceChildren();
    help.textContent = rows.length
      ? t('ui.profiles_are_searched_in_this_order_duplicate_results_are_merged')
      : t('ui.no_restriction_all_websites_will_be_searched');
    rows.forEach((row, index) => {
      const tile = document.createElement('div');
      tile.className = 'profile-item';
      const bar = document.createElement('div');
      bar.className = 'profile-row';
      const handle = control('Suchprofil verschieben', 'drag', () => {});
      handle.className = 'source-handle borderless';
      handle.draggable = true;
      handle.addEventListener('dragstart', (event) => {
        dragging = index;
        event.stopPropagation();
        event.dataTransfer.setData('application/x-argus-profile', String(index));
      });
      handle.addEventListener('dragend', () => {
        dragging = null;
      });
      handle.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopPropagation();
          move(index, index + (event.key === 'ArrowUp' ? -1 : 1));
        }
      });
      tile.addEventListener('dragover', (event) => {
        if (dragging !== null) {
          event.preventDefault();
          event.stopPropagation();
        }
      });
      tile.addEventListener('drop', (event) => {
        if (dragging === null) return;
        event.preventDefault();
        event.stopPropagation();
        const from = dragging;
        dragging = null;
        move(from, index);
      });
      const title = document.createElement('span');
      title.textContent =
        row.id === 'custom'
          ? t('ui.custom_websites')
          : catalog.find((entry) => entry.id === row.id)?.label || row.id;
      const up = control('Nach oben', 'chevron-up', () => move(index, index - 1));
      const down = control('Nach unten', 'chevron-down', () => move(index, index + 1));
      up.className = down.className = 'source-move borderless';
      up.disabled = index === 0;
      down.disabled = index === rows.length - 1;
      const remove = control('Suchprofil entfernen', 'trash', () => {
        rows.splice(index, 1);
        paint();
        changed();
      });
      remove.className = 'danger-filled';
      bar.classList.add('source-row');
      bar.append(handle, title, up, down, remove);
      tile.append(bar);
      if (row.id === 'custom') {
        const input = document.createElement('textarea');
        input.rows = 4;
        input.value = (row.sites || []).join('\n');
        input.placeholder = t('ui.one_website_per_line_for_example_github');
        input.setAttribute('aria-label', t('ui.custom_websites_one_per_line'));
        input.addEventListener('input', () => {
          row.sites = input.value
            .split(/\r?\n/)
            .map((value) => value.trim())
            .filter(Boolean);
          changed();
        });
        tile.append(input);
      }
      list.append(tile);
    });
  }
  select.addEventListener('change', () => {
    const id = select.value;
    if (id && (id === 'custom' || !rows.some((row) => row.id === id))) {
      rows.push(id === 'custom' ? { id, sites: [] } : { id });
      paint();
      changed();
    }
    select.value = '';
  });
  paint();
  return () => structuredClone(rows);
}
