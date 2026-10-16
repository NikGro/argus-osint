var bindings_default = {
  name: 'bindings',
  dependencies: [
    'configureUi',
    'bindNavigation',
    'bindWorkspace',
    'bindCanvas',
    'bindShortcuts',
    'bindLifecycle'
  ],
  create({ configureUi, bindNavigation, bindWorkspace, bindCanvas, bindShortcuts, bindLifecycle }) {
    return {
      initialize() {
        configureUi();
        bindNavigation();
        bindWorkspace();
        bindCanvas();
        bindShortcuts();
        bindLifecycle();
      }
    };
  }
};
export { bindings_default };
export default bindings_default;
