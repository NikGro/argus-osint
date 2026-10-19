import { t } from './i18n.js';
/* One shared, searchable presentation for every native single-choice select. */
const ArgusSelect = (() => {
  const controls = new WeakMap();
  let active = null;
  const tr = (key) => (typeof t === 'function' ? t(key) : key);
  function close(restore = false) {
    if (!active) return;
    const current = active;
    active = null;
    current.button.setAttribute('aria-expanded', 'false');
    if (current.popup.matches(':popover-open')) current.popup.hidePopover();
    current.popup.remove();
    if (restore) current.button.focus();
  }
  function enhance(select) {
    if (select.multiple || controls.has(select)) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'search-select';
    select.before(wrapper);
    wrapper.append(select);
    select.classList.add('search-select-source');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'search-select-button';
    button.setAttribute('role', 'combobox');
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    const text = document.createElement('span'),
      chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.innerHTML =
      '<path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2"/>';
    button.append(text, chevron);
    wrapper.append(button);
    const refresh = () => {
      const label =
        select.getAttribute('aria-label') ||
        document.querySelector('label[for="' + select.id + '"]')?.textContent ||
        (wrapper.previousElementSibling?.matches('label')
          ? wrapper.previousElementSibling.textContent
          : '');
      if (label) button.setAttribute('aria-label', label);
      const value = select.selectedOptions?.[0]?.textContent || tr('Bitte auswählen');
      if (text.textContent !== value) text.textContent = value;
      button.disabled = select.disabled;
    };
    const model = { select, wrapper, button, refresh };
    controls.set(select, model);
    select.addEventListener('change', refresh);
    select.addEventListener('input', refresh);
    new MutationObserver(refresh).observe(select, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
    refresh();
    function open(initial = '') {
      close();
      const popup = document.createElement('div');
      popup.className = 'select-popup';
      popup.setAttribute('popover', 'manual');
      const search = document.createElement('input');
      search.type = 'search';
      search.placeholder = tr('Suchen …');
      search.setAttribute('aria-label', tr('Optionen durchsuchen'));
      search.autocomplete = 'off';
      const list = document.createElement('div');
      list.className = 'select-options';
      list.setAttribute('role', 'listbox');
      const count = document.createElement('small');
      popup.append(search, list, count);
      (select.closest('dialog') || document.body).append(popup);
      const id = 'select-options-' + Math.random().toString(36).slice(2);
      list.id = id;
      button.setAttribute('aria-controls', id);
      button.setAttribute('aria-expanded', 'true');
      active = { ...model, popup, search };
      const rect = button.getBoundingClientRect(),
        width = Math.max(230, Math.min(520, rect.width));
      popup.style.width = Math.min(width, innerWidth - 20) + 'px';
      popup.style.left = Math.max(10, Math.min(rect.left, innerWidth - width - 10)) + 'px';
      const below = innerHeight - rect.bottom;
      popup.style.top =
        (below > 240 ? rect.bottom + 4 : Math.max(10, rect.top - Math.min(330, innerHeight - 20))) +
        'px';
      popup.style.maxHeight =
        Math.max(150, Math.min(330, below > 240 ? below - 12 : rect.top - 12)) + 'px';
      if (popup.showPopover) popup.showPopover();
      function choose(option) {
        select.value = option.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        refresh();
        close(true);
      }
      function paint() {
        const query = search.value.normalize('NFKC').toLocaleLowerCase(),
          matches = [...select.options].filter((o) =>
            (o.textContent + ' ' + o.value + ' ' + (o.closest('optgroup')?.label || ''))
              .normalize('NFKC')
              .toLocaleLowerCase()
              .includes(query)
          );
        list.replaceChildren();
        for (const option of matches.slice(0, 120)) {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'select-option';
          row.setAttribute('role', 'option');
          row.setAttribute('aria-selected', String(option.selected));
          row.disabled = option.disabled;
          row.textContent = option.textContent;
          row.addEventListener('click', () => choose(option));
          list.append(row);
        }
        if (!matches.length) {
          const empty = document.createElement('p');
          empty.textContent = tr('Keine passenden Optionen.');
          list.append(empty);
        }
        count.textContent =
          matches.length > 120
            ? tr('Weitere Optionen über die Suche eingrenzen.') + ' (' + matches.length + ')'
            : '';
      }
      search.addEventListener('input', paint);
      popup.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close(true);
          return;
        }
        const rows = [...list.querySelectorAll('button:not(:disabled)')],
          index = rows.indexOf(document.activeElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          rows[
            Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
          ]?.focus();
        } else if (
          event.key === 'Enter' &&
          document.activeElement === search &&
          rows.length === 1
        ) {
          event.preventDefault();
          rows[0].click();
        } else if (
          event.key.length === 1 &&
          !event.ctrlKey &&
          !event.metaKey &&
          document.activeElement !== search
        ) {
          event.preventDefault();
          search.focus({ preventScroll: true });
          search.value += event.key;
          paint();
        }
      });
      search.value = initial;
      paint();
      search.focus({ preventScroll: true });
    }
    button.addEventListener('click', () => (active?.select === select ? close() : open()));
    button.addEventListener('keydown', (event) => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        open();
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== ' ') {
        event.preventDefault();
        open(event.key);
      }
    });
  }
  function scan(root = document) {
    if (root.matches?.('select')) enhance(root);
    root.querySelectorAll?.('select').forEach(enhance);
  }
  const api = {
    scan,
    close,
    refresh: (select) => controls.get(select)?.refresh()
  };
  // Legacy views opt in explicitly. Never mutate React-owned form elements.
  function install() {
    if (typeof MutationObserver !== 'function') return;
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) if (node.nodeType === 1) scan(node);
      if (active && !active.select.isConnected) close();
    }).observe(document.body, { childList: true, subtree: true });
    scan();
    document.addEventListener('pointerdown', (event) => {
      if (active && !active.popup.contains(event.target) && !active.button.contains(event.target))
        close();
    });
    window.addEventListener('resize', () => close());
    document.addEventListener(
      'scroll',
      (event) => {
        if (active && !active.popup.contains(event.target)) close();
      },
      true
    );
  }
  api.install = install;
  return api;
})();
export default ArgusSelect;
