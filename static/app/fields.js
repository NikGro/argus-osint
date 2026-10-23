import { fieldNames } from './labels.js';
import { t } from '../i18n.js';
var fields_default = {
  name: 'fields',
  dependencies: [],
  create() {
    function fieldName(key) {
      return fieldNames[key] ? t(fieldNames[key]) : String(key).replaceAll('_', ' ');
    }
    return { fieldName };
  }
};
export { fields_default };
export default fields_default;
