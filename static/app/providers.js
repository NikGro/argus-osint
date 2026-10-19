import { icon } from '../icons.js';
import { t } from '../i18n.js';
var providers_default = {
  name: 'providers',
  dependencies: ['button', 'el'],
  create({ pluginsState, button, el }) {
    function providerSearchKey(value) {
      const normalized = String(value || '')
        .normalize('NFKC')
        .trim()
        .toLowerCase();
      return normalized.replace(/[^\p{L}\p{N}]/gu, '') || normalized;
    }
    function providerName(value) {
      return (
        pluginsState.providerIndex.get(providerSearchKey(value))?.name ||
        String(value || '').replace(/^custom:/, '')
      );
    }
    function providerField(parent, value, path, translate) {
      const current = String(value || ''),
        known = current.startsWith('custom:')
          ? null
          : pluginsState.providerIndex.get(providerSearchKey(current));
      const box = el('div', {
          class: 'provider-field'
        }),
        control = el('input', {
          type: 'hidden',
          'data-field': path.join('.')
        }),
        dropdown = el('details', {
          class: 'provider-select'
        }),
        summary = el('summary', {
          'aria-label': translate('Anbieter')
        }),
        caption = el('span'),
        arrow = icon('chevron-down');
      summary.append(caption, arrow);
      dropdown.append(summary);
      const menu = el('div', {
          class: 'provider-menu'
        }),
        search = el('input', {
          type: 'search',
          placeholder: t('ui.search_providers'),
          'aria-label': t('ui.search_providers'),
          autocomplete: 'off'
        }),
        list = el('div', {
          class: 'provider-options',
          role: 'listbox',
          'aria-label': translate('Anbieter')
        }),
        hint = el('small', {
          class: 'provider-count'
        }),
        custom = el('input', {
          type: 'text',
          placeholder: t('ui.custom_provider'),
          'aria-label': t('ui.custom_provider')
        });
      menu.append(search, list, hint);
      dropdown.append(menu);
      box.append(dropdown, control, custom);
      parent.append(el('label', {}, translate('Anbieter')), box);
      control.value =
        known?.id ||
        (current ? (current.startsWith('custom:') ? current : 'custom:' + current) : '');
      custom.value = current.startsWith('custom:') ? current.slice(7) : known ? '' : current;
      function update() {
        const isCustom = control.value.startsWith('custom:');
        custom.hidden = !isCustom;
        caption.textContent = isCustom
          ? t('ui.other_custom')
          : providerName(control.value) || t('ui.select_provider');
      }
      function choose(id) {
        control.value = id;
        update();
        dropdown.open = false;
        control.dispatchEvent(
          new Event('input', {
            bubbles: true
          })
        );
        if (id.startsWith('custom:')) custom.focus();
      }
      function paint() {
        list.replaceChildren();
        const query = search.value.trim().toLocaleLowerCase(),
          matches = pluginsState.providerCatalogue.filter((p) =>
            [p.name, p.id, ...p.aliases].some((name) =>
              String(name).toLocaleLowerCase().includes(query)
            )
          );
        for (const p of matches.slice(0, 80)) {
          const option = button(p.name, () => choose(p.id), 'provider-option');
          option.type = 'button';
          option.setAttribute('role', 'option');
          option.setAttribute('aria-selected', String(control.value === p.id));
          list.append(option);
        }
        if (!matches.length) list.append(el('p', {}, t('ui.no_matching_provider')));
        const other = button(
          t('ui.other_custom'),
          () => choose('custom:' + custom.value),
          'provider-option provider-custom'
        );
        other.type = 'button';
        list.append(other);
        hint.textContent =
          matches.length > 80
            ? t('ui.narrow_down_more_providers_using_search') + ' (' + matches.length + ')'
            : matches.length + ' ' + t('ui.provider');
      }
      custom.addEventListener('input', () => {
        control.value = 'custom:' + custom.value.trim();
        control.dispatchEvent(
          new Event('input', {
            bubbles: true
          })
        );
      });
      custom.addEventListener('change', () => {
        const match = pluginsState.providerIndex.get(providerSearchKey(custom.value));
        if (match) choose(match.id);
      });
      search.addEventListener('input', paint);
      search.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          list.querySelector('button')?.focus();
        }
        if (event.key === 'Escape') {
          dropdown.open = false;
          summary.focus();
        }
      });
      list.addEventListener('keydown', (event) => {
        const buttons = [...list.querySelectorAll('button')],
          index = buttons.indexOf(document.activeElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          buttons[
            Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
          ]?.focus();
        }
        if (event.key === 'Escape') {
          dropdown.open = false;
          summary.focus();
        }
      });
      dropdown.addEventListener('toggle', () => {
        if (dropdown.open) {
          paint();
          search.focus();
        }
      });
      update();
      paint();
      return {
        control,
        path,
        read: () => control.value
      };
    }
    function setupProviderDismissal() {
      document.addEventListener('pointerdown', (event) => {
        for (const dropdown of document.querySelectorAll('.provider-select[open]'))
          if (!dropdown.contains(event.target)) dropdown.open = false;
      });
    }
    return { providerSearchKey, providerName, providerField, setupProviderDismissal };
  }
};
export { providers_default };
export default providers_default;
