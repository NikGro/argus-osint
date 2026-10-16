import ui_default from '../ui.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
var bindings_configure_ui_default = {
  name: 'configureUi',
  dependencies: ['decorateButton', 'fieldName', 'toast', 'uid'],
  create({ decorateButton, fieldName, toast, uid }) {
    function configureUi() {
      ui_default.configure({
        translate: (key) => t(key),
        error: (error) => toast(error.message),
        decorate: (node, label) => decorateButton(node, label),
        icon: (name) => icon(name),
        uid: () => uid(),
        fieldName: (key) => fieldName(key)
      });
    }
    return { configureUi };
  }
};
export { bindings_configure_ui_default };
export default bindings_configure_ui_default;
