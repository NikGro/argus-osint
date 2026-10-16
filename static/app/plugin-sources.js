import { researchProfiles } from '../research-profiles.js';
import { providerFields, displayOptions } from './labels.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { buttonContent } from '../icons.js';
var plugin_sources_default = {
  name: 'plugin-sources',
  dependencies: ['button', 'editFields', 'el', 'pluginText', 'sourceLabel'],
  create({ button, editFields, el, pluginText, sourceLabel }) {
    function providerFieldKeys(data) {
      return Object.keys(data).filter((key) =>
        Object.keys(providerFields).some(
          (provider) => 'use_' + provider in data && providerFields[provider].includes(key)
        )
      );
    }
    function sourceOrderControl(form, data, onChange, options = {}) {
      const keys = Object.keys(data)
        .filter((key) => key.startsWith('use_'))
        .map((key) => key.slice(4));
      if (!keys.length) return null;
      const initial = Array.isArray(data.source_order)
          ? data.source_order.filter((key) => keys.includes(key))
          : keys,
        order = [.../* @__PURE__ */ new Set([...initial, ...keys])],
        enabled = Object.fromEntries(keys.map((key) => [key, data['use_' + key] !== false]));
      form.append(
        el('h4', {}, t(options.title || 'Quellenpriorit\xE4t')),
        el(
          'p',
          {
            class: 'source-help'
          },
          t('Quellen ziehen, um die Abfragereihenfolge zu \xE4ndern.')
        )
      );
      const list = el('div', {
        class: 'source-order'
      });
      form.append(list);
      let dragging = null,
        touch = null;
      const bodies = /* @__PURE__ */ new Map(),
        readers = [];
      const profileReaders = {};
      for (const key of keys) {
        const body = el('div', {
          class: 'source-settings',
          hidden: ''
        });
        const hasProfiles = Object.hasOwn(options.profileCatalog || {}, key);
        const profileFields = [
          'consensus_sites',
          'sherlock_sites',
          'maigret_sites',
          'holehe_sites',
          'top_sites'
        ];
        if (hasProfiles) {
          const legacyField = {
            consensus: 'consensus_sites',
            sherlock: 'sherlock_sites',
            maigret: 'maigret_sites',
            holehe: 'holehe_sites'
          }[key];
          const initial =
            data.search_profiles?.[key] ??
            (data[legacyField]?.length ? [{ id: 'custom', sites: data[legacyField] }] : []);
          let profileParent = body;
          if (options.profileContainer) {
            profileParent = el('details', { class: 'provider-profiles' });
            profileParent.append(el('summary', {}, sourceLabel(key)));
            options.profileContainer.append(profileParent);
            body.append(
              el(
                'p',
                { class: 'source-help' },
                t('Suchprofile werden unter den Standardwerten festgelegt.')
              )
            );
          }
          profileReaders[key] = researchProfiles(
            profileParent,
            initial,
            options.profileCatalog[key],
            onChange
          );
        }
        const fields = Object.fromEntries(
          (providerFields[key] || [])
            .filter((field) => field in data && !(hasProfiles && profileFields.includes(field)))
            .map((field) => [field, data[field]])
        );
        if (Object.keys(fields).length)
          readers.push(...editFields(body, fields, [], options.translate || t));
        else if (!hasProfiles)
          body.append(
            el(
              'p',
              {
                class: 'source-help'
              },
              t('Keine zus\xE4tzlichen Anbieter-Einstellungen.')
            )
          );
        body.addEventListener('input', onChange);
        body.addEventListener('change', onChange);
        bodies.set(key, body);
      }
      function reorder(key, target, after = false) {
        if (key === target) return;
        order.splice(order.indexOf(key), 1);
        order.splice(order.indexOf(target) + (after ? 1 : 0), 0, key);
        paint();
        onChange();
      }
      function paint() {
        list.replaceChildren();
        for (const [index, key] of order.entries()) {
          const tile = el('div', {
              class: 'source-tile',
              'data-source': key
            }),
            row = el('div', {
              class: 'source-row',
              'data-source': key
            }),
            body = bodies.get(key);
          const expand = button(
            '',
            () => {
              body.hidden = !body.hidden;
              expand.replaceChildren(icon(body.hidden ? 'chevron-right' : 'chevron-down'));
              expand.setAttribute('aria-expanded', String(!body.hidden));
            },
            'source-expand'
          );
          expand.type = 'button';
          expand.replaceChildren(icon(body.hidden ? 'chevron-right' : 'chevron-down'));
          expand.setAttribute('aria-expanded', String(!body.hidden));
          expand.setAttribute('aria-label', t('Anbieter-Einstellungen'));
          const handle = el('span', {
            class: 'source-handle',
            role: 'button',
            tabindex: 0,
            draggable: 'true',
            'aria-label': t('Quelle verschieben')
          });
          handle.append(icon('drag'));
          const checkbox = el('input', {
            type: 'checkbox'
          });
          checkbox.checked = enabled[key];
          checkbox.addEventListener('change', () => {
            enabled[key] = checkbox.checked;
            onChange();
          });
          const label = el('label', {
            class: 'checkbox-label'
          });
          label.append(
            checkbox,
            document.createTextNode(options.labels?.[key] || sourceLabel(key))
          );
          const up = button(
              t('Nach oben'),
              () => {
                if (index) reorder(key, order[index - 1]);
              },
              'source-move'
            ),
            down = button(
              t('Nach unten'),
              () => {
                if (index < order.length - 1) reorder(key, order[index + 1], true);
              },
              'source-move'
            );
          buttonContent(up, t('Nach oben'), 'chevron-up', true);
          buttonContent(down, t('Nach unten'), 'chevron-down', true);
          up.type = down.type = 'button';
          up.disabled = index === 0;
          down.disabled = index === order.length - 1;
          row.append(
            expand,
            handle,
            el(
              'span',
              {
                class: 'source-number'
              },
              index + 1
            ),
            label,
            up,
            down
          );
          handle.addEventListener('dragstart', (e) => {
            dragging = key;
            e.dataTransfer.setData('application/x-argus-source', key);
            e.dataTransfer.effectAllowed = 'move';
          });
          tile.addEventListener('dragover', (e) => {
            if (dragging) e.preventDefault();
          });
          tile.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const source = dragging || e.dataTransfer.getData('application/x-argus-source');
            if (order.includes(source))
              reorder(
                source,
                key,
                e.clientY > row.getBoundingClientRect().top + row.clientHeight / 2
              );
            dragging = null;
          });
          handle.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse') return;
            e.preventDefault();
            touch = {
              key,
              id: e.pointerId
            };
            list.setPointerCapture(e.pointerId);
          });
          handle.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp' && index) {
              e.preventDefault();
              reorder(key, order[index - 1]);
            } else if (e.key === 'ArrowDown' && index < order.length - 1) {
              e.preventDefault();
              reorder(key, order[index + 1], true);
            }
          });
          tile.append(row, body);
          list.append(tile);
        }
      }
      list.addEventListener('pointermove', (e) => {
        if (!touch) return;
        e.preventDefault();
        const tile = document.elementFromPoint(e.clientX, e.clientY)?.closest('.source-tile');
        if (tile && tile.closest('.source-order') === list)
          reorder(
            touch.key,
            tile.dataset.source,
            e.clientY > tile.getBoundingClientRect().top + tile.clientHeight / 2
          );
      });
      for (const type of ['pointerup', 'pointercancel'])
        list.addEventListener(type, () => (touch = null));
      paint();
      return () => ({
        ...Object.fromEntries(readers.map((item) => [item.path.at(-1), item.read()])),
        ...(Object.keys(profileReaders).length
          ? {
              search_profiles: {
                ...data.search_profiles,
                ...Object.fromEntries(
                  Object.entries(profileReaders).map(([key, read]) => [key, read()])
                )
              }
            }
          : {}),
        source_order: [...order],
        ...Object.fromEntries(keys.map((key) => ['use_' + key, enabled[key]]))
      });
    }
    function mapSourcesControl(form, title, sources, onChange) {
      const data = {
          source_order: sources.map((s) => s.id),
          ...Object.fromEntries(sources.map((s) => ['use_' + s.id, s.enabled !== false]))
        },
        labels = Object.fromEntries(sources.map((s) => [s.id, s.name]));
      const read = sourceOrderControl(form, data, onChange, {
        title,
        labels
      });
      return () => {
        const value = read();
        return value.source_order.map((id) => ({
          id,
          name: labels[id],
          enabled: value['use_' + id]
        }));
      };
    }
    function dataPluginSettings(form, plugin, node, changed) {
      const settings = plugin.settings?.nodes?.[node.type] || {},
        controls = [];
      form.append(el('h3', {}, pluginText(plugin, node.name)));
      const presets = el('section', { class: 'plugin-default-section' });
      presets.append(
        el('h4', {}, t('Standardwerte für neue Daten-Nodes')),
        el(
          'p',
          { class: 'source-help' },
          t('Diese Anzeigeoptionen kannst du später in den Knotendetails ändern.')
        )
      );
      form.append(presets);
      const defaults = {
        ...node.display_defaults,
        ...settings.display_defaults
      };
      for (const [key, text] of displayOptions[node.type] || []) {
        const label = el('label', {
            class: 'checkbox-label'
          }),
          control = el('input', {
            type: 'checkbox',
            'data-plugin-display': key
          });
        control.checked = Boolean(defaults[key]);
        label.append(control, document.createTextNode(pluginText(plugin, text)));
        presets.append(label);
        controls.push({
          key,
          control
        });
      }
      if (!controls.length) presets.remove();
      const configuration = el('section', { class: 'plugin-config-section' });
      const mapReaders = {};
      if (node.type === 'location') {
        configuration.append(
          el('h4', {}, t('Plugin-Einstellungen')),
          el(
            'p',
            { class: 'source-help' },
            t('Gilt für das gesamte Plugin, zum Beispiel Zugangsdaten und Quellenkonfiguration.')
          )
        );
        form.append(configuration);
      }
      if (node.type === 'location')
        for (const [key, title] of [
          ['map_preview_sources', 'Anbieter f\xFCr Glances'],
          ['map_action_sources', 'Anbieter f\xFCr Quick Actions']
        ])
          mapReaders[key] = mapSourcesControl(
            configuration,
            title,
            settings[key] || node[key] || [],
            changed
          );
      if (!controls.length && !Object.keys(mapReaders).length)
        form.append(
          el(
            'p',
            {
              class: 'source-help'
            },
            t('Dieser Daten-Node hat keine zus\xE4tzlichen Einstellungen.')
          )
        );
      return () => ({
        display_defaults: Object.fromEntries(controls.map((c) => [c.key, c.control.checked])),
        ...Object.fromEntries(Object.entries(mapReaders).map(([key, read]) => [key, read()]))
      });
    }
    return { providerFieldKeys, sourceOrderControl, mapSourcesControl, dataPluginSettings };
  }
};
export { plugin_sources_default };
export default plugin_sources_default;
