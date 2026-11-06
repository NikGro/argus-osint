import { fieldNames } from './labels.js';
var fields_default = {
  name: 'fields',
  dependencies: [],
  create() {
    function fieldName(key) {
      return fieldNames[key] ? fieldNames[key] : String(key).replaceAll('_', ' ');
    }
    return { fieldName };
  }
};
export { fields_default };
export default fields_default;
