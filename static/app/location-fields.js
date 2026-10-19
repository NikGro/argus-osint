import { language } from '../i18n.js';
import { t } from '../i18n.js';
import phone_countries_default from '../phone-countries.js';
import searchable_select_default from '../searchable-select.js';
var location_fields_default = {
  name: 'location-fields',
  dependencies: ['el', 'measureEdgeText', 'svg'],
  create({ el, measureEdgeText, svg }) {
    function countryRegionSelect(value = '') {
      const select = el('select', {
        'data-field': 'phone_region'
      });
      select.append(
        el(
          'option',
          {
            value: ''
          },
          '+'
        )
      );
      const names = new Intl.DisplayNames([language], {
        type: 'region'
      });
      for (const [region, info] of Object.entries(phone_countries_default))
        select.append(
          el(
            'option',
            {
              value: region
            },
            names.of(region) + ' (' + info.code + ')'
          )
        );
      select.value = value;
      return select;
    }
    function formatLocation(data) {
      const parts = [
        ['street', 'house_number'],
        ['postal_code', 'locality'],
        ['dependent_locality'],
        ['admin_area_2'],
        ['admin_area_1'],
        ['country']
      ]
        .map((keys) =>
          keys
            .map((k) => String(data[k] || '').trim())
            .filter(Boolean)
            .join(' ')
        )
        .filter(Boolean);
      return [...new Set(parts)].join(', ');
    }
    function locationDisplayLines(data = {}, width) {
      const text = formatLocation(data) || data.formatted_address || t('ui.location'),
        maxWidth = width - 24,
        lines = [];
      let line = '';
      for (const word of text.split(/\s+/)) {
        const proposed = line ? line + ' ' + word : word;
        if (measureEdgeText(proposed) <= maxWidth) {
          line = proposed;
          continue;
        }
        if (line) lines.push(line);
        if (measureEdgeText(word) <= maxWidth) line = word;
        else {
          let fragment = '';
          for (const char of word) {
            if (measureEdgeText(fragment + char) > maxWidth && fragment) {
              lines.push(fragment);
              fragment = '';
            }
            fragment += char;
          }
          line = fragment;
        }
      }
      if (line) lines.push(line);
      return lines.length ? lines : [''];
    }
    function renderLocationAddress(group, node, bounds) {
      const text = svg('text', {
        x: 12,
        y: 60,
        fill: '#95a9c1',
        'font-size': 11
      });
      for (const [index, line] of locationDisplayLines(node.data, bounds.w).entries())
        text.append(
          svg(
            'tspan',
            {
              x: 12,
              dy: index ? 16 : 0
            },
            line
          )
        );
      group.append(text);
    }
    function splitPhoneNumber(value, preferred = '') {
      const raw = String(value || '').trim();
      if (!raw.startsWith('+'))
        return {
          region: phone_countries_default[preferred] ? preferred : '',
          national: raw
        };
      const compact = raw.replace(/[\s().-]/g, '');
      const countries = Object.entries(phone_countries_default).sort(
        (a, b) => b[1].code.length - a[1].code.length
      );
      const matching =
        phone_countries_default[preferred] &&
        compact.startsWith(phone_countries_default[preferred].code)
          ? [preferred, phone_countries_default[preferred]]
          : countries.find(([, info2]) => compact.startsWith(info2.code));
      if (!matching)
        return {
          region: '',
          national: raw
        };
      const [region, info] = matching;
      return {
        region,
        national: (raw.startsWith(info.code)
          ? raw.slice(info.code.length)
          : compact.slice(info.code.length)
        ).trim()
      };
    }
    function phoneControls(panel, node, readers) {
      const reader = readers.find((r) => r.path.join('.') === 'value'),
        input = reader?.control;
      if (!input) return;
      const select = el('select', {
          'aria-label': t('ui.country_calling_code'),
          class: 'phone-prefix'
        }),
        names = new Intl.DisplayNames([language], {
          type: 'region'
        });
      select.append(
        el(
          'option',
          {
            value: ''
          },
          '+'
        )
      );
      for (const [region, info] of Object.entries(phone_countries_default))
        select.append(
          el(
            'option',
            {
              value: region
            },
            info.code + ' \xB7 ' + names.of(region)
          )
        );
      const initial = splitPhoneNumber(node.data.value, node.display?.phoneRegion);
      select.value = initial.region;
      input.value = initial.national;
      input.type = 'tel';
      input.inputMode = 'tel';
      const placeholder = () => {
        const info = phone_countries_default[select.value];
        input.placeholder = info
          ? splitPhoneNumber(info.example, select.value).national
          : '176 12345678';
      };
      placeholder();
      reader.read = () => {
        const national = input.value.trim();
        if (!national) return '';
        return national.startsWith('+')
          ? national
          : (phone_countries_default[select.value]?.code || '') + national;
      };
      input.addEventListener('input', () => {
        if (input.value.trim().startsWith('+')) {
          const parsed = splitPhoneNumber(input.value, select.value);
          select.value = parsed.region;
          searchable_select_default.refresh(select);
          input.value = parsed.national;
          placeholder();
        }
        node.display = {
          ...node.display,
          phoneRegion: select.value
        };
      });
      select.addEventListener('change', () => {
        node.display = {
          ...node.display,
          phoneRegion: select.value
        };
        placeholder();
        input.dispatchEvent(
          new Event('input', {
            bubbles: true
          })
        );
      });
      const row = el('div', {
        class: 'phone-input'
      });
      input.before(row);
      row.append(select, input);
    }
    return {
      countryRegionSelect,
      formatLocation,
      locationDisplayLines,
      renderLocationAddress,
      splitPhoneNumber,
      phoneControls
    };
  }
};
export { location_fields_default };
export default location_fields_default;
