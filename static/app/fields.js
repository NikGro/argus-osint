import { fieldNames } from './labels.js';
import { t } from '../i18n.js';
import { language } from '../i18n.js';
import form_sections_default from '../form-sections.js';
import location_countries_default from '../location-countries.js';
var fields_default = {
  name: 'fields',
  dependencies: ['countryRegionSelect', 'el', 'providerField', 'uid'],
  create({ countryRegionSelect, el, providerField, uid }) {
    function fieldName(key) {
      return fieldNames[key] ? t(fieldNames[key]) : String(key).replaceAll('_', ' ');
    }
    function inputField(parent, label, value, id) {
      const fid = id || 'field-' + uid();
      parent.append(
        el(
          'label',
          {
            for: fid
          },
          label
        )
      );
      const n = el('input', {
        id: fid
      });
      n.value = value ?? '';
      parent.append(n);
      return n;
    }
    function facts(parent, data) {
      const list = el('dl', {
        class: 'facts'
      });
      for (const [key, value] of Object.entries(data || {})) {
        if (value === null || value === '') continue;
        list.append(el('dt', {}, fieldName(key)));
        const item = el('dd');
        if (typeof value === 'object') {
          const detail = el('details');
          detail.append(
            el(
              'summary',
              {},
              Array.isArray(value) ? value.length + t(' Eintr\xE4ge') : t('Details anzeigen')
            )
          );
          facts(detail, value);
          item.append(detail);
        } else item.textContent = String(value);
        list.append(item);
      }
      parent.append(list);
    }
    function readField(control, original, key) {
      if (control.type === 'checkbox') return control.checked;
      if (Array.isArray(original))
        return control.value
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean);
      if (control.type === 'number' || control.type === 'range') {
        if (control.value.trim() === '') return null;
        const n = Number(control.value);
        if (!Number.isFinite(n))
          throw Error(t('Bitte eine g\xFCltige Zahl f\xFCr ') + fieldName(key) + t(' eingeben.'));
        return n;
      }
      return control.value;
    }
    function editFields(parent, data, path = [], translate = t, options = {}) {
      const grouped = !path.length
          ? form_sections_default.sections(
              parent,
              data,
              options.sections || [],
              translate,
              options.help || ''
            )
          : {
              readers: [],
              keys: /* @__PURE__ */ new Set()
            },
        readers = [...grouped.readers];
      for (const [key, value] of Object.entries(data)) {
        if (grouped.keys.has(key)) continue;
        if (key === 'country' && 'country_code' in data) {
          const row = el('div', {
              class: 'country-row'
            }),
            control2 = el('select', {
              'data-field': [...path, 'country'].join('.'),
              'aria-label': translate('Land')
            }),
            code = el('input', {
              type: 'text',
              readonly: '',
              'data-field': [...path, 'country_code'].join('.'),
              'aria-label': translate('L\xE4ndercode'),
              tabindex: '-1'
            });
          control2.append(
            el(
              'option',
              {
                value: ''
              },
              'Any'
            )
          );
          const names = new Intl.DisplayNames([language], {
            type: 'region'
          });
          const codes = [...location_countries_default];
          if (data.country_code && !codes.includes(data.country_code))
            codes.push(data.country_code);
          const options2 = codes
            .map((c) => ({
              code: c,
              name: names.of(c) || c
            }))
            .sort((a, b) => a.name.localeCompare(b.name, language));
          for (const option of options2)
            control2.append(
              el(
                'option',
                {
                  value: option.code
                },
                option.name
              )
            );
          control2.value = data.country_code || '';
          if (!data.country_code && value) {
            control2.append(
              el(
                'option',
                {
                  value: '__provider'
                },
                value
              )
            );
            control2.value = '__provider';
          }
          code.value = data.country_code || '';
          control2.addEventListener('input', () => {
            code.value = control2.value === '__provider' ? data.country_code || '' : control2.value;
          });
          parent.append(el('label', {}, translate('Land')));
          row.append(control2, code);
          parent.append(row);
          readers.push(
            {
              control: control2,
              path: [...path, 'country'],
              read: () =>
                control2.value === '__provider'
                  ? value
                  : control2.value
                    ? names.of(control2.value) || control2.value
                    : ''
            },
            {
              control: code,
              path: [...path, 'country_code'],
              read: () => code.value
            }
          );
          continue;
        }
        if (key === 'country_code' && 'country' in data) continue;
        if (
          [
            'file_id',
            'metadata',
            'status',
            'provider_result',
            'conflicts',
            'code',
            'enrich'
          ].includes(key)
        )
          continue;
        const fieldPath = [...path, key];
        const schema = options.schema?.[key] || {};
        if (Array.isArray(schema.enum)) {
          const id = 'field-' + uid(),
            control = el('select', { id, 'data-field': fieldPath.join('.') });
          for (const choice of schema.enum)
            control.append(el('option', { value: choice }, translate(choice)));
          control.value = value;
          parent.append(el('label', { for: id }, translate(fieldNames[key] || key)), control);
          readers.push({ control, path: fieldPath, read: () => control.value });
          continue;
        }
        if (schema.control === 'range') {
          const id = 'field-' + uid(),
            row = el('div', { class: 'range-field' });
          const control = el('input', {
            id,
            type: 'range',
            min: schema.min,
            max: schema.max,
            step: schema.step,
            'data-field': fieldPath.join('.')
          });
          const number = el('input', {
            type: 'number',
            min: schema.min,
            max: schema.max,
            step: schema.step,
            'aria-label': translate(fieldNames[key] || key)
          });
          control.value = number.value = value;
          let fromNumber = false;
          control.addEventListener('input', () => {
            if (!fromNumber) number.value = control.value;
          });
          number.addEventListener('input', () => {
            if (!number.value || !number.validity.valid) return;
            control.value = number.value;
            fromNumber = true;
            control.dispatchEvent(new Event('input', { bubbles: true }));
            fromNumber = false;
          });
          parent.append(el('label', { for: id }, translate(fieldNames[key] || key)));
          row.append(control, number);
          parent.append(row);
          readers.push({ control, path: fieldPath, read: () => readField(number, value, key) });
          continue;
        }
        if (key === 'provider' && 'identifier' in data && 'url' in data) {
          readers.push(providerField(parent, value, fieldPath, translate));
          continue;
        }
        if (key === 'birth_country') {
          const control2 = el('select', {
              'data-field': fieldPath.join('.')
            }),
            names = new Intl.DisplayNames([language], {
              type: 'region'
            });
          control2.append(
            el(
              'option',
              {
                value: ''
              },
              t('Nicht angegeben')
            )
          );
          for (const option of [...location_countries_default]
            .map((code) => ({
              code,
              name: names.of(code) || code
            }))
            .sort((a, b) => a.name.localeCompare(b.name, language)))
            control2.append(
              el(
                'option',
                {
                  value: option.code
                },
                option.name
              )
            );
          control2.value = value || '';
          parent.append(el('label', {}, translate(key)), control2);
          readers.push({
            control: control2,
            path: fieldPath,
            read: () => control2.value
          });
          continue;
        }
        if (key === 'timezone') {
          const control2 = el('select', {
            'data-field': fieldPath.join('.')
          });
          const zones = [
            .../* @__PURE__ */ new Set([
              'UTC',
              ...(Intl.supportedValuesOf?.('timeZone') || [
                'Europe/Berlin',
                'Europe/London',
                'America/New_York',
                'Asia/Tokyo'
              ]),
              ...(value ? [value] : [])
            ])
          ];
          for (const zone of zones)
           control2.append(
              el(
                'option',
                {
                  value: zone
                },
                zone
              )
            );
          control2.value = value || 'UTC';
          parent.append(el('label', {}, translate('Zeitzone')), control2);
          readers.push({
            control: control2,
            path: fieldPath,
            read: () => control2.value
          });
          continue;
        }
        if (key === 'identifier_kind') {
          const control2 = el('select', {
            'data-field': fieldPath.join('.')
          });
          for (const [id, text] of [
            ['auto', 'Automatisch'],
            ['username', 'Benutzername'],
            ['email', 'E-Mail'],
            ['phone', 'Telefonnummer'],
            ['id', 'Andere ID']
          ])
            control2.append(
              el(
                'option',
                {
                  value: id
                },
                translate(text)
              )
            );
          control2.value = value || 'auto';
          parent.append(el('label', {}, translate('Identifier-Typ')), control2);
          readers.push({
            control: control2,
            path: fieldPath,
            read: () => control2.value
          });
          continue;
        }
        if (key === 'phone_region') {
          const control2 = countryRegionSelect(value);
          parent.append(el('label', {}, t('L\xE4ndervorwahl')), control2);
          readers.push({
            control: control2,
            path: fieldPath,
            read: () => control2.value
          });
          continue;
        }
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const section = el('details', {
            class: 'field-section',
            open: ''
          });
          section.append(el('summary', {}, fieldName(key)));
          readers.push(...editFields(section, value, fieldPath, translate, options));
          parent.append(section);
          continue;
        }
        if (Array.isArray(value) && !value.every((x) => typeof x === 'string')) {
          const detail = el('details');
          detail.append(el('summary', {}, fieldName(key)));
          facts(detail, value);
          parent.append(detail);
          continue;
        }
        const fid = 'field-' + uid();
        const numeric =
          typeof value === 'number' ||
          ['latitude', 'longitude', 'request_timeout', 'run_timeout', 'max_results'].includes(key);
        const multiline =
          Array.isArray(value) ||
          key === 'text' ||
          key === 'message' ||
          key === 'original_input' ||
          (typeof value === 'string' && value.length > 140);
        parent.append(
          el(
            'label',
            {
              for: fid
            },
            translate(fieldNames[key] || key)
          )
        );
        const control = el(multiline ? 'textarea' : 'input', {
          id: fid,
          'data-field': fieldPath.join('.'),
          ...(multiline
            ? {
                rows: Array.isArray(value) ? 3 : 4
              }
            : {
                type: ['date', 'birth_date'].includes(key)
                  ? 'date'
                  : key === 'time'
                    ? 'time'
                    : typeof value === 'boolean'
                      ? 'checkbox'
                      : numeric
                        ? 'number'
                        : options.schema?.[key]?.secret === true ||
                            /(api_?key|token|secret|password|sessionid|cookie|authorization)$/i.test(
                              key
                            )
                          ? 'password'
                          : 'text'
              })
        });
        if (control.type === 'password') {
          control.addEventListener('focus', () => {
            if (/^•+$/.test(control.value)) control.select();
          });
        }
        if (numeric) control.setAttribute('step', 'any');
        if (key === 'time') control.setAttribute('step', '1');
        if (typeof value === 'boolean') control.checked = value;
        else control.value = Array.isArray(value) ? value.join('\n') : (value ?? '');
        parent.append(control);
        readers.push({
          control,
          path: fieldPath,
          read: () => readField(control, value, key)
        });
      }
      return readers;
    }
    function applyFields(data, readers) {
      const result = structuredClone(data);
      for (const item of readers) {
        let target = result;
        for (const key of item.path.slice(0, -1)) target = target[key];
        target[item.path.at(-1)] = item.read();
      }
      return result;
    }
    return { fieldName, inputField, facts, readField, editFields, applyFields };
  }
};
export { fields_default };
export default fields_default;
