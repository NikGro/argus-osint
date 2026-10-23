import { t } from '../i18n.js';
import phone_countries_default from '../phone-countries.js';
var location_fields_default = {
  name: 'location-fields',
  dependencies: ['measureEdgeText'],
  create({ measureEdgeText }) {
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
    return { formatLocation, locationDisplayLines, splitPhoneNumber };
  }
};
export { location_fields_default };
export default location_fields_default;
