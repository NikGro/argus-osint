// Shared native UI primitives. Domain code is supplied through explicit callbacks.
const ArgusUI = (() => {
  const options = {
    translate: (value) => value,
    error: (error) => console.error(error),
    decorate: (node, label) => {
      node.textContent = label;
    },
    icon: () => document.createElement('span'),
    uid: () => crypto.randomUUID(),
    fieldName: (value) => value
  };
  const configure = (values) => Object.assign(options, values);
  function element(tag, attributes = {}, text, namespace = null) {
    const node = namespace ? document.createElementNS(namespace, tag) : document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (value === undefined || value === null || (value === false && !key.startsWith('aria-')))
        continue;
      node.setAttribute(key, String(value));
    }
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function el(tag, attributes = {}, text) {
    return element(tag, attributes, text);
  }
  function svg(tag, attributes = {}, text) {
    return element(tag, attributes, text, 'http://www.w3.org/2000/svg');
  }
  function button(text, callback, className) {
    const node = el('button', {
      type: 'button',
      ...(className ? { class: className } : {})
    });
    options.decorate(node, text);
    node.addEventListener('click', () => Promise.resolve().then(callback).catch(options.error));
    return node;
  }
  function checkbox(text, checked = false) {
    const label = el('label', { class: 'checkbox-label' });
    const input = el('input', { type: 'checkbox' });
    input.checked = checked;
    label.append(input, document.createTextNode(text));
    return { label, input };
  }
  function draggableDialog(dialog) {
    const handle = dialog.querySelector('h2');
    if (!handle || dialog.dataset.draggable) return;
    dialog.dataset.draggable = 'true';
    handle.classList.add('dialog-handle');
    let state = null;
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      state = {
        x: event.clientX,
        y: event.clientY,
        dx: Number(dialog.dataset.dx || 0),
        dy: Number(dialog.dataset.dy || 0),
        bounds: dialog.getBoundingClientRect()
      };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (!state) return;
      const dx = Math.max(
        -state.bounds.left,
        Math.min(innerWidth - state.bounds.right, event.clientX - state.x)
      );
      const dy = Math.max(
        -state.bounds.top,
        Math.min(innerHeight - state.bounds.bottom, event.clientY - state.y)
      );
      dialog.dataset.dx = state.dx + dx;
      dialog.dataset.dy = state.dy + dy;
      dialog.style.transform = `translate(${state.dx + dx}px, ${state.dy + dy}px)`;
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
      handle.addEventListener(type, () => {
        state = null;
      });
  }
  function frame(title, build) {
    return new Promise((resolve) => {
      const previousFocus = document.activeElement;
      const dialog = el('dialog', { class: 'manual-dialog' });
      const titleId = 'dialog-title-' + options.uid();
      dialog.setAttribute('aria-labelledby', titleId);
      dialog.append(el('h2', { id: titleId }, title));
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        dialog.close();
        dialog.remove();
        previousFocus?.isConnected && previousFocus.focus();
        resolve(value);
      };
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        finish(null);
      });
      build(dialog, finish);
      document.body.append(dialog);
      draggableDialog(dialog);
      dialog.showModal();
      dialog.querySelector('input:not([type=checkbox]),select,button')?.focus();
    });
  }
  function modalChoice(title, message, choices) {
    return frame(title, (dialog, finish) => {
      dialog.append(el('p', {}, message));
      const list = el('div', { class: 'modal-choice-list' });
      for (const choice of choices)
        list.append(button(choice.label, () => finish(choice.value), 'wide'));
      dialog.append(
        list,
        button(options.translate('Abbrechen'), () => finish(null))
      );
    });
  }
  function notice({ title, message, checkboxText, actions }) {
    if (options.notice) return options.notice({ title, message, checkboxText, actions });
    return frame(title, (dialog, finish) => {
      dialog.append(el('p', {}, message));
      const remember = checkbox(checkboxText);
      dialog.append(remember.label);
      const buttons = el('div', { class: 'dialog-actions' });
      for (const action of actions)
        buttons.append(
          button(
            action.label,
            () => finish({ action: action.id, checked: remember.input.checked }),
            action.primary ? 'primary' : ''
          )
        );
      dialog.append(buttons);
    });
  }
  function parameterModal(request, defaults = {}) {
    return frame(options.translate(request.title || 'Eingabe erforderlich'), (dialog, finish) => {
      if (request.message) dialog.append(el('p', {}, options.translate(request.message)));
      const form = el('form');
      const fields = [];
      for (const field of request.fields || []) {
        if (!/^[a-zA-Z_][\w.-]*$/.test(field.key || '')) continue;
        const id = 'field-' + options.uid();
        const label = el(
          'label',
          { for: id },
          options.translate(
            String(field.label || field.key)
              .split('.')
              .map(options.fieldName)
              .join(' / ')
          )
        );
        let input;
        if (field.type === 'checkbox') {
          input = el('input', { id, type: 'checkbox' });
          input.checked = Boolean(field.default ?? defaults[field.key]);
          input.required = Boolean(field.required);
        } else if (Array.isArray(field.options)) {
          input = el('select', { id, required: '' });
          input.append(el('option', { value: '' }, options.translate('Bitte auswählen')));
          for (const item of field.options)
            input.append(el('option', { value: String(item.value) }, item.label));
        } else {
          input = el('input', {
            id,
            type: ['number', 'password', 'email', 'url'].includes(field.type) ? field.type : 'text',
            autocomplete: field.type === 'password' ? 'one-time-code' : 'off'
          });
          input.required = Boolean(field.required);
          if (Number.isInteger(field.maxLength) && field.maxLength > 0)
            input.maxLength = field.maxLength;
          input.value = field.transient ? '' : (defaults[field.key] ?? field.default ?? '');
        }
        form.append(label, input);
        fields.push({ key: field.key, input });
      }
      const actions = el('div', { class: 'dialog-actions' });
      actions.append(
        button(options.translate('Abbrechen'), () => finish(null)),
        el('button', { type: 'submit', class: 'primary' }, options.translate('Fortsetzen'))
      );
      form.append(actions);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        finish({
          ...Object.fromEntries(
            fields.map((field) => [
              field.key,
              field.input.type === 'checkbox'
                ? field.input.checked
                : field.input.type === 'number'
                  ? Number(field.input.value)
                  : field.input.value
            ])
          ),
          ...(request.kind === 'merge' ? { _merge_fingerprint: request.fingerprint } : {})
        });
      });
      dialog.append(form);
    });
  }
  return Object.freeze({
    configure,
    el,
    svg,
    button,
    checkbox,
    draggableDialog,
    modalChoice,
    parameterModal,
    notice
  });
})();

export default ArgusUI;
