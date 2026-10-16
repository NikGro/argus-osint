// static/ui.js
var ArgusUI = (() => {
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
      if (value === void 0 || value === null || (value === false && !key.startsWith('aria-')))
        continue;
      node.setAttribute(key, String(value));
    }
    if (text !== void 0) node.textContent = text;
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
          input.append(el('option', { value: '' }, options.translate('Bitte ausw\xE4hlen')));
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
var ui_default = ArgusUI;

// static/i18n.js
var language = 'de';
var messages = {};
var fallbackMessages = {};
function t(key, params = {}) {
  if (key === void 0 || key === null) return '';
  let value = messages[key] ?? fallbackMessages[key];
  if (value === void 0) {
    value = String(key);
    for (const source of Object.keys(messages).sort((a, b) => b.length - a.length)) {
      if (source.length < 10) continue;
      if (value.startsWith(source)) {
        value = messages[source] + value.slice(source.length);
        break;
      }
      if (value.endsWith(source)) {
        value = value.slice(0, -source.length) + messages[source];
        break;
      }
    }
  }
  for (const [name, text] of Object.entries(params))
    value = value.replaceAll('{' + name + '}', String(text));
  return value;
}
function diagnostic(value) {
  let text = String(value ?? '');
  for (const source of Object.keys(messages).sort((a, b) => b.length - a.length)) {
    if (source.length >= 10 && source !== messages[source])
      text = text.replaceAll(source, messages[source]);
  }
  return text;
}
async function setLanguage(code) {
  const response = await fetch('/locales/' + encodeURIComponent(code) + '.json');
  if (!response.ok) throw Error('Language pack unavailable');
  const pack = await response.json();
  if (!Object.keys(fallbackMessages).length) {
    const fallback = await fetch('/locales/de.json');
    fallbackMessages = (await fallback.json()).messages;
  }
  language = code;
  messages = pack.messages;
  document.documentElement.lang = code;
  localStorage.setItem('argus.language', code);
  for (const element of document.querySelectorAll('[data-i18n]'))
    element.textContent = t(element.dataset.i18n);
  for (const attr of ['placeholder', 'aria-label', 'title'])
    for (const element of document.querySelectorAll('[data-i18n-' + attr + ']'))
      element.setAttribute(attr, t(element.getAttribute('data-i18n-' + attr)));
  document.dispatchEvent(new Event('argus:language'));
}

// static/icons.js
var ICON_PATHS = {
  refresh: [
    'M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.09A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h8V3z'
  ],
  download: ['M5 20h14v-2H5m14-9h-4V3H9v6H5l7 7z'],
  vpn: [
    'M12 2 3 6v6c0 5 3.8 9.5 9 11 5.2-1.5 9-6 9-11V6l-9-4m0 2.2 7 3.1V12c0 3.9-2.8 7.5-7 8.9C7.8 19.5 5 15.9 5 12V7.3l7-3.1m-1 4.8v5l4 2 1-1.7-3-1.6V9z'
  ],
  close: [
    'M18.3 5.7L12 12L5.7 5.7L4.3 7.1L10.6 13.4L4.3 19.7L5.7 21.1L12 14.8L18.3 21.1L19.7 19.7L13.4 13.4L19.7 7.1Z'
  ],
  home: ['M10 20V14H14V20H19V11H22L12 2L2 11H5V20H10Z'],
  trash: [
    'M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19M8,9H16V19H8V9M15.5,4L14.5,3H9.5L8.5,4H5V6H19V4H15.5Z'
  ],
  archive: [
    'M20 21H4V10H6V19H18V10H20V21M3 3H21V9H3V3M5 5V7H19V5M10.5 11V14H8L12 18L16 14H13.5V11'
  ],
  restore: [
    'M20 21H4V10H6V19H18V10H20V21M3 3H21V9H3V3M5 5V7H19V5M10.5 17V14H8L12 10L16 14H13.5V17'
  ],
  settings: [
    'M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8M12,10A2,2 0 0,0 10,12A2,2 0 0,0 12,14A2,2 0 0,0 14,12A2,2 0 0,0 12,10M10,22C9.75,22 9.54,21.82 9.5,21.58L9.13,18.93C8.5,18.68 7.96,18.34 7.44,17.94L4.95,18.95C4.73,19.03 4.46,18.95 4.34,18.73L2.34,15.27C2.21,15.05 2.27,14.78 2.46,14.63L4.57,12.97L4.5,12L4.57,11L2.46,9.37C2.27,9.22 2.21,8.95 2.34,8.73L4.34,5.27C4.46,5.05 4.73,4.96 4.95,5.05L7.44,6.05C7.96,5.66 8.5,5.32 9.13,5.07L9.5,2.42C9.54,2.18 9.75,2 10,2H14C14.25,2 14.46,2.18 14.5,2.42L14.87,5.07C15.5,5.32 16.04,5.66 16.56,6.05L19.05,5.05C19.27,4.96 19.54,5.05 19.66,5.27L21.66,8.73C21.79,8.95 21.73,9.22 21.54,9.37L19.43,11L19.5,12L19.43,13L21.54,14.63C21.73,14.78 21.79,15.05 21.66,15.27L19.66,18.73C19.54,18.95 19.27,19.04 19.05,18.95L16.56,17.95C16.04,18.34 15.5,18.68 14.87,18.93L14.5,21.58C14.46,21.82 14.25,22 14,22H10M11.25,4L10.88,6.61C9.68,6.86 8.62,7.5 7.85,8.39L5.44,7.35L4.69,8.65L6.8,10.2C6.4,11.37 6.4,12.64 6.8,13.8L4.68,15.36L5.43,16.66L7.86,15.62C8.63,16.5 9.68,17.14 10.87,17.38L11.24,20H12.76L13.13,17.39C14.32,17.14 15.37,16.5 16.14,15.62L18.57,16.66L19.32,15.36L17.2,13.81C17.6,12.64 17.6,11.37 17.2,10.2L19.31,8.65L18.56,7.35L16.15,8.39C15.38,7.5 14.32,6.86 13.12,6.62L12.75,4H11.25Z'
  ],
  'search-plus': [
    'M15.5,14L20.5,19L19,20.5L14,15.5V14.71L13.73,14.43C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.43,13.73L14.71,14H15.5M9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14M12,10H10V12H9V10H7V9H9V7H10V9H12V10Z'
  ],
  'search-minus': [
    'M15.5,14H14.71L14.43,13.73C15.41,12.59 16,11.11 16,9.5A6.5,6.5 0 0,0 9.5,3A6.5,6.5 0 0,0 3,9.5A6.5,6.5 0 0,0 9.5,16C11.11,16 12.59,15.41 13.73,14.43L14,14.71V15.5L19,20.5L20.5,19L15.5,14M9.5,14C7,14 5,12 5,9.5C5,7 7,5 9.5,5C12,5 14,7 14,9.5C14,12 12,14 9.5,14M7,9H12V10H7V9Z'
  ],
  center: [
    'M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M19,19H15V21H19A2,2 0 0,0 21,19V15H19M19,3H15V5H19V9H21V5A2,2 0 0,0 19,3M5,5H9V3H5A2,2 0 0,0 3,5V9H5M5,15H3V19A2,2 0 0,0 5,21H9V19H5V15Z'
  ],
  group: [
    'M1,1V5H2V19H1V23H5V22H19V23H23V19H22V5H23V1H19V2H5V1M5,4H19V5H20V19H19V20H5V19H4V5H5M6,6V14H9V18H18V9H14V6M8,8H12V12H8M14,11H16V16H11V14H14'
  ],
  link: [
    'M10.59,13.41C11,13.8 11,14.44 10.59,14.83C10.2,15.22 9.56,15.22 9.17,14.83C7.22,12.88 7.22,9.71 9.17,7.76V7.76L12.71,4.22C14.66,2.27 17.83,2.27 19.78,4.22C21.73,6.17 21.73,9.34 19.78,11.29L18.29,12.78C18.3,11.96 18.17,11.14 17.89,10.36L18.36,9.88C19.54,8.71 19.54,6.81 18.36,5.64C17.19,4.46 15.29,4.46 14.12,5.64L10.59,9.17C9.41,10.34 9.41,12.24 10.59,13.41M13.41,9.17C13.8,8.78 14.44,8.78 14.83,9.17C16.78,11.12 16.78,14.29 14.83,16.24V16.24L11.29,19.78C9.34,21.73 6.17,21.73 4.22,19.78C2.27,17.83 2.27,14.66 4.22,12.71L5.71,11.22C5.7,12.04 5.83,12.86 6.11,13.65L5.64,14.12C4.46,15.29 4.46,17.19 5.64,18.36C6.81,19.54 8.71,19.54 9.88,18.36L13.41,14.83C14.59,13.66 14.59,11.76 13.41,10.59C13,10.2 13,9.56 13.41,9.17Z'
  ],
  cleanup: [
    'M19.36,2.72L20.78,4.14L15.06,9.85C16.13,11.39 16.28,13.24 15.38,14.44L9.06,8.12C10.26,7.22 12.11,7.37 13.65,8.44L19.36,2.72M5.93,17.57C3.92,15.56 2.69,13.16 2.35,10.92L7.23,8.83L14.67,16.27L12.58,21.15C10.34,20.81 7.94,19.58 5.93,17.57Z'
  ],
  save: [
    'M17 3H5C3.89 3 3 3.9 3 5V19C3 20.1 3.89 21 5 21H19C20.1 21 21 20.1 21 19V7L17 3M19 19H5V5H16.17L19 7.83V19M12 12C10.34 12 9 13.34 9 15S10.34 18 12 18 15 16.66 15 15 13.66 12 12 12M6 6H15V10H6V6Z'
  ],
  check: ['M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z'],
  file: [
    'M6,2A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2H6M6,4H13V9H18V20H6V4M8,12V14H16V12H8M8,16V18H13V16H8Z'
  ],
  nodes: [
    'M19.5 17C19.36 17 19.24 17 19.11 17.04L17.5 13.8C17.95 13.35 18.25 12.71 18.25 12C18.25 10.62 17.13 9.5 15.75 9.5C15.61 9.5 15.5 9.5 15.35 9.54L13.74 6.3C14.21 5.84 14.5 5.21 14.5 4.5C14.5 3.12 13.38 2 12 2S9.5 3.12 9.5 4.5C9.5 5.2 9.79 5.84 10.26 6.29L8.65 9.54C8.5 9.5 8.39 9.5 8.25 9.5C6.87 9.5 5.75 10.62 5.75 12C5.75 12.71 6.04 13.34 6.5 13.79L4.89 17.04C4.76 17 4.64 17 4.5 17C3.12 17 2 18.12 2 19.5C2 20.88 3.12 22 4.5 22S7 20.88 7 19.5C7 18.8 6.71 18.16 6.24 17.71L7.86 14.46C8 14.5 8.12 14.5 8.25 14.5C8.38 14.5 8.5 14.5 8.63 14.46L10.26 17.71C9.79 18.16 9.5 18.8 9.5 19.5C9.5 20.88 10.62 22 12 22S14.5 20.88 14.5 19.5C14.5 18.12 13.38 17 12 17C11.87 17 11.74 17 11.61 17.04L10 13.8C10.45 13.35 10.75 12.71 10.75 12C10.75 11.3 10.46 10.67 10 10.21L11.61 6.96C11.74 7 11.87 7 12 7C12.13 7 12.26 7 12.39 6.96L14 10.21C13.54 10.66 13.25 11.3 13.25 12C13.25 13.38 14.37 14.5 15.75 14.5C15.88 14.5 16 14.5 16.13 14.46L17.76 17.71C17.29 18.16 17 18.8 17 19.5C17 20.88 18.12 22 19.5 22S22 20.88 22 19.5C22 18.12 20.88 17 19.5 17M4.5 20.5C3.95 20.5 3.5 20.05 3.5 19.5S3.95 18.5 4.5 18.5 5.5 18.95 5.5 19.5 5.05 20.5 4.5 20.5M13 19.5C13 20.05 12.55 20.5 12 20.5S11 20.05 11 19.5 11.45 18.5 12 18.5 13 18.95 13 19.5M7.25 12C7.25 11.45 7.7 11 8.25 11S9.25 11.45 9.25 12 8.8 13 8.25 13 7.25 12.55 7.25 12M11 4.5C11 3.95 11.45 3.5 12 3.5S13 3.95 13 4.5 12.55 5.5 12 5.5 11 5.05 11 4.5M14.75 12C14.75 11.45 15.2 11 15.75 11S16.75 11.45 16.75 12 16.3 13 15.75 13 14.75 12.55 14.75 12M19.5 20.5C18.95 20.5 18.5 20.05 18.5 19.5S18.95 18.5 19.5 18.5 20.5 18.95 20.5 19.5 20.05 20.5 19.5 20.5Z'
  ],
  plugin: [
    'M22,13.5C22,15.26 20.7,16.72 19,16.96V20A2,2 0 0,1 17,22H13.2V21.7A2.7,2.7 0 0,0 10.5,19C9,19 7.8,20.21 7.8,21.7V22H4A2,2 0 0,1 2,20V16.2H2.3C3.79,16.2 5,15 5,13.5C5,12 3.79,10.8 2.3,10.8H2V7A2,2 0 0,1 4,5H7.04C7.28,3.3 8.74,2 10.5,2C12.26,2 13.72,3.3 13.96,5H17A2,2 0 0,1 19,7V10.04C20.7,10.28 22,11.74 22,13.5M17,15H18.5A1.5,1.5 0 0,0 20,13.5A1.5,1.5 0 0,0 18.5,12H17V7H12V5.5A1.5,1.5 0 0,0 10.5,4A1.5,1.5 0 0,0 9,5.5V7H4V9.12C5.76,9.8 7,11.5 7,13.5C7,15.5 5.75,17.2 4,17.88V20H6.12C6.8,18.25 8.5,17 10.5,17C12.5,17 14.2,18.25 14.88,20H17V15Z'
  ],
  back: ['M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z'],
  plus: ['M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z'],
  edit: [
    'M14.06,9L15,9.94L5.92,19H5V18.08L14.06,9M17.66,3C17.41,3 17.15,3.1 16.96,3.29L15.13,5.12L18.88,8.87L20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18.17,3.09 17.92,3 17.66,3M14.06,6.19L3,17.25V21H6.75L17.81,9.94L14.06,6.19Z'
  ],
  undo: [
    'M12.5,8C9.85,8 7.45,9 5.6,10.6L2,7V16H11L7.38,12.38C8.77,11.22 10.54,10.5 12.5,10.5C16.04,10.5 19.05,12.81 20.1,16L22.47,15.22C21.08,11.03 17.15,8 12.5,8Z'
  ],
  redo: [
    'M18.4,10.6C16.55,9 14.15,8 11.5,8C6.85,8 2.92,11.03 1.54,15.22L3.9,16C4.95,12.81 7.95,10.5 11.5,10.5C13.45,10.5 15.23,11.22 16.62,12.38L13,16H22V7L18.4,10.6Z'
  ],
  logs: [
    'M7,5H21V7H7V5M7,13V11H21V13H7M4,4.5A1.5,1.5 0 0,1 5.5,6A1.5,1.5 0 0,1 4,7.5A1.5,1.5 0 0,1 2.5,6A1.5,1.5 0 0,1 4,4.5M4,10.5A1.5,1.5 0 0,1 5.5,12A1.5,1.5 0 0,1 4,13.5A1.5,1.5 0 0,1 2.5,12A1.5,1.5 0 0,1 4,10.5M7,19V17H21V19H7M4,16.5A1.5,1.5 0 0,1 5.5,18A1.5,1.5 0 0,1 4,19.5A1.5,1.5 0 0,1 2.5,18A1.5,1.5 0 0,1 4,16.5Z'
  ],
  export: ['M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z'],
  'chevron-left': ['M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z'],
  'chevron-right': ['M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z'],
  folder: [
    'M20,18H4V8H20M20,6H12L10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6Z'
  ],
  email: [
    'M22 6C22 4.9 21.1 4 20 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6M20 6L12 11L4 6H20M20 18H4V8L12 13L20 8V18Z'
  ],
  phone: [
    'M20,15.5C18.8,15.5 17.5,15.3 16.4,14.9C16.3,14.9 16.2,14.9 16.1,14.9C15.8,14.9 15.6,15 15.4,15.2L13.2,17.4C10.4,15.9 8,13.6 6.6,10.8L8.8,8.6C9.1,8.3 9.2,7.9 9,7.6C8.7,6.5 8.5,5.2 8.5,4C8.5,3.5 8,3 7.5,3H4C3.5,3 3,3.5 3,4C3,13.4 10.6,21 20,21C20.5,21 21,20.5 21,20V16.5C21,16 20.5,15.5 20,15.5M5,5H6.5C6.6,5.9 6.8,6.8 7,7.6L5.8,8.8C5.4,7.6 5.1,6.3 5,5M19,19C17.7,18.9 16.4,18.6 15.2,18.2L16.4,17C17.2,17.2 18.1,17.4 19,17.4V19Z'
  ],
  account: [
    'M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,6A2,2 0 0,0 10,8A2,2 0 0,0 12,10A2,2 0 0,0 14,8A2,2 0 0,0 12,6M12,13C14.67,13 20,14.33 20,17V20H4V17C4,14.33 9.33,13 12,13M12,14.9C9.03,14.9 5.9,16.36 5.9,17V18.1H18.1V17C18.1,16.36 14.97,14.9 12,14.9Z'
  ],
  map: [
    'M12,6.5A2.5,2.5 0 0,1 14.5,9A2.5,2.5 0 0,1 12,11.5A2.5,2.5 0 0,1 9.5,9A2.5,2.5 0 0,1 12,6.5M12,2A7,7 0 0,1 19,9C19,14.25 12,22 12,22C12,22 5,14.25 5,9A7,7 0 0,1 12,2M12,4A5,5 0 0,0 7,9C7,10 7,12 12,18.71C17,12 17,10 17,9A5,5 0 0,0 12,4Z'
  ],
  note: [
    'M15 3H5A2 2 0 0 0 3 5V19A2 2 0 0 0 5 21H19A2 2 0 0 0 21 19V9L15 3M19 19H5V5H14V10H19M17 14H7V12H17M14 17H7V15H14'
  ],
  image: [
    'M19,19H5V5H19M19,3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5A2,2 0 0,0 19,3M13.96,12.29L11.21,15.83L9.25,13.47L6.5,17H17.5L13.96,12.29Z'
  ],
  calendar: [
    'M6 1V3H5C3.89 3 3 3.89 3 5V19C3 20.1 3.89 21 5 21H11.1C12.36 22.24 14.09 23 16 23C19.87 23 23 19.87 23 16C23 14.09 22.24 12.36 21 11.1V5C21 3.9 20.11 3 19 3H18V1H16V3H8V1M5 5H19V7H5M5 9H19V9.67C18.09 9.24 17.07 9 16 9C12.13 9 9 12.13 9 16C9 17.07 9.24 18.09 9.67 19H5M16 11.15C18.68 11.15 20.85 13.32 20.85 16C20.85 18.68 18.68 20.85 16 20.85C13.32 20.85 11.15 18.68 11.15 16C11.15 13.32 13.32 11.15 16 11.15M15 13V16.69L18.19 18.53L18.94 17.23L16.5 15.82V13Z'
  ],
  value: [
    'M5,3C3.89,3 3,3.89 3,5V19C3,20.11 3.89,21 5,21H19C20.11,21 21,20.11 21,19V5C21,3.89 20.11,3 19,3H5M5,5H19V19H5V5M7,7V9H17V7H7M7,11V13H17V11H7M7,15V17H14V15H7Z'
  ],
  'email-search': [
    'M16.5 11C19 11 21 13 21 15.5C21 16.38 20.75 17.21 20.31 17.9L23.39 21L22 22.39L18.88 19.32C18.19 19.75 17.37 20 16.5 20C14 20 12 18 12 15.5S14 11 16.5 11M16.5 13C15.12 13 14 14.12 14 15.5S15.12 18 16.5 18 19 16.88 19 15.5 17.88 13 16.5 13M10.5 18H3V8L10.62 12.76C11.65 10.54 13.9 9 16.5 9C16.77 9 17.04 9 17.31 9.06L19 8V9.5C19.75 9.81 20.42 10.27 21 10.82V6C21 4.9 20.1 4 19 4H3C1.9 4 1 4.9 1 6V18C1 19.1 1.9 20 3 20H11.82C11.27 19.42 10.82 18.75 10.5 18M19 6L11 11L3 6H19Z'
  ],
  'account-search': [
    'M10,13C9.65,13.59 9.36,14.24 9.19,14.93C6.5,15.16 3.9,16.42 3.9,17V18.1H9.2C9.37,18.78 9.65,19.42 10,20H2V17C2,14.34 7.33,13 10,13M10,4A4,4 0 0,1 14,8C14,8.91 13.69,9.75 13.18,10.43C12.32,10.75 11.55,11.26 10.91,11.9L10,12A4,4 0 0,1 6,8A4,4 0 0,1 10,4M10,5.9A2.1,2.1 0 0,0 7.9,8A2.1,2.1 0 0,0 10,10.1A2.1,2.1 0 0,0 12.1,8A2.1,2.1 0 0,0 10,5.9M15.5,12C18,12 20,14 20,16.5C20,17.38 19.75,18.21 19.31,18.9L22.39,22L21,23.39L17.88,20.32C17.19,20.75 16.37,21 15.5,21C13,21 11,19 11,16.5C11,14 13,12 15.5,12M15.5,14A2.5,2.5 0 0,0 13,16.5A2.5,2.5 0 0,0 15.5,19A2.5,2.5 0 0,0 18,16.5A2.5,2.5 0 0,0 15.5,14Z'
  ],
  'map-search': [
    'M15.5,12C18,12 20,14 20,16.5C20,17.38 19.75,18.2 19.31,18.9L22.39,22L21,23.39L17.88,20.32C17.19,20.75 16.37,21 15.5,21C13,21 11,19 11,16.5C11,14 13,12 15.5,12M15.5,14A2.5,2.5 0 0,0 13,16.5A2.5,2.5 0 0,0 15.5,19A2.5,2.5 0 0,0 18,16.5A2.5,2.5 0 0,0 15.5,14M19.5,2A0.5,0.5 0 0,1 20,2.5V11.81C19.42,11.26 18.75,10.81 18,10.5V4.7L15,5.86V10C14.3,10.07 13.62,10.24 13,10.5V5.87L9,4.47V16.13H9V16.5C9,17.14 9.09,17.76 9.26,18.34L8,17.9L2.66,19.97L2.5,20A0.5,0.5 0 0,1 2,19.5V4.38C2,4.15 2.15,3.97 2.36,3.9L8,2L14,4.1L19.34,2.03L19.5,2M4,5.46V17.31L7,16.15V4.45L4,5.46Z'
  ],
  'image-search': [
    'M15.5,9C16.2,9 16.79,8.76 17.27,8.27C17.76,7.79 18,7.2 18,6.5C18,5.83 17.76,5.23 17.27,4.73C16.79,4.23 16.2,4 15.5,4C14.83,4 14.23,4.23 13.73,4.73C13.23,5.23 13,5.83 13,6.5C13,7.2 13.23,7.79 13.73,8.27C14.23,8.76 14.83,9 15.5,9M19.31,8.91L22.41,12L21,13.41L17.86,10.31C17.08,10.78 16.28,11 15.47,11C14.22,11 13.16,10.58 12.3,9.7C11.45,8.83 11,7.77 11,6.5C11,5.27 11.45,4.2 12.33,3.33C13.2,2.45 14.27,2 15.5,2C16.77,2 17.83,2.45 18.7,3.33C19.58,4.2 20,5.27 20,6.5C20,7.33 19.78,8.13 19.31,8.91M16.5,18H5.5L8.25,14.5L10.22,16.83L12.94,13.31L16.5,18M18,13L20,15V20C20,20.55 19.81,21 19.41,21.4C19,21.79 18.53,22 18,22H4C3.45,22 3,21.79 2.6,21.4C2.21,21 2,20.55 2,20V6C2,5.47 2.21,5 2.6,4.59C3,4.19 3.45,4 4,4H9.5C9.2,4.64 9.03,5.31 9,6H4V20H18V13Z'
  ],
  code: [
    'M8,3A2,2 0 0,0 6,5V9A2,2 0 0,1 4,11H3V13H4A2,2 0 0,1 6,15V19A2,2 0 0,0 8,21H10V19H8V14A2,2 0 0,0 6,12A2,2 0 0,0 8,10V5H10V3M16,3A2,2 0 0,1 18,5V9A2,2 0 0,0 20,11H21V13H20A2,2 0 0,0 18,15V19A2,2 0 0,1 16,21H14V19H16V14A2,2 0 0,1 18,12A2,2 0 0,1 16,10V5H14V3H16Z'
  ],
  external: [
    'M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z'
  ],
  'phone-search': [
    'M20,15.5C18.8,15.5 17.5,15.3 16.4,14.9C16.3,14.9 16.2,14.9 16.1,14.9C15.8,14.9 15.6,15 15.4,15.2L13.2,17.4C10.4,15.9 8,13.6 6.6,10.8L8.8,8.6C9.1,8.3 9.2,7.9 9,7.6C8.7,6.5 8.5,5.2 8.5,4C8.5,3.5 8,3 7.5,3H4C3.5,3 3,3.5 3,4C3,13.4 10.6,21 20,21C20.5,21 21,20.5 21,20V16.5C21,16 20.5,15.5 20,15.5M5,5H6.5C6.6,5.9 6.8,6.8 7,7.6L5.8,8.8C5.4,7.6 5.1,6.3 5,5M19,19C17.7,18.9 16.4,18.6 15.2,18.2L16.4,17C17.2,17.2 18.1,17.4 19,17.4V19Z'
  ]
};
ICON_PATHS.search = [
  'M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.43,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.43C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5A4.5,4.5 0 0,0 5,9.5A4.5,4.5 0 0,0 9.5,14A4.5,4.5 0 0,0 14,9.5A4.5,4.5 0 0,0 9.5,5Z'
];
ICON_PATHS.filter = [
  'M15,19C15,19.29 14.9,19.54 14.71,19.74C14.32,20.13 13.68,20.13 13.29,19.74L9.29,15.74C9.1,15.55 9,15.29 9,15V9.88L3.21,2.47C2.87,2.04 2.95,1.41 3.38,1.07C3.57,0.92 3.79,0.85 4,0.85H20C20.21,0.85 20.43,0.92 20.62,1.07C21.05,1.41 21.13,2.04 20.79,2.47L15,9.88V19M6.05,2.85L11,9.18V14.59L13,16.59V9.18L17.95,2.85H6.05Z'
];
ICON_PATHS.sort = ['M3,18H9V16H3V18M3,6V8H21V6H3M3,13H15V11H3V13Z'];
ICON_PATHS['delete-branch'] = ICON_PATHS.nodes;
ICON_PATHS.play = ['M8,5.14V19.14L19,12.14L8,5.14Z'];
ICON_PATHS.drag = [
  'M7,3H9V5H7V3M11,3H13V5H11V3M15,3H17V5H15V3M7,7H9V9H7V7M11,7H13V9H11V7M15,7H17V9H15V7M7,11H9V13H7V11M11,11H13V13H11V11M15,11H17V13H15V11M7,15H9V17H7V15M11,15H13V17H11V15M15,15H17V17H15V15M7,19H9V21H7V19M11,19H13V21H11V19M15,19H17V21H15V19Z'
];
ICON_PATHS['chevron-up'] = ['M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z'];
ICON_PATHS['chevron-down'] = ['M7.41,8.59L12,13.17L16.59,8.59L18,10L12,16L6,10L7.41,8.59Z'];
var ARGUS_ICON_PARTS = [
  {
    d: 'M0 0 C0.8 -0.01 1.59 -0.02 2.41 -0.03 C19.48 -0.2 35.94 -0.18 52.56 4.24 C53.31 4.43 54.06 4.62 54.84 4.82 C59.81 6.11 64.69 7.61 69.56 9.24 C70.21 9.45 70.86 9.67 71.53 9.89 C116.75 24.93 152.54 59.5 174.31 101.18 C180.61 114.23 185.42 128.1 188.56 142.24 C188.71 142.87 188.86 143.51 189.01 144.17 C194.06 166.38 193.82 193.1 188.56 215.24 C188.35 216.15 188.14 217.06 187.92 218 C180.93 247.96 168.19 275.28 147.56 298.24 C146.76 299.14 145.97 300.05 145.14 300.98 C142.98 303.43 140.78 305.84 138.56 308.24 C137.95 308.9 137.34 309.56 136.71 310.25 C115.26 332.7 85.54 347.63 55.87 355.55 C54.97 355.79 54.07 356.04 53.14 356.29 C39.26 359.81 25.55 360.62 11.31 360.55 C10.08 360.55 10.08 360.55 8.84 360.54 C-3.15 360.49 -14.76 360.18 -26.44 357.24 C-27.35 357.02 -28.25 356.8 -29.18 356.57 C-58.41 349.25 -83.7 335.87 -106.44 316.24 C-107.38 315.45 -108.31 314.65 -109.27 313.84 C-131.26 294.69 -146.54 270.05 -157.44 243.24 C-157.82 242.36 -158.19 241.48 -158.58 240.57 C-173.51 203.31 -171.59 159.8 -159.44 122.24 C-159.1 121.16 -159.1 121.16 -158.74 120.07 C-150.61 95.38 -136.07 74.11 -118.44 55.24 C-117.64 54.37 -116.85 53.51 -116.02 52.62 C-89.9 25.35 -52.78 6.52 -15.44 1.24 C-13.87 0.98 -13.87 0.98 -12.26 0.72 C-8.14 0.2 -4.14 0.04 0 0 Z M-27.44 25.24 C-28.48 25.52 -28.48 25.52 -29.54 25.81 C-62.74 34.8 -93.72 54.65 -114.44 82.24 C-115.23 83.25 -116.01 84.26 -116.82 85.3 C-142.31 118.75 -151.43 160.58 -146.78 201.92 C-143.39 226.73 -133.49 252.15 -118.44 272.24 C-118.06 272.76 -117.68 273.29 -117.28 273.83 C-92.8 307.43 -57.92 328.95 -17.44 337.24 C-16.62 337.43 -15.8 337.61 -14.95 337.8 C-6.57 339.57 1.78 339.64 10.31 339.61 C11.08 339.61 11.85 339.61 12.64 339.61 C56.45 339.45 95.37 321.63 126.56 291.24 C129.04 288.68 131.32 286.01 133.56 283.24 C134.32 282.32 135.07 281.4 135.86 280.45 C150.44 262.38 160.24 241.5 166.56 219.24 C166.77 218.49 166.98 217.74 167.2 216.98 C177.32 179.51 170.28 136.73 151.56 103.24 C151.2 102.59 150.84 101.94 150.47 101.28 C145.59 92.57 140.2 84.73 133.56 77.24 C132.9 76.48 132.9 76.48 132.22 75.7 C105.29 44.86 69.13 26.33 28.56 21.24 C25.93 21.12 23.33 21.03 20.7 21 C19.97 20.99 19.23 20.98 18.47 20.97 C2.76 20.8 -12.22 20.84 -27.44 25.24 Z ',
    transform: 'translate(692.44140625,150.76171875)'
  },
  {
    d: 'M0 0 C0.5 0.99 0.5 0.99 1 2 C-0.3 2.21 -1.6 2.41 -2.94 2.62 C-11.48 4.55 -18.03 9.92 -23 17 C-27.6 25.1 -28.1 33.86 -27 43 C-25.82 46.74 -24.2 49.77 -22 53 C-21.42 53.91 -20.85 54.81 -20.25 55.75 C-13.25 62.75 -5.67 66.27 4.25 66.38 C14.04 66.21 21.1 63.74 28.25 56.98 C33.19 51.39 35.55 45.24 37 38 C40.02 39.51 40.23 42.01 41.26 45.05 C41.52 45.86 41.79 46.67 42.06 47.5 C42.33 48.28 42.6 49.06 42.88 49.86 C49.7 70.41 47.03 93.33 37.62 112.56 C25.65 134.9 6.47 148.13 -17.45 155.42 C-39.12 160.34 -60.16 156.35 -79 145 C-99.31 131.95 -111.3 113.21 -117 90 C-117.26 89.07 -117.26 89.07 -117.53 88.12 C-120.38 75.23 -118.45 60.23 -114 48 C-113.63 46.95 -113.25 45.89 -112.87 44.81 C-104.8 23.9 -88.85 7.96 -68.66 -1.49 C-47.35 -10.26 -20.86 -10.09 0 0 Z ',
    transform: 'translate(740,256)'
  }
];
ICON_PATHS.merge = ['M5,3L3,5L9,11V21H15V11L21,5L19,3L12,10L5,3Z'];
ICON_PATHS.alert = ['M13,14H11V9H13M13,18H11V16H13M12,2L1,21H23L12,2Z'];
ICON_PATHS.instagram = [
  'M7,2H17A5,5 0 0,1 22,7V17A5,5 0 0,1 17,22H7A5,5 0 0,1 2,17V7A5,5 0 0,1 7,2M7,4A3,3 0 0,0 4,7V17A3,3 0 0,0 7,20H17A3,3 0 0,0 20,17V7A3,3 0 0,0 17,4H7M12,7A5,5 0 1,1 12,17A5,5 0 1,1 12,7M12,9A3,3 0 1,0 12,15A3,3 0 1,0 12,9M17.5,5A1.5,1.5 0 1,1 17.5,8A1.5,1.5 0 1,1 17.5,5Z'
];
ICON_PATHS.ungroup = [
  'M3,3H9V5H5V9H3V3M15,3H21V9H19V5H15V3M3,15H5V19H9V21H3V15M19,15H21V21H15V19H19V15M8,8H16V16H8V8M10,10V14H14V10H10Z'
];
function icon(name) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  n.setAttribute('viewBox', '0 0 24 24');
  n.setAttribute('fill', 'currentColor');
  n.setAttribute('stroke', 'none');
  n.setAttribute('stroke-width', '1.8');
  n.setAttribute('stroke-linecap', 'round');
  n.setAttribute('stroke-linejoin', 'round');
  n.setAttribute('aria-hidden', 'true');
  n.classList.add('ui-icon');
  if (name === 'argus') {
    n.setAttribute('viewBox', '513 141 382 380');
    for (const part of ARGUS_ICON_PARTS) {
      const path = document.createElementNS(n.namespaceURI, 'path');
      path.setAttribute('d', part.d);
      path.setAttribute('transform', part.transform);
      path.setAttribute('fill', 'currentColor');
      n.append(path);
    }
    return n;
  }
  if (name === 'spinner') n.classList.add('spin');
  for (const d of ICON_PATHS[name === 'spinner' ? 'settings' : name] || ICON_PATHS.nodes) {
    const p = document.createElementNS(n.namespaceURI, 'path');
    p.setAttribute('d', d);
    n.append(p);
  }
  return n;
}
function buttonContent(button, label, name, only = false, suffix = false) {
  if (name === 'trash') button.classList.add('danger-filled');
  button.replaceChildren();
  if (name && !suffix) button.append(icon(name));
  if (!only) {
    const text = document.createElement('span');
    text.className = 'button-label';
    text.textContent = label;
    if (button.dataset.labelKey) text.dataset.i18n = button.dataset.labelKey;
    button.append(text);
  }
  if (name && suffix) button.append(icon(name));
  if (button.matches('summary') && button.closest('.cleanup-menu')) {
    const caret = icon('chevron-down');
    caret.classList.add('menu-caret');
    button.append(caret);
  }
  button.classList.toggle('icon-button', only);
  if (only) {
    button.setAttribute('aria-label', label);
    button.title = label;
  }
}
function decorateStaticIcons() {
  for (const element of document.querySelectorAll('[data-icon]')) {
    const key = element.dataset.labelKey || element.dataset.i18n;
    if (key) {
      element.dataset.labelKey = key;
      element.removeAttribute('data-i18n');
    }
    const label = key ? t(key) : element.getAttribute('aria-label') || element.textContent;
    buttonContent(element, label, element.dataset.icon, element.hasAttribute('data-icon-only'));
  }
}

// static/app/bindings-configure-ui.js
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
var bindings_configure_ui_default2 = bindings_configure_ui_default;

// static/app/bindings-navigation.js
var bindings_navigation_default = {
  name: 'bindNavigation',
  dependencies: [
    '$',
    'api',
    'bind',
    'draggableDialog',
    'home',
    'openLibrary',
    'openProject',
    'openRepositories',
    'persistLanguage',
    'pluginsHome',
    'refreshLibrary',
    'renderInstalled',
    'renderLibrary',
    'renderProjects',
    'renderRepositories',
    'settingsHome',
    'settingsState',
    'toast'
  ],
  create({
    libraryState,
    preferencesState,
    $,
    api,
    bind,
    draggableDialog,
    home,
    openLibrary,
    openProject,
    openRepositories,
    persistLanguage,
    pluginsHome,
    refreshLibrary,
    renderInstalled,
    renderLibrary,
    renderProjects,
    renderRepositories,
    settingsHome,
    settingsState,
    toast
  }) {
    function bindNavigation() {
      bind('homeActive', () => {
        libraryState.homeMode = 'active';
        renderProjects();
      });
      bind('homeArchive', () => {
        libraryState.homeMode = 'archive';
        renderProjects();
      });
      $('homeSearch').addEventListener('input', () => {
        libraryState.homeQueries[libraryState.homeMode] = $('homeSearch').value;
        renderProjects();
        $('homeSearch').focus();
      });
      bind('brandHome', home);
      bind('projectsTab', home);
      bind('back', home);
      bind('newProject', () => {
        $('newProjectTitle').value = '';
        $('projectDialog').style.transform = '';
        $('projectDialog').dataset.dx = 0;
        $('projectDialog').dataset.dy = 0;
        $('projectDialog').showModal();
        $('newProjectTitle').focus();
      });
      bind('cancelProject', () => $('projectDialog').close());
      $('createProjectForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = $('newProjectTitle').value.trim();
        if (!title) return;
        try {
          const p = await api('/api/projects', {
            title
          });
          $('projectDialog').close();
          await openProject(p.id);
        } catch (error) {
          toast(error.message);
        }
      });
      bind('pluginsTab', pluginsHome);
      bind('settingsTab', settingsHome);
      bind('addPlugin', () => openLibrary());
      bind('manageRepos', () => openRepositories());
      $('pluginSearch').addEventListener('input', renderInstalled);
      $('librarySearch').addEventListener('input', renderLibrary);
      for (const id of ['libraryDialog', 'reposDialog']) {
        draggableDialog($(id));
        $(id)
          .querySelector('[data-close]')
          .addEventListener('click', () => $(id).close());
      }
      $('repoForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = $('repoAdd');
        button.disabled = true;
        try {
          await api('/api/repositories/add', {
            url: $('repoUrl').value
          });
          $('repoUrl').value = '';
          await refreshLibrary();
          renderRepositories();
        } catch (error) {
          toast(error.message);
        } finally {
          button.disabled = false;
        }
      });
      $('settingsForm').addEventListener('submit', (event) => {
        event.preventDefault();
        persistLanguage().catch((error) => toast(error.message));
      });
      $('languageSelect').addEventListener('change', () => {
        preferencesState.settingsDirty = true;
        settingsState();
        clearTimeout(preferencesState.pendingSettingsTimer);
        preferencesState.pendingSettingsTimer = setTimeout(
          () => persistLanguage().catch((error) => toast(error.message)),
          150
        );
      });
    }
    return { bindNavigation };
  }
};
var bindings_navigation_default2 = bindings_navigation_default;

// static/app/bindings-workspace.js
var bindings_workspace_default = {
  name: 'bindWorkspace',
  dependencies: [
    '$',
    'applyHistory',
    'arrangeProject',
    'bind',
    'cancelConnection',
    'centerProject',
    'change',
    'parameterModal',
    'createGroupFromSelection',
    'deleteSelection',
    'deleteSelectionWithChildren',
    'detachNodes',
    'dissolveSelectedGroups',
    'inspect',
    'panelVisibility',
    'render',
    'save',
    'setAllGroups',
    'setupPaletteControls',
    'show',
    'toast',
    'zoomAt',
    'zoomStep'
  ],
  create({
    canvasState,
    selectionState,
    workspaceState,
    $,
    applyHistory,
    arrangeProject,
    bind,
    cancelConnection,
    centerProject,
    change,
    parameterModal,
    createGroupFromSelection,
    deleteSelection,
    deleteSelectionWithChildren,
    detachNodes,
    dissolveSelectedGroups,
    inspect,
    panelVisibility,
    render,
    save,
    setAllGroups,
    setupPaletteControls,
    show,
    toast,
    zoomAt,
    zoomStep
  }) {
    function bindWorkspace() {
      for (const b of document.querySelectorAll('[data-layout]'))
        b.addEventListener('click', () => arrangeProject(b.dataset.layout));
      $('zoomLevel').addEventListener('change', () => {
        const percent = Number($('zoomLevel').value.trim().replace(/%$/, ''));
        if (!Number.isFinite(percent) || percent < 15 || percent > 250) {
          $('zoomLevel').value = Math.round(canvasState.pan.scale * 100) + '%';
          toast(t('Zoom muss zwischen 15 und 250 Prozent liegen.'));
          return;
        }
        const box = $('graph').getBoundingClientRect();
        zoomAt(box.width / 2, box.height / 2, percent / 100);
      });
      $('zoomLevel').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          $('zoomLevel').blur();
        }
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && canvasState.connecting) {
          e.preventDefault();
          cancelConnection();
        }
      });
      bind('zoomIn', () => zoomStep(1));
      bind('zoomOut', () => zoomStep(-1));
      bind('toggleLeft', () => {
        canvasState.leftCollapsed = !canvasState.leftCollapsed;
        panelVisibility();
        try {
          localStorage.setItem('argus.leftCollapsed', String(canvasState.leftCollapsed));
        } catch {}
      });
      bind('toggleRight', () => {
        if (!selectionState.inspectorSelectionKey) return;
        canvasState.rightCollapsed = !canvasState.rightCollapsed;
        panelVisibility();
      });
      try {
        canvasState.leftCollapsed = localStorage.getItem('argus.leftCollapsed') === 'true';
      } catch {}
      panelVisibility();
      bind('undo', () => applyHistory('undo'));
      bind('redo', () => applyHistory('redo'));
      bind('report', async () => {
        await save();
        $('reportFrame').src = '/api/projects/' + workspaceState.project.id + '/report';
        show('reportView');
      });
      bind('reportBack', () => {
        show('workspace');
        render();
        inspect();
      });
      bind('expandAllGroups', () => setAllGroups(false));
      bind('collapseAllGroups', () => setAllGroups(true));
      bind('groupNodes', createGroupFromSelection);
      bind('ungroupNodes', dissolveSelectedGroups);
      bind('detachNodes', () => detachNodes([...selectionState.selected]));
      bind('deleteSelected', deleteSelection);
      bind('deleteDescendants', deleteSelectionWithChildren);
      setupPaletteControls();
      bind('fit', centerProject);
      bind('editProjectTitle', async () => {
        const result = await parameterModal(
          {
            title: 'Projekttitel bearbeiten',
            fields: [{ key: 'title', label: 'Projekttitel', required: true, maxLength: 200 }]
          },
          { title: workspaceState.project.title }
        );
        if (!result?.title?.trim()) return;
        workspaceState.project.title = result.title.trim().slice(0, 200);
        $('projectTitle').textContent = workspaceState.project.title;
        change();
      });
    }
    return { bindWorkspace };
  }
};
var bindings_workspace_default2 = bindings_workspace_default;

// static/app/bindings-canvas.js
var bindings_canvas_default = {
  name: 'bindCanvas',
  dependencies: [
    '$',
    'cancelConnection',
    'canvasPointerDown',
    'canvasPointerUp',
    'dropPalette',
    'removeSelectionFrame',
    'render',
    'resizablePanel',
    'textEditing',
    'toast',
    'touchGestureEvent',
    'updateDrag',
    'uploadNodeFile',
    'zoomAt'
  ],
  create({
    canvasState,
    workspaceState,
    uploadsState,
    $,
    cancelConnection,
    canvasPointerDown,
    canvasPointerUp,
    dropPalette,
    removeSelectionFrame,
    render,
    resizablePanel,
    textEditing,
    toast,
    touchGestureEvent,
    updateDrag,
    uploadNodeFile,
    zoomAt
  }) {
    function bindCanvas() {
      $('graph').addEventListener('pointerdown', canvasPointerDown);
      $('graph').addEventListener('pointermove', updateDrag);
      $('graph').addEventListener('pointerup', canvasPointerUp);
      $('graph').addEventListener('pointercancel', () => {
        cancelConnection();
        canvasState.drag = null;
        removeSelectionFrame();
      });
      $('graph').addEventListener('contextmenu', (event) => event.preventDefault());
      $('graph').addEventListener(
        'wheel',
        (event) => {
          event.preventDefault();
          const box = $('graph').getBoundingClientRect();
          if (event.ctrlKey || event.metaKey)
            zoomAt(
              event.clientX - box.left,
              event.clientY - box.top,
              canvasState.pan.scale * Math.exp(-event.deltaY * 0.01)
            );
          else {
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.height : 1;
            if (event.shiftKey) {
              canvasState.pan.x -= event.deltaY * unit;
              canvasState.pan.y -= event.deltaX * unit;
            } else {
              canvasState.pan.x -= event.deltaX * unit;
              canvasState.pan.y -= event.deltaY * unit;
            }
            render();
          }
        },
        {
          passive: false
        }
      );
      for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'])
        $('graph').addEventListener(name, touchGestureEvent, true);
      window.addEventListener('keydown', (event) => {
        if (
          event.code === 'Space' &&
          !textEditing(event.target) &&
          workspaceState.project &&
          !$('workspace').hidden &&
          !document.querySelector('dialog[open]')
        ) {
          event.preventDefault();
          canvasState.spacePressed = true;
          $('graph').classList.add('panning');
        }
      });
      window.addEventListener('keyup', (event) => {
        if (event.code === 'Space') {
          canvasState.spacePressed = false;
          $('graph').classList.remove('panning');
        }
      });
      window.addEventListener('blur', () => {
        cancelConnection();
        canvasState.spacePressed = false;
        canvasState.touchPointers.clear();
        canvasState.pinchGesture = null;
        canvasState.gestureBlocked = false;
        canvasState.drag = null;
        removeSelectionFrame();
      });
      $('fileInput').addEventListener('change', async (e) => {
        try {
          for (const file of e.target.files)
            await uploadNodeFile(
              file,
              uploadsState.pendingUploadType,
              uploadsState.pendingImagePosition?.x,
              uploadsState.pendingImagePosition?.y
            );
        } catch (error) {
          toast(error.message);
        } finally {
          uploadsState.pendingImagePosition = null;
          e.target.value = '';
        }
      });
      resizablePanel($('leftResize'), $('palette'), 'left');
      resizablePanel($('rightResize'), $('inspector'), 'right');
      $('graph').addEventListener('dragover', (event) => {
        if (
          !Array.from(event.dataTransfer.types).some((t2) =>
            ['application/x-argus-palette', 'Files'].includes(t2)
          )
        )
          return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        for (const element of document.querySelectorAll('.drop-target'))
          element.classList.remove('drop-target');
        event.target.closest('.node')?.classList.add('drop-target');
      });
      $('graph').addEventListener('drop', dropPalette);
    }
    return { bindCanvas };
  }
};
var bindings_canvas_default2 = bindings_canvas_default;

// static/app/bindings-shortcuts.js
var bindings_shortcuts_default = {
  name: 'bindShortcuts',
  dependencies: [
    '$',
    'applyHistory',
    'copyGraph',
    'deleteSelection',
    'graphClipboardText',
    'inspect',
    'pasteGraph',
    'render',
    'textEditing'
  ],
  create({
    workspaceState,
    selectionState,
    historyState,
    persistenceState,
    $,
    applyHistory,
    copyGraph,
    deleteSelection,
    graphClipboardText,
    inspect,
    pasteGraph,
    render,
    textEditing
  }) {
    function bindShortcuts() {
      window.addEventListener('copy', copyGraph);
      window.addEventListener('paste', pasteGraph);
      window.addEventListener('keydown', (e) => {
        if (
          (e.ctrlKey || e.metaKey) &&
          !textEditing(e.target) &&
          !document.querySelector('dialog[open]') &&
          workspaceState.project &&
          !$('workspace').hidden
        ) {
          if (e.key.toLowerCase() === 'a') {
            e.preventDefault();
            selectionState.selectedEdges.clear();
            selectionState.selected = new Set(
              workspaceState.project.document.nodes.map((n) => n.id)
            );
            render();
            inspect();
            return;
          }
          if (e.key.toLowerCase() === 'c') {
            historyState.internalClipboard = graphClipboardText();
          }
          if (e.key.toLowerCase() === 'v' && historyState.internalClipboard) {
            clearTimeout(historyState.pendingClipboardPaste);
            historyState.pendingClipboardPaste = setTimeout(
              () =>
                pasteGraph({
                  target: e.target,
                  clipboardData: {
                    getData: () => historyState.internalClipboard
                  },
                  preventDefault() {}
                }),
              150
            );
          }
          if (e.key.toLowerCase() === 'z') {
            e.preventDefault();
            applyHistory(e.shiftKey ? 'redo' : 'undo');
            return;
          }
          if (e.key.toLowerCase() === 'y') {
            e.preventDefault();
            applyHistory('redo');
            return;
          }
        }
        if (
          e.key !== 'Delete' ||
          !workspaceState.project ||
          persistenceState.busy ||
          $('workspace').hidden ||
          textEditing(e.target) ||
          document.querySelector('dialog[open]')
        )
          return;
        e.preventDefault();
        deleteSelection();
      });
    }
    return { bindShortcuts };
  }
};
var bindings_shortcuts_default2 = bindings_shortcuts_default;

// static/workspace-layout.js
function setupWorkspaceLayout() {
  const toolbar = document.querySelector('#workspace > .toolbar');
  const groups = [...toolbar.querySelectorAll(':scope > .toolbar-group')].sort(
    (a, b) =>
      Number(a.classList.contains('activity-tools')) -
      Number(b.classList.contains('activity-tools'))
  );
  toolbar.querySelectorAll(':scope > .divider').forEach((node) => node.remove());
  let scheduled = false;
  let signature = '';
  function layout() {
    scheduled = false;
    if (!toolbar.getClientRects().length) return;
    const style = getComputedStyle(toolbar);
    const available =
      toolbar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const sectionGap = parseFloat(style.getPropertyValue('--toolbar-button-gap')) * 4 + 1;
    const widths = groups.map((group) => {
      const style2 = getComputedStyle(group);
      const children = [...group.children].filter(
        (child) => getComputedStyle(child).display !== 'none'
      );
      return Math.ceil(
        children.reduce((sum, child) => {
          const css = getComputedStyle(child);
          return (
            sum +
            child.getBoundingClientRect().width +
            (parseFloat(css.marginLeft) || 0) +
            (parseFloat(css.marginRight) || 0)
          );
        }, 0) +
          Math.max(0, children.length - 1) * (parseFloat(style2.columnGap) || 0)
      );
    });
    const rows = [[]];
    let used = 0;
    groups.forEach((group, index) => {
      const width = widths[index];
      if (used && used + sectionGap + width > available) {
        rows.push([]);
        used = 0;
      }
      rows.at(-1).push(group);
      used += (used ? sectionGap : 0) + width;
    });
    const next = rows.map((row) => row.map((group) => groups.indexOf(group)).join(',')).join('|');
    if (next !== signature) {
      signature = next;
      const fragment = document.createDocumentFragment();
      for (const row of rows) {
        const wrapper = document.createElement('div');
        wrapper.className = 'toolbar-row';
        wrapper.append(...row);
        fragment.append(wrapper);
      }
      toolbar.replaceChildren(fragment);
    }
  }
  const schedule = () => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(layout);
    }
  };
  new ResizeObserver(schedule).observe(toolbar);
  new MutationObserver(schedule).observe(document.getElementById('actorActivity'), {
    childList: true,
    subtree: true,
    characterData: true
  });
  document.addEventListener('argus:language', schedule);
  document.fonts?.ready.then(schedule);
  toolbar.addEventListener('click', (event) => {
    const selected = event.target.closest('details');
    for (const menu of toolbar.querySelectorAll('details[open]'))
      if (menu !== selected || event.target.closest('button')) menu.open = false;
  });
  document.addEventListener('pointerdown', (event) => {
    for (const menu of toolbar.querySelectorAll('details[open]'))
      if (!menu.contains(event.target)) menu.open = false;
  });
  toolbar.addEventListener('keydown', (event) => {
    if (event.key === 'Escape')
      for (const menu of toolbar.querySelectorAll('details[open]')) {
        menu.open = false;
        menu.querySelector('summary').focus();
      }
  });
  const body = document.querySelector('.workbody');
  const palette = document.getElementById('palette');
  const inspector = document.getElementById('inspector');
  function positionTabs() {
    const origin = body.getBoundingClientRect();
    const canvas = document.getElementById('canvas').getBoundingClientRect();
    const left = palette.hidden ? canvas.left : palette.getBoundingClientRect().right;
    const right = inspector.hidden ? canvas.right : inspector.getBoundingClientRect().left;
    body.style.setProperty('--left-panel-edge', `${left - origin.left}px`);
    body.style.setProperty('--right-panel-edge', `${right - origin.left}px`);
  }
  const panels = new ResizeObserver(positionTabs);
  for (const panel of [body, palette, inspector]) panels.observe(panel);
  schedule();
}

// static/app/bindings-lifecycle.js
var bindings_lifecycle_default = {
  name: 'bindLifecycle',
  dependencies: [
    '$',
    'bind',
    'bootstrap',
    'cancelCurrentActor',
    'clearLogs',
    'draggableDialog',
    'exportLogs',
    'finishDialog',
    'openLogs',
    'renderLogs',
    'resizePaletteSplit',
    'show',
    'toast'
  ],
  create({
    persistenceState,
    preferencesState,
    pluginsState,
    executionState,
    $,
    bind,
    bootstrap,
    cancelCurrentActor,
    clearLogs,
    draggableDialog,
    exportLogs,
    finishDialog,
    openLogs,
    renderLogs,
    resizePaletteSplit,
    show,
    toast
  }) {
    function bindLifecycle() {
      setupWorkspaceLayout();
      $('inputDialogCancel').addEventListener('click', () => finishDialog(false));
      $('inputDialogForm').addEventListener('submit', (e) => {
        e.preventDefault();
        finishDialog(true);
      });
      $('inputDialog').addEventListener('cancel', (e) => {
        e.preventDefault();
        finishDialog(false);
      });
      draggableDialog($('inputDialog'));
      draggableDialog($('projectDialog'));
      window.addEventListener('beforeunload', (e) => {
        if (
          persistenceState.dirty ||
          preferencesState.settingsDirty ||
          pluginsState.pendingPluginDirty.size ||
          pluginsState.pendingPluginSaves.size ||
          executionState.queueRunning
        ) {
          e.preventDefault();
          e.returnValue = '';
        }
      });
      new ResizeObserver(() =>
        document.documentElement.style.setProperty(
          '--toolbar-height',
          document.querySelector('.toolbar').getBoundingClientRect().height + 'px'
        )
      ).observe(document.querySelector('.toolbar'));
      bootstrap().catch((e) => toast(e.message));
      bind('logs', openLogs);
      bind('logsBack', () => show('workspace'));
      bind('logsExport', exportLogs);
      bind('logsClear', clearLogs);
      bind('logsMore', () => renderLogs(true));
      bind('cancelActor', cancelCurrentActor);
      $('logsSearch').addEventListener('input', () =>
        renderLogs().catch((error) => toast(error.message))
      );
      resizePaletteSplit();
    }
    return { bindLifecycle };
  }
};
var bindings_lifecycle_default2 = bindings_lifecycle_default;

// static/app/node-renderer.js
var node_renderer_default = {
  name: 'node-renderer',
  dependencies: [
    '$',
    'actorTitle',
    'change',
    'dataLabel',
    'el',
    'fitNodeText',
    'inspect',
    'nodeBadgeHeight',
    'nodeExtras',
    'nodeIcon',
    'nodePorts',
    'nodeRect',
    'nodeTitle',
    'noteInk',
    'providerName',
    'render',
    'renderLocationAddress',
    'short',
    'summary',
    'svg'
  ],
  create({
    selectionState,
    canvasState,
    persistenceState,
    $,
    actorTitle,
    change,
    dataLabel,
    el,
    fitNodeText,
    inspect,
    nodeBadgeHeight,
    nodeExtras,
    nodeIcon,
    nodePorts,
    nodeRect,
    nodeTitle,
    noteInk,
    providerName,
    render,
    renderLocationAddress,
    short,
    summary,
    svg
  }) {
    function renderNodes({ doc, hidden, groupModel, groupViews, scene, previousPositions }) {
      const visibleNodes = doc.nodes.filter((item) => !hidden.has(item.id));
      const keyboardNode =
        visibleNodes.find((item) => item.id === canvasState.keyboardNode) ||
        visibleNodes.find((item) => selectionState.selected.has(item.id)) ||
        visibleNodes[0];
      for (const node of [...doc.nodes].sort(
        (a, b) => Number(b.type === 'marker') - Number(a.type === 'marker')
      )) {
        if (hidden.has(node.id)) continue;
        const bounds = nodeRect(node),
          g = svg('g', {
            class:
              'node ' +
              (node.type === 'actor' ? 'actor ' : '') +
              (node.type === 'note' ? 'note ' : node.type === 'marker' ? 'marker ' : '') +
              (node.type === 'error' ? 'error ' : '') +
              (selectionState.selected.has(node.id) ? 'selected' : ''),
            transform: `translate(${node.x} ${node.y})`,
            'data-id': node.id,
            'data-type': node.type,
            tabindex: node.id === keyboardNode?.id ? 0 : -1,
            role: 'group',
            'aria-roledescription': t('Graph-Knoten'),
            'aria-label': dataLabel(node.type) + ': ' + nodeTitle(node),
            'aria-describedby': 'graphKeyboardHint'
          });
        const rect = svg('rect', {
          width: bounds.w,
          height: bounds.h,
          rx: 10
        });
        g.append(
          rect,
          svg('rect', {
            class: 'node-hover-area',
            x: -10,
            y: -10,
            width: bounds.w + 20,
            height: bounds.h + 20,
            rx: 20
          })
        );
        if (['note', 'marker'].includes(node.type)) {
          const color = node.appearance?.color || '#ffcc70',
            ink = noteInk(color);
          rect.style.fill = color;
          rect.style.stroke = color;
          g.append(
            svg(
              'text',
              {
                x: node.type === 'marker' ? bounds.w / 2 : 12,
                'text-anchor': node.type === 'marker' ? 'middle' : 'start',
                y: 25,
                fill: node.type === 'marker' ? color : ink,
                'font-size': 13
              },
              short(node.label, Math.floor((bounds.w - 24) / 8))
            )
          );
          const foreign = svg('foreignObject', {
            x: 10,
            y: 38,
            width: bounds.w - 20,
            height: bounds.h - 52 - nodeBadgeHeight(node, bounds.w)
          });
          const editor = el('div', {
            class: 'note-editor',
            contenteditable: 'plaintext-only',
            role: 'textbox',
            'aria-label': t('Notizinhalt'),
            'aria-multiline': 'true',
            spellcheck: 'true'
          });
          editor.style.color = ink;
          editor.textContent = node.data.text || '';
          editor.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
            selectionState.selectedEdges.clear();
            if (!selectionState.selected.has(node.id)) {
              selectionState.selected = /* @__PURE__ */ new Set([node.id]);
              for (const element of document.querySelectorAll('.node.selected'))
                element.classList.remove('selected');
              g.classList.add('selected');
              inspect();
            }
          });
          editor.addEventListener('input', () => {
            node.data.text = editor.innerText;
            change(node.id);
          });
          foreign.append(editor);
          if (node.type === 'note') g.append(foreign);
          const grip = svg('g', {
            class: 'note-resize',
            role: 'button',
            'aria-label': t('Notizgr\xF6\xDFe \xE4ndern')
          });
          grip.append(
            svg('rect', {
              x: bounds.w - 24,
              y: bounds.h - 24,
              width: 24,
              height: 24,
              fill: 'transparent',
              stroke: 'none'
            }),
            svg('path', {
              d: `M ${bounds.w - 16} ${bounds.h - 4} L ${bounds.w - 4} ${bounds.h - 16} M ${bounds.w - 10} ${bounds.h - 4} L ${bounds.w - 4} ${bounds.h - 10}`,
              stroke: ink,
              'stroke-width': 1.5,
              fill: 'none'
            })
          );
          grip.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            selectionState.selected = /* @__PURE__ */ new Set([node.id]);
            canvasState.drag = {
              kind: 'note-resize',
              id: node.id,
              startX: event.clientX,
              startY: event.clientY,
              width: bounds.w,
              height: node.appearance?.height || 180,
              moved: false
            };
            $('graph').setPointerCapture(event.pointerId);
            inspect();
          });
          g.append(grip);
        } else
          g.append(
            svg(
              'text',
              {
                x: 34,
                y: 23,
                fill: node.type === 'actor' ? 'var(--actor-accent)' : '#ff9d45',
                'font-size': 10,
                'letter-spacing': 1
              },
              fitNodeText(
                node.type === 'value'
                  ? nodeTitle(node)
                  : (node.type === 'actor' ? actorTitle(node) : dataLabel(node.type)).toUpperCase(),
                bounds.w - 46,
                10,
                1
              )
            ),
            svg(
              'text',
              {
                x: 12,
                y: 40,
                fill: '#e4ecf7',
                'font-size': 13
              },
              fitNodeText(
                node.type === 'value'
                  ? summary(node)
                  : node.type === 'profile'
                    ? providerName(node.data.provider) || nodeTitle(node)
                    : node.type === 'error'
                      ? diagnostic(node.data.title || nodeTitle(node))
                      : node.type === 'person'
                        ? [node.data.first_name, node.data.middle_name, node.data.last_name]
                            .filter(Boolean)
                            .join(' ') || nodeTitle(node)
                        : nodeTitle(node),
                bounds.w - 24,
                13
              )
            ),
            svg(
              'text',
              {
                x: 12,
                y: 60,
                fill: '#95a9c1',
                'font-size': 10
              },
              node.type === 'value' ? '' : short(summary(node), 34)
            )
          );
        if (node.type === 'error') {
          g.lastChild.remove();
          const words = diagnostic(node.data.message || '').split(/\s+/),
            lines = [];
          let line = '';
          for (const word of words) {
            if ((line + ' ' + word).length > 42 && line) {
              lines.push(line);
              line = word;
            } else line += (line ? ' ' : '') + word;
          }
          if (line) lines.push(line);
          for (const [i, line2] of lines.slice(0, 3).entries())
            g.append(
              svg(
                'text',
                {
                  x: 12,
                  y: 61 + i * 16,
                  fill: '#e5afb5',
                  'font-size': 10
                },
                fitNodeText(
                  line2 + (i === 2 && lines.length > 3 ? ' \u2026' : ''),
                  bounds.w - 24,
                  10
                )
              )
            );
        }
        if (node.type === 'profile') {
          g.lastChild.remove();
          for (const [index, text] of [
            node.data.identifier
              ? `${t('Identifier')}: ${node.data.identifier}`
              : t('Kein Identifier'),
            node.data.url || t('Keine \xF6ffentliche Profil-URL')
          ].entries()) {
            const line = svg(
              'text',
              {
                x: 12,
                y: 61 + index * 17,
                fill: '#95a9c1',
                'font-size': 10
              },
              fitNodeText(text, bounds.w - 24, 10)
            );
            line.append(svg('title', {}, text));
            g.append(line);
          }
        }
        if (node.type === 'location') {
          g.lastChild.remove();
          renderLocationAddress(g, node, bounds);
        }
        g.addEventListener('keydown', (event) => {
          if (
            event.target !== g ||
            persistenceState.busy ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey
          )
            return;
          let target = node;
          if (event.key.startsWith('Arrow')) {
            const horizontal = ['ArrowLeft', 'ArrowRight'].includes(event.key);
            const sign = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
            const axis = horizontal ? 'x' : 'y',
              cross = horizontal ? 'y' : 'x';
            target =
              visibleNodes
                .filter((item) => (item[axis] - node[axis]) * sign > 0)
                .sort(
                  (a, b) =>
                    Math.abs(a[axis] - node[axis]) +
                    Math.abs(a[cross] - node[cross]) * 2 -
                    (Math.abs(b[axis] - node[axis]) + Math.abs(b[cross] - node[cross]) * 2)
                )[0] || node;
          } else if (event.key === 'Home') target = visibleNodes[0];
          else if (event.key === 'End') target = visibleNodes.at(-1);
          else if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          canvasState.keyboardNode = target.id;
          if (event.key === 'Enter' || event.key === ' ') {
            if (event.shiftKey) {
              if (selectionState.selected.has(node.id)) selectionState.selected.delete(node.id);
              else selectionState.selected.add(node.id);
            } else selectionState.selected = /* @__PURE__ */ new Set([node.id]);
            selectionState.selectedEdges.clear();
            render();
            inspect();
          } else {
            const viewport = $('graph').getBoundingClientRect(),
              bounds2 = nodeRect(target);
            const pan = canvasState.pan,
              margin = 28;
            const left = target.x * pan.scale + pan.x,
              top = target.y * pan.scale + pan.y;
            if (left < margin || left + bounds2.w * pan.scale > viewport.width - margin)
              pan.x = viewport.width / 2 - (target.x + bounds2.w / 2) * pan.scale;
            if (top < margin || top + bounds2.h * pan.scale > viewport.height - margin)
              pan.y = viewport.height / 2 - (target.y + bounds2.h / 2) * pan.scale;
            render();
          }
          requestAnimationFrame(() => {
            const focused = [...$('scene').querySelectorAll('.node')].find(
              (item) => item.dataset.id === target.id
            );
            focused?.focus({ preventScroll: true });
          });
        });
        g.addEventListener('pointerdown', (event) => {
          if (
            persistenceState.busy ||
            event.button > 0 ||
            canvasState.spacePressed ||
            canvasState.pinchGesture ||
            event.target.closest('.note-editor,.note-resize,.node-open,.dock')
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          canvasState.keyboardNode = node.id;
          if (event.shiftKey || canvasState.touchSelection) {
            selectionState.selected.has(node.id)
              ? selectionState.selected.delete(node.id)
              : selectionState.selected.add(node.id);
          } else if (!selectionState.selected.has(node.id))
            selectionState.selected = /* @__PURE__ */ new Set([node.id]);
          selectionState.selectedEdges.clear();
          canvasState.drag = {
            kind: 'nodes',
            startX: event.clientX,
            startY: event.clientY,
            positions: doc.nodes
              .filter((n) => selectionState.selected.has(n.id))
              .map((n) => ({
                id: n.id,
                x: n.x,
                y: n.y
              })),
            moved: false
          };
          $('graph').setPointerCapture(event.pointerId);
          render();
          inspect(event.shiftKey || canvasState.touchSelection);
        });
        if (node.type !== 'marker') {
          nodeExtras(g, node, bounds);
          nodeIcon(g, node);
          nodePorts(g, node, bounds);
        }
        const owner = (groupModel.nodePaths.get(node.id) || []).at(-1);
        if (node.type === 'marker') (groupViews.get(owner) || scene).prepend(g);
        else (groupViews.get(owner) || scene).append(g);
        const old = previousPositions.get(node.id);
        if (
          old &&
          old !== g.getAttribute('transform') &&
          !canvasState.drag &&
          !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ) {
          const values = old.match(/translate\(([-\d.]+) ([-\d.]+)\)/);
          if (values)
            g.animate(
              [
                {
                  transform: `translate(${values[1]}px,${values[2]}px)`
                },
                {
                  transform: `translate(${node.x}px,${node.y}px)`
                }
              ],
              {
                duration: 170,
                easing: 'ease-out'
              }
            );
        }
      }
    }
    return { renderNodes };
  }
};
var node_renderer_default2 = node_renderer_default;

// static/app/edge-renderer.js
var edge_renderer_default = {
  name: 'edge-renderer',
  dependencies: [
    'askText',
    'change',
    'deleteEdges',
    'edgeBundleIds',
    'measureEdgeText',
    'nodeRect',
    'render',
    'routeConnection',
    'selectEdge',
    'svg',
    'toast'
  ],
  create({
    askText,
    change,
    deleteEdges,
    edgeBundleIds,
    measureEdgeText,
    nodeRect,
    render,
    routeConnection,
    selectEdge,
    svg,
    toast
  }) {
    function renderEdges({
      doc,
      hidden,
      groupModel,
      groupEdges,
      externalEdges,
      labelOverlay,
      labelsByContext
    }) {
      const shownConnections = /* @__PURE__ */ new Set();
      for (const edge of doc.edges) {
        const visual = groupModel.connection(edge);
        if (!visual || shownConnections.has(visual.key)) continue;
        shownConnections.add(visual.key);
        const { context } = visual,
          a = visual.a.rect,
          b = visual.b.rect,
          edgeLayer = context ? groupEdges.get(context) : externalEdges;
        if (!edgeLayer) continue;
        if (!labelsByContext.has(context)) labelsByContext.set(context, []);
        const occupiedLabels = labelsByContext.get('all') || [];
        labelsByContext.set('all', occupiedLabels);
        const ancestorIds = context
          ? (groupModel.nodePaths.get(edge.source) || []).slice(
              0,
              (groupModel.nodePaths.get(edge.source) || []).indexOf(context) + 1
            )
          : [];
        const labelObstacles = [
          ...doc.nodes.filter((n) => n.type !== 'marker' && !hidden.has(n.id)).map(nodeRect),
          ...groupModel.groups
            .filter((g) => !ancestorIds.includes(g.id))
            .map((g) => groupModel.rects.get(g.id)),
          ...ancestorIds.map((id) => {
            const b2 = groupModel.rects.get(id);
            return {
              ...b2,
              h: 32
            };
          })
        ];
        const labelLayer = svg('g', {
          class: 'connection-label',
          'data-edge-label': edge.id
        });
        labelOverlay.append(labelLayer);
        const labelText = t(String(edge.label || ''));
        const route = routeConnection(
            a,
            b,
            labelText,
            labelObstacles,
            occupiedLabels,
            {
              ...edge,
              source_port: 'right',
              target_port:
                b.inputCount > 1 && visual.b.key.startsWith('node:')
                  ? `left:${
                      Math.max(
                        0,
                        doc.edges
                          .filter((e) => e.target === edge.target)
                          .findIndex((e) => e.id === edge.id)
                      ) % b.inputCount
                    }:${b.inputCount}`
                  : 'left'
            },
            measureEdgeText(labelText)
          ),
          { labelX, labelY } = route;
        const hit = svg('path', {
          class: 'edge-hit',
          d: route.path,
          'data-edge-hit': edge.id,
          tabindex: 0,
          role: 'button',
          'aria-label': t('Verbindung ausw\xE4hlen')
        });
        hit.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          selectEdge(edge.id, e.shiftKey);
        });
        hit.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            selectEdge(edge.id, e.shiftKey);
          }
        });
        for (const visible of route.visiblePaths || [
          {
            path: route.path,
            arrow: true
          }
        ]) {
          if (!visible.path) continue;
          const stroke = svg('path', {
            class: 'edge',
            d: visible.path,
            'data-edge-path': edge.id,
            'data-has-arrow': String(visible.arrow)
          });
          if (!visible.arrow) stroke.style.markerEnd = 'none';
          edgeLayer.append(stroke);
        }
        edgeLayer.append(hit);
        const text = svg(
          'text',
          {
            class: 'edgeLabel',
            x: labelX,
            y: labelY,
            'text-anchor': 'middle',
            'dominant-baseline': 'central'
          },
          labelText
        );
        labelLayer.append(text);
        const measured = text.getBBox();
        text.setAttribute('dx', labelX - measured.x - measured.width / 2);
        text.setAttribute('dy', labelY - measured.y - measured.height / 2);
        const labelWidth = measured.width,
          labelHeight = Math.max(26, measured.height + 8);
        const backdrop = svg('rect', {
          class: 'edge-label-backdrop',
          x: labelX - labelWidth / 2 - 59,
          y: labelY - labelHeight / 2,
          width: labelWidth + 118,
          height: labelHeight,
          rx: 3
        });
        backdrop.style.fill = 'transparent';
        backdrop.style.pointerEvents = 'all';
        labelLayer.insertBefore(backdrop, text);
        labelLayer.addEventListener('pointerdown', (event) => event.stopPropagation());
        backdrop.addEventListener('click', (event) => {
          event.stopPropagation();
          selectEdge(edge.id, event.shiftKey);
        });
        const maskId = 'edge-controls-' + edge.id;
        const mask = svg('mask', {
          id: maskId,
          maskUnits: 'userSpaceOnUse',
          x: labelX - labelWidth / 2 - 70,
          y: labelY - 40,
          width: labelWidth + 150,
          height: 80
        });
        mask.setAttribute('x', Math.min(a.x, b.x, labelX) - 300);
        mask.setAttribute('y', Math.min(a.y, b.y, labelY) - 300);
        mask.setAttribute('width', Math.abs(a.x - b.x) + Math.max(a.w, b.w) + 1e3);
        mask.setAttribute('height', Math.abs(a.y - b.y) + Math.max(a.h, b.h) + 1e3);
        mask.append(
          svg('rect', {
            x: mask.getAttribute('x'),
            y: mask.getAttribute('y'),
            width: mask.getAttribute('width'),
            height: mask.getAttribute('height'),
            fill: 'white'
          })
        );
        mask.append(
          svg('rect', {
            class: 'edge-controls-gap',
            x: labelX + labelWidth / 2 + 3,
            y: labelY - 13,
            width: 54,
            height: 26,
            fill: 'black'
          })
        );
        const defs = svg('defs');
        defs.append(mask);
        labelLayer.append(defs);
        for (const stroke of edgeLayer.querySelectorAll(
          '[data-edge-path="' + CSS.escape(edge.id) + '"]'
        ))
          stroke.setAttribute('mask', 'url(#' + maskId + ')');
        const pen = svg('g', {
          class: 'edge-edit',
          role: 'button',
          tabindex: 0,
          'aria-label': t('Verbindung bearbeiten'),
          'data-edge': edge.id
        });
        pen.append(
          svg('rect', {
            class: 'edge-edit-hit',
            x: labelX + labelWidth / 2 + 7,
            y: labelY - 11,
            width: 22,
            height: 22
          })
        );
        const glyph = icon('edit');
        glyph.setAttribute('x', labelX + labelWidth / 2 + 11);
        glyph.setAttribute('y', labelY - 7);
        glyph.setAttribute('width', 14);
        glyph.setAttribute('height', 14);
        pen.append(glyph);
        const edit = async () => {
          const text2 = await askText(
            t('Verbindung bearbeiten'),
            t('Bezeichnung'),
            edge.label || ''
          );
          if (text2 !== null) {
            edge.label = text2;
            change();
            render();
          }
        };
        pen.addEventListener('pointerdown', (e) => e.stopPropagation());
        pen.addEventListener('click', (e) => {
          e.stopPropagation();
          edit().catch((error) => toast(error.message));
        });
        pen.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            edit().catch((error) => toast(error.message));
          }
        });
        labelLayer.append(pen);
        const trash = svg('g', {
          class: 'edge-delete',
          role: 'button',
          tabindex: 0,
          'aria-label': t('Verbindung l\xF6schen')
        });
        trash.append(
          svg('rect', {
            x: labelX + labelWidth / 2 + 31,
            y: labelY - 11,
            width: 22,
            height: 22,
            fill: 'transparent'
          })
        );
        const trashIcon = icon('trash');
        for (const [key, value] of Object.entries({
          x: labelX + labelWidth / 2 + 35,
          y: labelY - 7,
          width: 14,
          height: 14
        }))
          trashIcon.setAttribute(key, value);
        trash.append(trashIcon);
        trash.addEventListener('pointerdown', (e) => e.stopPropagation());
        trash.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteEdges(edgeBundleIds(edge.id));
        });
        trash.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            deleteEdges(edgeBundleIds(edge.id));
          }
        });
        labelLayer.append(trash);
      }
    }
    return { renderEdges };
  }
};
var edge_renderer_default2 = edge_renderer_default;

// static/app/group-renderer.js
var group_renderer_default = {
  name: 'group-renderer',
  dependencies: [
    '$',
    'change',
    'groupBounds',
    'groupNodeIds',
    'groupTitle',
    'inspectGroup',
    'moveGroup',
    'render',
    'short',
    'startGroupDrag',
    'svg',
    'toggleGroup'
  ],
  create({
    selectionState,
    persistenceState,
    $,
    change,
    groupBounds,
    groupNodeIds,
    groupTitle,
    inspectGroup,
    moveGroup,
    render,
    short,
    startGroupDrag,
    svg,
    toggleGroup
  }) {
    function renderGroups({ scene, groupModel, groupViews, groupEdges }) {
      for (const group of groupModel.groups) {
        const b = groupBounds(group);
        const g = svg('g', {
          class:
            'group' +
            (group.collapsed ? ' collapsed' : '') +
            (selectionState.selectedGroups.has(group.id) ? ' selected' : ''),
          'data-group': group.id,
          tabindex: 0,
          role: 'group',
          'aria-label': group.label
        });
        g.append(
          svg('rect', {
            x: b.x,
            y: b.y,
            width: group.collapsed ? 220 : b.w,
            height: group.collapsed ? 76 : b.h,
            rx: 10
          })
        );
        for (const x of [b.x, b.x + (group.collapsed ? 220 : b.w)])
          g.append(
            svg('circle', {
              class: 'group-port',
              cx: x,
              cy: b.y + (group.collapsed ? 76 : b.h) / 2,
              r: 5
            })
          );
        const toggle = svg('g', {
          class: 'group-toggle',
          role: 'button',
          tabindex: 0,
          'aria-label': (group.collapsed ? t('Aufklappen: ') : t('Einklappen: ')) + group.label,
          'aria-expanded': String(!group.collapsed)
        });
        toggle.append(
          svg('rect', {
            x: b.x + 4,
            y: b.y + 4,
            width: 28,
            height: 28,
            rx: 5
          }),
          svg(
            'text',
            {
              x: b.x + 18,
              y: b.y + 19,
              'text-anchor': 'middle',
              'dominant-baseline': 'central',
              'font-size': 20
            },
            group.collapsed ? '\u25B8' : '\u25BE'
          )
        );
        toggle.addEventListener('pointerdown', (e) => e.stopPropagation());
        toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleGroup(group);
        });
        toggle.addEventListener('keydown', (e) => {
          if (['Enter', ' '].includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            toggleGroup(group);
          }
        });
        g.append(
          toggle,
          svg(
            'text',
            {
              class: 'group-title',
              x: b.x + 39,
              y: b.y + 23,
              'font-size': 12
            },
            short(
              groupTitle(group),
              group.collapsed ? 23 : Math.max(20, Math.floor((b.w - 45) / 8))
            )
          )
        );
        if (group.collapsed)
          g.append(
            svg(
              'text',
              {
                x: b.x + 12,
                y: b.y + 50,
                'font-size': 11
              },
              groupNodeIds(group).size + t(' Datenknoten \xB7 Ziehen zum Verschieben')
            )
          );
        g.addEventListener('pointerdown', (e) => startGroupDrag(group, e));
        g.addEventListener('keydown', (e) => {
          if (e.target !== g) return;
          const delta = {
            ArrowLeft: [-10, 0],
            ArrowRight: [10, 0],
            ArrowUp: [0, -10],
            ArrowDown: [0, 10]
          }[e.key];
          if (!delta || persistenceState.busy) return;
          e.preventDefault();
          moveGroup(group, ...delta);
          change();
          render();
          $('scene')
            .querySelector('[data-group="' + group.id + '"]')
            .focus();
        });
        g.addEventListener('click', (e) => {
          if (e.target.closest('.node,.edge-hit,.edge-edit,.edge-delete')) return;
          e.stopPropagation();
          if (e.shiftKey && !selectionState.selectedGroups.has(group.id)) return;
          inspectGroup(group);
        });
        groupViews.set(group.id, g);
        if (!group.collapsed) {
          const defs = svg('defs'),
            clip = svg('clipPath', {
              id: 'group-edges-' + group.id,
              clipPathUnits: 'userSpaceOnUse'
            });
          clip.append(
            svg('rect', {
              x: b.x,
              y: b.y + 30,
              width: b.w,
              height: Math.max(0, b.h - 30),
              rx: 8
            })
          );
          defs.append(clip);
          const layer = svg('g', {
            class: 'group-internal-edges'
          });
          g.append(defs, layer);
          groupEdges.set(group.id, layer);
        }
        const parentView = groupViews.get(group.parent_id);
        (parentView || scene).append(g);
      }
    }
    return { renderGroups };
  }
};
var group_renderer_default2 = group_renderer_default;

// static/app/shell.js
var shell_default = {
  name: 'shell',
  dependencies: [
    'api',
    'cancelConnection',
    'home',
    'refreshCatalog',
    'setupProviderDismissal',
    'startJobMonitor'
  ],
  create({
    shellState,
    executionState,
    persistenceState,
    preferencesState,
    pluginsState,
    workspaceState,
    canvasState,
    selectionState,
    api,
    cancelConnection,
    home,
    refreshCatalog,
    setupProviderDismissal,
    startJobMonitor
  }) {
    function toast(msg) {
      $('toast').textContent = t(msg);
      $('toast').hidden = false;
      clearTimeout(toast.timer);
      toast.timer = setTimeout(() => ($('toast').hidden = true), 6e3);
    }
    function finishDialog(accepted) {
      const request = shellState.dialogRequest;
      if (!request) return;
      shellState.dialogRequest = null;
      const value =
        request.mode === 'confirm' ? accepted : accepted ? $('inputDialogValue').value : null;
      $('inputDialog').close();
      request.resolve(value);
    }
    function appDialog(mode, title, message, value = '') {
      if (shellState.dialogRequest)
        return Promise.reject(Error(t('Bitte zuerst das offene Fenster schlie\xDFen.')));
      return new Promise((resolve) => {
        shellState.dialogRequest = {
          mode,
          resolve
        };
        $('inputDialogTitle').textContent = title;
        $('inputDialogMessage').textContent = message;
        $('inputDialogLabel').textContent = message;
        $('inputDialogLabel').hidden = mode === 'confirm';
        $('inputDialogMessage').hidden = mode === 'text';
        $('inputDialogValue').hidden = mode === 'confirm';
        $('inputDialogValue').value = value;
        $('inputDialogSubmit').textContent =
          mode === 'confirm' ? t('Best\xE4tigen') : t('\xDCbernehmen');
        $('inputDialog').style.transform = '';
        $('inputDialog').dataset.dx = 0;
        $('inputDialog').dataset.dy = 0;
        $('inputDialog').showModal();
        (mode === 'confirm' ? $('inputDialogCancel') : $('inputDialogValue')).focus();
      });
    }
    const askText = (title, label, value) => appDialog('text', title, label, value);
    const askConfirm = (title, message) => appDialog('confirm', title, message);
    function draggableDialog(...args) {
      return ui_default.draggableDialog(...args);
    }
    function saveIndicator(element, state, error = '') {
      if (!element) return;
      element.replaceChildren(
        icon(
          state === 'saving'
            ? 'spinner'
            : state === 'saved'
              ? 'check'
              : state === 'error'
                ? 'logs'
                : 'save'
        ),
        document.createTextNode(
          t(
            state === 'saving'
              ? 'Speichert \u2026'
              : state === 'saved'
                ? 'Gespeichert'
                : state === 'error'
                  ? 'Speichern fehlgeschlagen'
                  : 'Noch zu speichern'
          )
        )
      );
      const glyph = element.querySelector('svg');
      if (state === 'saved' && glyph) glyph.setAttribute('viewBox', '3.5 5.5 18 14');
      element.dataset.state = state;
      element.title = error;
      element.classList.add('save-indicator');
      element.setAttribute('role', 'status');
    }
    function el(...args) {
      return ui_default.el(...args);
    }
    function svg(...args) {
      return ui_default.svg(...args);
    }
    function button(...args) {
      return ui_default.button(...args);
    }
    function show(view) {
      if (view !== 'workspace') {
        $('mapOverlays')?.replaceChildren();
        cancelConnection();
      }
      for (const id of [
        'home',
        'workspace',
        'pluginsView',
        'settingsView',
        'reportView',
        'logsView'
      ])
        if ($(id)) $(id).hidden = id !== view;
      document.body.classList.toggle('workspace-mode', view === 'workspace');
      $('projectHeading').hidden = view !== 'workspace';
      $('projectsTab').classList.toggle(
        'active',
        ['home', 'workspace', 'reportView', 'logsView'].includes(view)
      );
      $('pluginsTab').classList.toggle('active', view === 'pluginsView');
      $('settingsTab')?.classList.toggle('active', view === 'settingsView');
    }
    function searchText(value) {
      return String(value)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase();
    }
    function decorateButton(button2, label) {
      if (label === t('L\xE4uft \u2026')) {
        buttonContent(button2, label, 'spinner', false, true);
        return;
      }
      const trash = [
        t('Knoten l\xF6schen'),
        t('L\xF6schen'),
        t('Entfernen'),
        t('Plugin entfernen')
      ].includes(label);
      const name = trash
        ? 'trash'
        : label === t('Archivieren')
          ? 'archive'
          : label === t('Wiederherstellen')
            ? 'restore'
            : label === t('Einstellungen speichern')
              ? 'save'
              : label === t('\xD6ffnen')
                ? 'file'
                : label === t('Link \xF6ffnen')
                  ? 'link'
                  : null;
      buttonContent(button2, label, name, trash || label === t('Archivieren'));
    }
    function iconActionButton(text, fn, glyph, cls) {
      const b = button(text, fn, cls);
      buttonContent(b, text, glyph);
      return b;
    }
    function bind(id, fn) {
      $(id).addEventListener('click', () =>
        Promise.resolve()
          .then(fn)
          .catch((e) => toast(e.message))
      );
    }
    function modalChoice(...args) {
      return ui_default.modalChoice(...args);
    }
    function parameterModal(...args) {
      return ui_default.parameterModal(...args);
    }
    function updateStatus() {
      if ($('cancelActor')) $('cancelActor').hidden = !executionState.currentActorJob;
      if ($('actorActivity')) {
        const running = executionState.queueRunning || executionState.actorQueue.length > 0;
        $('actorActivity').hidden = false;
        $('actorActivity').classList.toggle('inactive', !running);
        $('actorActivity').replaceChildren(
          icon('spinner'),
          el(
            'span',
            {
              class: 'actor-current',
              title: executionState.currentActorJob?.label || ''
            },
            t(executionState.vpnWaiting ? 'Warte auf VPN' : 'Aktor wird ausgef\xFChrt')
          ),
          ...(executionState.actorQueue.length
            ? [
                el(
                  'span',
                  {
                    class: 'queue-count'
                  },
                  ' | ' + t('Wartend') + ': ' + (executionState.actorQueue.length || 0)
                )
              ]
            : [])
        );
      }
      if (!$('statusLight')) return;
      let state = 'yellow',
        label = t('Verbindung wird gepr\xFCft');
      if (shellState.backendOnline === false) {
        state = 'red';
        label = t('Backend nicht erreichbar');
      } else if (persistenceState.saveError || preferencesState.settingsError) {
        state = 'red';
        label = t('Speichern fehlgeschlagen');
      } else if (
        persistenceState.savePromise ||
        preferencesState.settingsPromise ||
        pluginsState.pendingPluginSaves.size
      ) {
        label = t('Speichert \u2026');
      } else if (persistenceState.dirty || preferencesState.settingsDirty) {
        label = t('Noch zu speichern');
      } else if (shellState.backendOnline === true) {
        state = 'green';
        label =
          workspaceState.project || !$('settingsView').hidden ? t('Gespeichert') : t('Verbunden');
      }
      $('statusLight').dataset.state = state;
      $('statusText').textContent = label;
      $('status').title =
        label +
        (shellState.backendCheckAt
          ? ' \xB7 ' +
            t('Letzte Pr\xFCfung') +
            ': ' +
            shellState.backendCheckAt.toLocaleTimeString()
          : '');
    }
    async function checkBackend() {
      try {
        const response = await fetch('/api/health', {
          signal: AbortSignal.timeout(5e3),
          cache: 'no-store'
        });
        const body = await response.json();
        shellState.backendOnline = response.ok && body.status === 'ok';
      } catch {
        shellState.backendOnline = false;
      }
      shellState.backendCheckAt = /* @__PURE__ */ new Date();
      updateStatus();
    }
    function panelVisibility() {
      if (!$('palette')) return;
      $('palette').hidden = canvasState.leftCollapsed;
      $('leftResize').hidden = canvasState.leftCollapsed;
      $('inspector').hidden = canvasState.rightCollapsed;
      $('rightResize').hidden = canvasState.rightCollapsed;
      $('toggleLeft').replaceChildren(
        icon(canvasState.leftCollapsed ? 'chevron-right' : 'chevron-left')
      );
      $('toggleLeft').setAttribute('aria-expanded', String(!canvasState.leftCollapsed));
      $('toggleRight').replaceChildren(
        icon(canvasState.rightCollapsed ? 'chevron-left' : 'chevron-right')
      );
      $('toggleRight').setAttribute('aria-expanded', String(!canvasState.rightCollapsed));
      $('toggleRight').disabled = !selectionState.inspectorSelectionKey;
    }
    function inspectorAvailability(key) {
      if (!key) {
        canvasState.rightCollapsed = true;
        selectionState.inspectorSelectionKey = '';
      } else if (key !== selectionState.inspectorSelectionKey) {
        canvasState.rightCollapsed = false;
        selectionState.inspectorSelectionKey = key;
      }
      panelVisibility();
    }
    function resizablePanel(handle, panel, side) {
      let resize = null;
      handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        resize = {
          x: event.clientX,
          width: panel.getBoundingClientRect().width
        };
        handle.setPointerCapture(event.pointerId);
        document.body.classList.add('resizing');
      });
      handle.addEventListener('pointermove', (event) => {
        if (!resize) return;
        const direction = side === 'left' ? 1 : -1,
          desired = resize.width + (event.clientX - resize.x) * direction;
        const other = $(side === 'left' ? 'inspector' : 'palette').getBoundingClientRect().width,
          available = document.querySelector('.workbody').getBoundingClientRect().width;
        const min = side === 'left' ? 150 : 240,
          max = Math.max(min, Math.min(side === 'left' ? 420 : 600, available - other - 300));
        panel.style.width = Math.max(min, Math.min(max, desired)) + 'px';
      });
      handle.addEventListener('pointerup', () => {
        resize = null;
        document.body.classList.remove('resizing');
        try {
          localStorage.setItem('argus.panel.' + side, panel.style.width);
        } catch {}
      });
      handle.addEventListener('pointercancel', () => {
        resize = null;
        document.body.classList.remove('resizing');
      });
      try {
        const stored = localStorage.getItem('argus.panel.' + side);
        if (stored && /^\d+(\.\d+)?px$/.test(stored)) panel.style.width = stored;
      } catch {}
    }
    function resizePaletteSplit() {
      const handle = $('paletteSplit');
      let state = null;
      handle.addEventListener('pointerdown', (e) => {
        state = {
          y: e.clientY,
          height: $('dataWindow').getBoundingClientRect().height
        };
        handle.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      handle.addEventListener('pointermove', (e) => {
        if (!state) return;
        const max = $('palette').clientHeight - 130;
        $('dataWindow').style.flex =
          '0 0 ' + Math.max(100, Math.min(max, state.height + e.clientY - state.y)) + 'px';
      });
      for (const name of ['pointerup', 'pointercancel'])
        handle.addEventListener(name, () => (state = null));
    }
    async function bootstrap() {
      setupProviderDismissal();
      const data = await api('/api/settings');
      preferencesState.appSettings = data.settings;
      await setLanguage(preferencesState.appSettings.language);
      decorateStaticIcons();
      await refreshCatalog();
      await home();
      startJobMonitor();
      await checkBackend();
      setInterval(checkBackend, 2e4);
    }
    const $ = (id) => document.getElementById(id);
    const uid = () => {
      if (typeof crypto.randomUUID === 'function') return crypto.randomUUID().replaceAll('-', '');
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    };
    return {
      toast,
      finishDialog,
      appDialog,
      askText,
      askConfirm,
      draggableDialog,
      saveIndicator,
      el,
      svg,
      button,
      show,
      searchText,
      decorateButton,
      iconActionButton,
      bind,
      modalChoice,
      parameterModal,
      updateStatus,
      checkBackend,
      panelVisibility,
      inspectorAvailability,
      resizablePanel,
      resizePaletteSplit,
      bootstrap,
      $,
      uid
    };
  }
};
var shell_default2 = shell_default;

// static/auth.js
var csrf = null;
var authentication = null;
async function login() {
  if (location.hash.startsWith('#pair='))
    history.replaceState(null, '', location.pathname + location.search);
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Argus-Client': 'web' },
    body: '{}'
  });
  if (!response.ok) throw Error(t('Verbindung zu Argus fehlgeschlagen.'));
  csrf = (await response.json()).csrf_token;
}
async function ensureAccess() {
  if (csrf) return;
  if (authentication) return authentication;
  authentication = (async () => {
    const response = await fetch('/api/auth/session');
    if (response.ok) {
      csrf = (await response.json()).csrf_token;
      return;
    }
    await login();
  })().finally(() => {
    authentication = null;
  });
  return authentication;
}
async function authorizedFetch(path, options = {}) {
  await ensureAccess();
  const headers = new Headers(options.headers || {});
  if ((options.method || 'GET') !== 'GET') headers.set('X-Argus-Token', csrf);
  let response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  if (response.status === 401) {
    csrf = null;
    await ensureAccess();
    headers.set('X-Argus-Token', csrf);
    response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  }
  return response;
}

// static/app/api.js
var api_default = {
  name: 'api',
  dependencies: ['updateStatus'],
  create({ shellState, updateStatus }) {
    async function api(path, body) {
      let response;
      try {
        response = await authorizedFetch(
          path,
          body === void 0
            ? {}
            : {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
              }
        );
      } catch (error) {
        shellState.backendOnline = false;
        updateStatus();
        throw error;
      }
      shellState.backendOnline = response.status < 500;
      const data = await response.json();
      updateStatus();
      if (!response.ok) {
        const problem = data.error || {};
        const error = new Error(
          t('errors.' + (problem.code || 'internal_error'), {
            ...problem.params,
            detail: diagnostic(problem.detail || '')
          })
        );
        error.code = problem.code;
        error.status = response.status;
        throw error;
      }
      return data;
    }
    return { api };
  }
};
var api_default2 = api_default;

// static/app/projects.js
var projects_default = {
  name: 'projects',
  dependencies: [
    '$',
    'api',
    'askConfirm',
    'button',
    'el',
    'historyButtons',
    'inspect',
    'panelVisibility',
    'parameterModal',
    'projectSnapshot',
    'render',
    'save',
    'saveButtons',
    'searchText',
    'show',
    'toast',
    'updateStatus'
  ],
  create({
    libraryState,
    persistenceState,
    workspaceState,
    selectionState,
    canvasState,
    historyState,
    $,
    api,
    askConfirm,
    button,
    el,
    historyButtons,
    inspect,
    panelVisibility,
    parameterModal,
    projectSnapshot,
    render,
    save,
    saveButtons,
    searchText,
    show,
    toast,
    updateStatus
  }) {
    function renderProjects() {
      const query = searchText(libraryState.homeQueries[libraryState.homeMode]);
      $('homeSearch').value = libraryState.homeQueries[libraryState.homeMode];
      $('homeActive').classList.toggle('active', libraryState.homeMode === 'active');
      $('homeArchive').classList.toggle('active', libraryState.homeMode === 'archive');
      $('newProject').hidden = false;
      const visible = libraryState.projectIndex.filter(
        (p) =>
          Boolean(p.archived_at) === (libraryState.homeMode === 'archive') &&
          searchText(p.title).includes(query)
      );
      $('projectCount').textContent = visible.length + t(' Projekte');
      $('projectList').replaceChildren();
      for (const p of visible) {
        const tile = el('article', {
          class: 'tile project-tile',
          'data-project': p.id
        });
        const date = p.archived_at || p.updated_at;
        tile.append(
          el('small', {}, new Date(date).toLocaleString(language)),
          el(
            'h2',
            {
              title: p.title
            },
            p.title
          ),
          el(
            'p',
            {
              class: 'project-kind'
            },
            p.archived_at ? t('Archiviert') : t('Aktives Projekt')
          )
        );
        const actions = el('div', {
          class: 'tile-actions'
        });
        if (p.archived_at) {
          actions.append(
            button(t('Wiederherstellen'), () => setArchived(p, false)),
            button(t('L\xF6schen'), () => deleteProject(p), 'danger-filled')
          );
        } else
          actions.append(
            button(t('\xD6ffnen'), () => openProject(p.id), 'primary'),
            button(t('Archivieren'), () => setArchived(p, true), 'archive-action')
          );
        const rename = button(t('Titel bearbeiten'), async () => {
          const result = await parameterModal(
            {
              title: 'Projekttitel bearbeiten',
              fields: [{ key: 'title', label: 'Projekttitel', required: true, maxLength: 200 }]
            },
            { title: p.title }
          );
          if (!result?.title?.trim()) return;
          await api('/api/projects/' + p.id + '/rename', {
            title: result.title.trim(),
            revision: p.revision
          });
          libraryState.projectIndex = await api('/api/projects');
          renderProjects();
        });
        buttonContent(rename, t('Titel bearbeiten'), 'edit', true);
        actions.insertBefore(rename, actions.children[1] || null);
        tile.append(actions);
        $('projectList').append(tile);
      }
      if (!visible.length)
        $('projectList').append(
          el(
            'p',
            {
              class: 'empty-state'
            },
            query
              ? t('Keine passenden Projekte gefunden.')
              : libraryState.homeMode === 'archive'
                ? t('Das Archiv ist leer.')
                : t('Noch keine Projekte vorhanden.')
          )
        );
    }
    async function setArchived(p, archived) {
      await api('/api/projects/' + p.id + '/archive', {
        archived,
        revision: p.revision
      });
      libraryState.projectIndex = await api('/api/projects');
      renderProjects();
      toast(archived ? t('Projekt archiviert.') : t('Projekt wiederhergestellt.'));
    }
    async function deleteProject(p) {
      if (
        !(await askConfirm(
          t('Projekt l\xF6schen'),
          '\u201E' + p.title + t('\u201C endg\xFCltig aus dem Archiv l\xF6schen?')
        ))
      )
        return;
      await api('/api/projects/' + p.id + '/delete', {
        revision: p.revision
      });
      libraryState.projectIndex = await api('/api/projects');
      renderProjects();
      toast(t('Projekt gel\xF6scht.'));
    }
    async function home() {
      if (persistenceState.dirty) await save();
      clearTimeout(persistenceState.autosaveTimer);
      persistenceState.dirtyNodes.clear();
      persistenceState.dirty = false;
      show('home');
      workspaceState.project = null;
      libraryState.projectIndex = await api('/api/projects');
      renderProjects();
      updateStatus();
    }
    async function openProject(id) {
      workspaceState.project = await api('/api/projects/' + id);
      selectionState.selected.clear();
      selectionState.selectedEdges.clear();
      persistenceState.dirtyNodes.clear();
      persistenceState.saveError = '';
      persistenceState.dirty = false;
      canvasState.pan = {
        x: 60,
        y: 70,
        scale: 1
      };
      $('projectTitle').textContent = workspaceState.project.title;
      show('workspace');
      selectionState.inspectorSelectionKey = '';
      canvasState.rightCollapsed = true;
      panelVisibility();
      updateStatus();
      workspaceState.lastServerSnapshot = structuredClone(workspaceState.project.document);
      workspaceState.lastServerTitle = workspaceState.project.title;
      historyState.lastSnapshot = projectSnapshot();
      historyState.undoStack = [];
      historyState.redoStack = [];
      render();
      inspect();
      saveButtons();
      historyButtons();
    }
    async function leaveWorkspace() {
      if (persistenceState.dirty) await save();
      clearTimeout(persistenceState.autosaveTimer);
      workspaceState.project = null;
      persistenceState.dirty = false;
      selectionState.selectedGroup = null;
      selectionState.selected.clear();
    }
    return { renderProjects, setArchived, deleteProject, home, openProject, leaveWorkspace };
  }
};
var projects_default2 = projects_default;

// static/app/persistence.js
var persistence_default = {
  name: 'persistence',
  dependencies: ['$', 'api', 'recordHistory', 'saveIndicator', 'toast', 'updateStatus'],
  create({
    persistenceState,
    workspaceState,
    canvasState,
    $,
    api,
    recordHistory,
    saveIndicator,
    toast,
    updateStatus
  }) {
    function keepNodeReferences(previous, canonical) {
      for (const collection of ['nodes', 'groups']) {
        const existing = new Map((previous[collection] || []).map((item) => [item.id, item]));
        canonical[collection] = (canonical[collection] || []).map((remote) => {
          const local = existing.get(remote.id);
          if (!local) return remote;
          for (const key of Object.keys(local)) if (!(key in remote)) delete local[key];
          Object.assign(local, remote);
          return local;
        });
      }
      return canonical;
    }
    function saveButtons() {
      updateStatus();
      saveIndicator(
        $('save'),
        persistenceState.savePromise
          ? 'saving'
          : persistenceState.saveError
            ? 'error'
            : persistenceState.dirty
              ? 'pending'
              : 'saved',
        persistenceState.saveError
      );
      for (const item of document.querySelectorAll('[data-node-save]'))
        saveIndicator(
          item,
          persistenceState.savePromise && persistenceState.dirtyNodes.has(item.dataset.nodeSave)
            ? 'saving'
            : persistenceState.saveError
              ? 'error'
              : persistenceState.dirtyNodes.has(item.dataset.nodeSave)
                ? 'pending'
                : 'saved',
          persistenceState.saveError
        );
    }
    function change(nodeId, scope) {
      if (workspaceState.project?.archived_at) {
        workspaceState.project.document = structuredClone(workspaceState.lastServerSnapshot);
        toast('Archiviertes Projekt: zum Bearbeiten wiederherstellen.');
        return;
      }
      canvasState.groupBoundsCache = null;
      recordHistory(scope || nodeId);
      persistenceState.changeVersion++;
      persistenceState.dirty = true;
      if (nodeId) persistenceState.dirtyNodes.add(nodeId);
      saveButtons();
      clearTimeout(persistenceState.autosaveTimer);
      if (workspaceState.project)
        persistenceState.autosaveTimer = setTimeout(
          () => save().catch((error) => toast(error.message)),
          700
        );
    }
    async function reconcileWorkspace(base) {
      const current = workspaceState.project;
      if (!current) return false;
      for (let attempt = 0; attempt < 4; attempt++) {
        const version = persistenceState.changeVersion;
        const response = await api('/api/projects/' + current.id + '/reconcile', {
          base,
          local: structuredClone(current.document),
          base_title: workspaceState.lastServerTitle,
          title: current.title
        });
        if (workspaceState.project !== current) return false;
        if (version !== persistenceState.changeVersion) continue;
        const titleUnchanged = current.title === workspaceState.lastServerTitle;
        current.document = keepNodeReferences(current.document, response.document);
        current.revision = response.revision;
        if (titleUnchanged) {
          current.title = response.title;
          $('projectTitle').textContent = current.title;
        }
        workspaceState.lastServerSnapshot = structuredClone(response.server_document);
        workspaceState.lastServerTitle = response.server_title;
        persistenceState.dirty = response.has_local_changes;
        return true;
      }
      persistenceState.dirty = true;
      return false;
    }
    async function save() {
      if (!workspaceState.project || workspaceState.project.archived_at)
        return workspaceState.project;
      if (persistenceState.savePromise) return persistenceState.savePromise;
      if (!persistenceState.dirty) return workspaceState.project;
      clearTimeout(persistenceState.autosaveTimer);
      const current = workspaceState.project,
        version = persistenceState.changeVersion;
      current.title = $('projectTitle').textContent;
      const sent = structuredClone(current.document);
      const payload = {
        base: structuredClone(workspaceState.lastServerSnapshot || sent),
        local: sent,
        title: current.title,
        base_title: workspaceState.lastServerTitle,
        persist: true
      };
      persistenceState.saveError = '';
      persistenceState.savePromise = api('/api/projects/' + current.id + '/reconcile', payload)
        .then(async (saved) => {
          if (workspaceState.project !== current) return saved;
          if (version === persistenceState.changeVersion) {
            current.document = keepNodeReferences(current.document, saved.document);
            current.revision = saved.revision;
            current.title = saved.title;
            $('projectTitle').textContent = current.title;
            workspaceState.lastServerSnapshot = structuredClone(saved.document);
            workspaceState.lastServerTitle = saved.title;
            persistenceState.dirty = false;
            persistenceState.dirtyNodes.clear();
          } else await reconcileWorkspace(sent);
          return saved;
        })
        .catch((error) => {
          persistenceState.saveError = error.message;
          persistenceState.dirty = true;
          throw error;
        })
        .finally(() => {
          persistenceState.savePromise = null;
          saveButtons();
          if (persistenceState.dirty)
            persistenceState.autosaveTimer = setTimeout(
              () => save().catch((error) => toast(error.message)),
              persistenceState.saveError ? 5e3 : 300
            );
        });
      saveButtons();
      return persistenceState.savePromise;
    }
    return { saveButtons, change, save, reconcileWorkspace };
  }
};
var persistence_default2 = persistence_default;

// static/app/labels.js
var fieldNames = {
  model_name: 'Modell',
  detector_backend: 'Gesichtsdetektor',
  distance_metric: 'Distanzmetrik',
  normalization: 'Normalisierung',
  align: 'Gesichter ausrichten',
  enforce_detection: 'Gesichtserkennung voraussetzen',
  expand_percentage: 'Bildausschnitt erweitern (%)',
  custom_threshold: 'Eigenen Schwellenwert verwenden',
  threshold: 'Schwellenwert',
  anti_spoofing: 'Anti-Spoofing',
  include_overlays: 'Bilder mit Erkennungs-Overlays ausgeben',
  resize_large_images: 'Bilder \xFCber 40 MP als verkleinerte Arbeitskopie verarbeiten',
  first_name: 'Vorname',
  middle_name: 'Zweitname',
  last_name: 'Nachname',
  birth_date: 'Geburtsdatum',
  birth_place: 'Geburtsort',
  birth_country: 'Geburtsland',
  argus_browser_enabled: 'Eingebauter Browser / Cloudflare-Pr\xFCfung',
  argus_browser_timeout: 'Browser-Zeitlimit (Sekunden)',
  provider: 'Anbieter',
  url: 'URL',
  identifier: 'Identifier',
  identifier_kind: 'Identifier-Typ',
  nominatim_url: 'Nominatim-Endpunkt (eigene oder geeignete Instanz)',
  photon_url: 'Photon-Endpunkt',
  mime: 'Dateityp',
  size: 'Dateigr\xF6\xDFe (Bytes)',
  sherlock_sites: 'Sherlock: Websites (leer = alle)',
  maigret_sites: 'Maigret: Websites (leer = Top-Auswahl)',
  holehe_sites: 'Holehe: Anbieter (leer = alle)',
  top_sites: 'Maigret: Anzahl Top-Websites',
  consensus_sites: 'Consensus: Websites (leer = alle)',
  use_consensus: 'Quelle: Consensus',
  use_sherlock: 'Quelle: Sherlock',
  use_maigret: 'Quelle: Maigret',
  use_user_scanner: 'Quelle: User Scanner',
  use_blackbird: 'Quelle: Blackbird',
  use_holehe: 'Quelle: Holehe',
  use_phoneinfoga: 'Quelle: PhoneInfoga',
  use_ignorant: 'Quelle: Ignorant',
  phone_region: 'Land f\xFCr nationale Telefonnummern',
  disabled_scanners: 'Deaktivierte Scanner (eine pro Zeile)',
  numverify_api_key: 'Numverify API-Key',
  googlecse_api_key: 'Google API-Key',
  googlecse_cx: 'Google Suchmaschinen-ID',
  date: 'Datum',
  time: 'Uhrzeit',
  value: 'Inhalt',
  semantic_key: 'Bedeutung',
  service: 'Anbieter',
  text: 'Text',
  country_code: 'L\xE4ndercode',
  country: 'Land',
  admin_area_1: 'Bundesland / State / Provinz',
  admin_area_2: 'Landkreis / County',
  admin_area_3: 'Weitere Verwaltungsebene',
  locality: 'Stadt / Ort',
  dependent_locality: 'Stadtteil / Untergeordneter Ort',
  postal_code: 'Postleitzahl',
  street: 'Stra\xDFe',
  house_number: 'Hausnummer',
  building: 'Geb\xE4ude',
  unit: 'Wohnung / Einheit',
  po_box: 'Postfach',
  latitude: 'Breitengrad',
  longitude: 'L\xE4ngengrad',
  original_input: 'Urspr\xFCngliche Ortsangabe',
  formatted_address: 'Vollst\xE4ndige Adresse',
  granularity: 'Genauigkeit',
  timezone: 'Zeitzone',
  sites: 'Websites (eine pro Zeile; leer = alle)',
  request_timeout: 'Zeitlimit je Website (Sekunden)',
  run_timeout: 'Gesamtzeitlimit (Sekunden)',
  max_results: 'Maximale Treffer',
  enrich: 'Online vervollst\xE4ndigen',
  filename: 'Dateiname',
  retrieved_at: 'Abgerufen am',
  origin: 'Herkunft',
  created_at: 'Erstellt am',
  plugin: 'Plugin',
  action: 'Aktion',
  status: 'Status',
  source: 'Quelle',
  source_input: 'Ausgangsinformation',
  run_id: 'Suchlauf',
  assessment: 'Bewertung',
  coordinate_role: 'Bedeutung der Koordinaten',
  conflicts: 'Abweichungen',
  metadata: 'Metadaten',
  exif: 'EXIF',
  gps: 'GPS',
  extra: 'Weitere Angaben',
  rows: 'Einzelpr\xFCfungen',
  counts: 'Ergebnis\xFCbersicht'
};
var nodeLabels = {
  actor: 'Aktor',
  value: 'Value / Eigener Wert',
  url: 'URL',
  email: 'E-Mail',
  phone: 'Telefonnummer',
  username: 'Benutzername',
  location: 'Ort',
  image: 'Bild',
  datetime: 'Datum / Zeit',
  note: 'Notiz',
  file: 'Datei'
};
var transformExample =
  'return inputs.map(node => ({\n  type: "value",\n  label: "Kopie: " + node.label,\n  data: node.data\n}));';
var providerFields = {
  consensus: ['consensus_sites'],
  argus: ['argus_browser_enabled', 'argus_browser_timeout'],
  sherlock: ['sherlock_sites'],
  maigret: ['maigret_sites', 'top_sites'],
  holehe: ['holehe_sites'],
  photon: ['photon_url'],
  nominatim: ['nominatim_url'],
  phoneinfoga: ['disabled_scanners', 'numverify_api_key', 'googlecse_api_key', 'googlecse_cx']
};
var displayOptions = {
  profile: [['openButton', 'Quick Action: Link \xF6ffnen']],
  url: [['openButton', 'Quick Action: Link \xF6ffnen']],
  image: [
    ['preview', 'Glance: Bildvorschau'],
    ['imageButton', 'Quick Action: Bild anzeigen']
  ],
  file: [['fileButton', 'Quick Action: Datei \xF6ffnen']],
  location: [
    ['map', 'Glance: Kartenvorschau'],
    ['mapsButton', 'Quick Action: Google Maps'],
    ['appleMapsButton', 'Quick Action: Apple Maps'],
    ['osmButton', 'Quick Action: OpenStreetMap']
  ]
};

// static/app/node-commands.js
var node_commands_default = {
  name: 'node-commands',
  dependencies: [
    '$',
    'actionAcceptsNode',
    'actorIncompatible',
    'change',
    'freeNodeSpot',
    'groupDescendantIds',
    'groupNodeIds',
    'inspect',
    'newNodeLabel',
    'nodeRect',
    'pluginText',
    'pruneGroups',
    'render',
    'uid'
  ],
  create({
    preferencesState,
    canvasState,
    pluginsState,
    workspaceState,
    selectionState,
    persistenceState,
    uploadsState,
    $,
    actionAcceptsNode,
    actorIncompatible,
    change,
    freeNodeSpot,
    groupDescendantIds,
    groupNodeIds,
    inspect,
    newNodeLabel,
    nodeRect,
    pluginText,
    pruneGroups,
    render,
    uid
  }) {
    function newNode(type, label, data, x, y) {
      const n = {
        id: uid(),
        type,
        label,
        data,
        display: structuredClone(preferencesState.appSettings.node_display_defaults?.[type] || {}),
        ...(['note', 'marker'].includes(type)
          ? {
              appearance: {
                width: 320,
                height: 180,
                color: '#ffcc70'
              }
            }
          : {}),
        x: x ?? (160 - canvasState.pan.x) / canvasState.pan.scale,
        y: y ?? (130 - canvasState.pan.y) / canvasState.pan.scale,
        evidence: {
          origin: 'manual',
          created_at: /* @__PURE__ */ /* @__PURE__ */ new Date().toISOString(),
          ...(type !== 'actor' && label === newNodeLabel(type) && pluginsState.dataTypes.get(type)
            ? {
                label_key:
                  pluginsState.dataTypes.get(type).node.new_label ||
                  pluginsState.dataTypes.get(type).node.name
              }
            : {})
        }
      };
      const spot = type === 'marker' ? { x: n.x, y: n.y } : freeNodeSpot(nodeRect(n));
      n.x = spot.x;
      n.y = spot.y;
      workspaceState.project.document.nodes.push(n);
      selectionState.selected = /* @__PURE__ */ new Set([n.id]);
      change(n.id);
      render();
      inspect();
      return n;
    }
    function addData(type, x, y) {
      if (persistenceState.busy) return;
      if (type === 'image' || type === 'file') {
        uploadsState.pendingUploadType = type;
        uploadsState.pendingImagePosition =
          x === void 0
            ? null
            : {
                x,
                y
              };
        $('fileInput').accept = type === 'image' ? 'image/*' : '';
        $('fileInput').click();
        return;
      }
      newNode(type, newNodeLabel(type), structuredClone(workspaceState.templates[type]), x, y);
    }
    function addActor(plugin, action, inputOverride = null) {
      if (persistenceState.busy) return;
      let inputs = inputOverride || selectedData();
      if (selectionState.selectedGroup && !inputOverride)
        inputs = inputs.filter((n) => actionAcceptsNode(action, n));
      if (actorIncompatible(action, inputs, true))
        throw Error(t('Die ausgew\xE4hlten Daten passen nicht zu diesem Aktor.'));
      const x = inputs.length ? Math.max(...inputs.map((n) => n.x + nodeRect(n).w)) + 200 : void 0,
        y = inputs[0] ? inputs[0].y + (nodeRect(inputs[0]).h - 76) / 2 : void 0;
      const actor = newNode(
        'actor',
        pluginText(plugin, action.name),
        {
          plugin: plugin.id,
          action: action.id,
          params:
            action.execution === 'browser'
              ? {
                  code: transformExample
                }
              : Object.fromEntries(
                  Object.entries(structuredClone(action.default_params || {})).filter(
                    ([key]) =>
                      !key.startsWith('use_') &&
                      key !== 'source_order' &&
                      !(action.settings_only || []).includes(key) &&
                      !/(password|token|secret|api_key|sessionid)$/.test(key)
                  )
                )
        },
        x,
        y
      );
      for (const [index, n] of inputs.entries())
        workspaceState.project.document.edges.push({
          id: uid(),
          source: n.id,
          target: actor.id,
          source_port: 'right',
          target_port: `left:${index}:${Math.max(1, action.min_inputs || 1)}`,
          label: t('Eingabe')
        });
      change(actor.id);
      render();
      inspect();
      return actor;
    }
    function updateDeleteButtons() {
      if ($('ungroupNodes'))
        $('ungroupNodes').disabled =
          persistenceState.busy ||
          !(selectionState.selectedGroups.size || selectionState.selectedGroup);
      if ($('detachNodes'))
        $('detachNodes').disabled =
          persistenceState.busy ||
          !workspaceState.project?.document.groups.some((g) =>
            g.members.some((id) => selectionState.selected.has(id))
          );
      if ($('expandAllGroups'))
        $('expandAllGroups').disabled = !workspaceState.project?.document.groups.some(
          (g) => g.collapsed
        );
      if ($('collapseAllGroups'))
        $('collapseAllGroups').disabled = !workspaceState.project?.document.groups.some(
          (g) => !g.collapsed
        );
      const hasSelection =
        selectionState.selected.size ||
        selectionState.selectedGroups.size ||
        selectionState.selectedGroup ||
        selectionState.selectedEdges.size;
      for (const id of ['deleteSelected', 'deleteDescendants'])
        if ($(id)) $(id).disabled = persistenceState.busy || !hasSelection;
    }
    function deleteSelectionWithChildren() {
      if (!workspaceState.project || persistenceState.busy) return;
      const ids = new Set(selectionState.selected);
      for (const group of workspaceState.project.document.groups)
        if (
          selectionState.selectedGroups.has(group.id) ||
          group.id === selectionState.selectedGroup
        )
          for (const id of groupNodeIds(group)) ids.add(id);
      const next = /* @__PURE__ */ new Map();
      for (const edge of workspaceState.project.document.edges) {
        if (!next.has(edge.source)) next.set(edge.source, []);
        next.get(edge.source).push(edge.target);
      }
      const queue = [...ids];
      for (let i = 0; i < queue.length; i++)
        for (const child of next.get(queue[i]) || [])
          if (!ids.has(child)) {
            ids.add(child);
            queue.push(child);
          }
      deleteNodes([...ids]);
    }
    function deleteGroup(group) {
      if (!group || !workspaceState.project) return;
      const removed = groupDescendantIds(group.id),
        nodes = [...groupNodeIds(group)];
      workspaceState.project.document.groups = workspaceState.project.document.groups.filter(
        (g) => !removed.has(g.id)
      );
      deleteNodes(nodes, true);
    }
    function deleteSelection() {
      if (selectionState.selectedEdges.size) {
        deleteEdges([...selectionState.selectedEdges]);
        return;
      }
      const groups = selectionState.selectedGroups.size
        ? [...selectionState.selectedGroups]
        : selectionState.selectedGroup
          ? [selectionState.selectedGroup]
          : [];
      if (groups.length) {
        const ids = new Set(selectionState.selected),
          removed = /* @__PURE__ */ new Set();
        for (const id of groups) {
          const group = workspaceState.project.document.groups.find((g) => g.id === id);
          if (group) {
            for (const node of groupNodeIds(group)) ids.add(node);
            for (const child of groupDescendantIds(id)) removed.add(child);
          }
        }
        workspaceState.project.document.groups = workspaceState.project.document.groups.filter(
          (g) => !removed.has(g.id)
        );
        deleteNodes([...ids], true);
      } else deleteNodes([...selectionState.selected]);
    }
    function deleteNodes(ids, groupRemoved = false) {
      if (persistenceState.busy || (!ids.length && !groupRemoved)) return;
      const nodes = workspaceState.project.document.nodes.filter((n) => ids.includes(n.id));
      if (!nodes.length && !groupRemoved) return;
      const remove = new Set(ids),
        doc = workspaceState.project.document;
      doc.nodes = doc.nodes.filter((n) => !remove.has(n.id));
      doc.edges = doc.edges.filter((e) => !remove.has(e.source) && !remove.has(e.target));
      for (const g of doc.groups) g.members = g.members.filter((id) => !remove.has(id));
      doc.groups = pruneGroups(doc.groups, new Set(doc.nodes.map((n) => n.id)));
      selectionState.selected.clear();
      selectionState.selectedEdges.clear();
      selectionState.selectedGroup = null;
      selectionState.selectedGroups.clear();
      change();
      render();
      inspect();
    }
    function deleteEdges(ids) {
      if (!workspaceState.project) return;
      const remove = new Set(ids);
      workspaceState.project.document.edges = workspaceState.project.document.edges.filter(
        (e) => !remove.has(e.id)
      );
      selectionState.selectedEdges.clear();
      change();
      render();
      inspect();
    }
    function selectedData() {
      const ids = new Set(selectionState.selected);
      for (const id of selectionState.selectedGroups.size
        ? selectionState.selectedGroups
        : selectionState.selectedGroup
          ? [selectionState.selectedGroup]
          : []) {
        const group = workspaceState.project?.document.groups.find((g) => g.id === id);
        if (group) for (const node of groupNodeIds(group)) ids.add(node);
      }
      return workspaceState.project
        ? workspaceState.project.document.nodes.filter((n) => n.type !== 'actor' && ids.has(n.id))
        : [];
    }
    function editableNodeData(node) {
      const data = {};
      for (const [key, value] of Object.entries(workspaceState.templates[node.type] || {})) {
        if (node.type === 'error' && key === 'title') continue;
        if (
          node.type === 'location' &&
          ['formatted_address', 'original_input', 'granularity', 'coordinate_role'].includes(key)
        )
          continue;
        data[key] = node.data[key] ?? structuredClone(value);
      }
      return data;
    }
    return {
      newNode,
      addData,
      addActor,
      updateDeleteButtons,
      deleteSelectionWithChildren,
      deleteGroup,
      deleteSelection,
      deleteNodes,
      deleteEdges,
      selectedData,
      editableNodeData
    };
  }
};
var node_commands_default2 = node_commands_default;

// static/app/layout.js
var layout_default = {
  name: 'layout',
  dependencies: [
    '$',
    'change',
    'groupAncestors',
    'groupBounds',
    'groupDescendantIds',
    'groupNodeIds',
    'hiddenGroupIds',
    'intersects',
    'nodeRect',
    'orderedGroups',
    'render'
  ],
  create({
    workspaceState,
    persistenceState,
    canvasState,
    $,
    change,
    groupAncestors,
    groupBounds,
    groupDescendantIds,
    groupNodeIds,
    hiddenGroupIds,
    intersects,
    nodeRect,
    orderedGroups,
    render
  }) {
    function layoutPositions(units, edges, mode) {
      const positions = /* @__PURE__ */ new Map();
      if (!units.length) return positions;
      if (mode === 'grid') {
        const columns = Math.ceil(Math.sqrt(units.length));
        const widths = Array(columns).fill(0);
        const heights = Array(Math.ceil(units.length / columns)).fill(0);
        units.forEach((u, i) => {
          widths[i % columns] = Math.max(widths[i % columns], u.w);
          heights[Math.floor(i / columns)] = Math.max(heights[Math.floor(i / columns)], u.h);
        });
        units.forEach((u, i) => {
          const column = i % columns,
            row = Math.floor(i / columns);
          positions.set(u.id, {
            x:
              widths.slice(0, column).reduce((sum, width) => sum + width + 70, 0) +
              (widths[column] - u.w) / 2,
            y:
              heights.slice(0, row).reduce((sum, height) => sum + height + 70, 0) +
              (heights[row] - u.h) / 2
          });
        });
      } else if (mode === 'radial') {
        let radius = 0;
        for (let i = 0; i < units.length; i++) {
          for (let j = i + 1; j < units.length; j++) {
            const separation =
              (Math.hypot(units[i].w, units[i].h) + Math.hypot(units[j].w, units[j].h)) / 2 + 70;
            radius = Math.max(
              radius,
              separation / (2 * Math.sin((Math.PI * (j - i)) / units.length))
            );
          }
        }
        units.forEach((u, i) => {
          const angle = (2 * Math.PI * i) / units.length - Math.PI / 2;
          positions.set(u.id, {
            x: radius * Math.cos(angle) - u.w / 2,
            y: radius * Math.sin(angle) - u.h / 2
          });
        });
      } else {
        const degree = new Map(units.map((u) => [u.id, 0])),
          next = new Map(units.map((u) => [u.id, /* @__PURE__ */ new Set()])),
          levels = new Map(units.map((u) => [u.id, 0]));
        for (const [from, to] of edges) {
          if (from === to || !next.has(from) || !degree.has(to) || next.get(from).has(to)) continue;
          next.get(from).add(to);
          degree.set(to, degree.get(to) + 1);
        }
        const queue = units.filter((u) => degree.get(u.id) === 0).map((u) => u.id);
        let head = 0;
        const visited = /* @__PURE__ */ new Set();
        while (head < queue.length) {
          const id = queue[head++];
          visited.add(id);
          for (const target of next.get(id)) {
            levels.set(target, Math.max(levels.get(target), levels.get(id) + 1));
            degree.set(target, degree.get(target) - 1);
            if (degree.get(target) === 0) queue.push(target);
          }
        }
        const cyclicLevel = Math.max(...levels.values()) + 1;
        for (const u of units) if (!visited.has(u.id)) levels.set(u.id, cyclicLevel);
        const columns = /* @__PURE__ */ new Map();
        for (const u of units) {
          const level = levels.get(u.id);
          if (!columns.has(level)) columns.set(level, []);
          columns.get(level).push(u);
        }
        const orderedLevels = [...columns.keys()].sort((a, b) => a - b);
        const rank = /* @__PURE__ */ new Map();
        const updateRanks = () => {
          for (const column of columns.values()) column.forEach((u, i) => rank.set(u.id, i));
        };
        updateRanks();
        for (let pass = 0; pass < 4; pass++) {
          const forward = pass % 2 === 0;
          for (const level of forward ? orderedLevels : [...orderedLevels].reverse()) {
            const score = (id) => {
              const neighbors = edges
                .filter(([a, b]) => (forward ? b === id : a === id))
                .map(([a, b]) => (forward ? a : b))
                .filter((n) => rank.has(n));
              return neighbors.length
                ? neighbors.reduce((sum, n) => sum + rank.get(n), 0) / neighbors.length
                : rank.get(id);
            };
            columns.get(level).sort((a, b) => score(a.id) - score(b.id));
            updateRanks();
          }
        }
        const maxHeight = Math.max(
          ...[...columns.values()].map((column) => column.reduce((sum, u) => sum + u.h + 60, -60))
        );
        let x = 0;
        for (const level of orderedLevels) {
          let y = (maxHeight - columns.get(level).reduce((sum, u) => sum + u.h + 60, -60)) / 2,
            width = 0;
          for (const u of columns.get(level)) {
            positions.set(u.id, {
              x,
              y
            });
            y += u.h + 60;
            width = Math.max(width, u.w);
          }
          x += width + 110;
        }
      }
      return positions;
    }
    function arrangeProject(mode) {
      if (!workspaceState.project || persistenceState.busy) return;
      arrangeGroupContents(mode);
      const doc = workspaceState.project.document,
        owners = /* @__PURE__ */ new Map(),
        units = [];
      for (const group of doc.groups.filter((g) => !g.parent_id)) {
        const groupIds = groupNodeIds(group),
          nodes = doc.nodes.filter((n) => groupIds.has(n.id) && !owners.has(n.id));
        if (!nodes.length) continue;
        const bounds = groupBounds(group),
          id = 'group:' + group.id;
        for (const n of nodes) owners.set(n.id, id);
        units.push({
          id,
          members: nodes,
          x: bounds.x,
          y: bounds.y,
          w: group.collapsed ? 220 : bounds.w,
          h: group.collapsed ? 76 : bounds.h
        });
      }
      for (const n of doc.nodes)
        if (!owners.has(n.id) && n.type !== 'marker') {
          owners.set(n.id, n.id);
          units.push({
            id: n.id,
            members: [n],
            x: n.x,
            y: n.y,
            w: nodeRect(n).w,
            h: nodeRect(n).h
          });
        }
      const edges = doc.edges.map((e) => [owners.get(e.source), owners.get(e.target)]);
      let positions;
      if (mode === 'hierarchical') positions = layoutPositions(units, edges, mode);
      else {
        const byId = new Map(units.map((u) => [u.id, u]));
        const claimed = /* @__PURE__ */ new Set(),
          clusters = [],
          clusterOwner = /* @__PURE__ */ new Map();
        for (const unit of units.filter(
          (u) => u.members.length === 1 && u.members[0].type === 'actor'
        )) {
          const outputs = edges
            .filter(([from, to]) => from === unit.id && to !== unit.id)
            .map(([, to]) => byId.get(to))
            .filter(
              (u) =>
                u && u.members.length === 1 && u.members[0].type !== 'actor' && !claimed.has(u.id)
            );
          const members = [unit, ...new Map(outputs.map((u) => [u.id, u])).values()];
          const local = layoutPositions(members, [], mode);
          const left = Math.min(...members.map((u) => local.get(u.id).x)),
            top = Math.min(...members.map((u) => local.get(u.id).y));
          const cluster = {
            id: unit.id,
            members,
            local,
            x: left,
            y: top,
            w: Math.max(...members.map((u) => local.get(u.id).x + u.w)) - left,
            h: Math.max(...members.map((u) => local.get(u.id).y + u.h)) - top
          };
          clusters.push(cluster);
          for (const member of members) {
            claimed.add(member.id);
            clusterOwner.set(member.id, cluster.id);
          }
        }
        for (const unit of units)
          if (!claimed.has(unit.id)) {
            clusters.push({
              ...unit,
              members: [unit],
              local: /* @__PURE__ */ new Map([[unit.id, { x: 0, y: 0 }]]),
              x: 0,
              y: 0
            });
            clusterOwner.set(unit.id, unit.id);
          }
        const clusterEdges = edges.map(([a, b]) => [clusterOwner.get(a), clusterOwner.get(b)]);
        const blocks = layoutPositions(clusters, clusterEdges, 'hierarchical');
        positions = /* @__PURE__ */ new Map();
        for (const cluster of clusters)
          for (const unit of cluster.members)
            positions.set(unit.id, {
              x: blocks.get(cluster.id).x + cluster.local.get(unit.id).x - cluster.x,
              y: blocks.get(cluster.id).y + cluster.local.get(unit.id).y - cluster.y
            });
      }
      for (const unit of units) {
        const pos = positions.get(unit.id);
        for (const node of unit.members) {
          node.x += pos.x - unit.x;
          node.y += pos.y - unit.y;
        }
      }
      $('cleanupMenu').open = false;
      change();
      render();
      $('fit').click();
    }
    function fitViewport(rects, width, height, padding = 40) {
      if (!rects.length)
        return {
          x: width / 2,
          y: height / 2,
          scale: 1
        };
      const left = Math.min(...rects.map((r) => r.x)),
        top = Math.min(...rects.map((r) => r.y)),
        right = Math.max(...rects.map((r) => r.x + r.w)),
        bottom = Math.max(...rects.map((r) => r.y + r.h));
      const scale = Math.min(
        1.1,
        Math.max(1, width - 2 * padding) / Math.max(1, right - left),
        Math.max(1, height - 2 * padding) / Math.max(1, bottom - top)
      );
      return {
        scale,
        x: width / 2 - ((left + right) * scale) / 2,
        y: height / 2 - ((top + bottom) * scale) / 2
      };
    }
    function centerProject() {
      if (!workspaceState.project) return;
      const rects = [],
        hidden = /* @__PURE__ */ new Set(),
        hiddenGroups = hiddenGroupIds();
      for (const group of orderedGroups()) {
        if (hiddenGroups.has(group.id)) continue;
        const bounds = groupBounds(group);
        rects.push({
          x: bounds.x,
          y: bounds.y,
          w: group.collapsed ? 220 : bounds.w,
          h: group.collapsed ? 76 : bounds.h
        });
        if (group.collapsed) for (const id of groupNodeIds(group)) hidden.add(id);
      }
      for (const node of workspaceState.project.document.nodes)
        if (!hidden.has(node.id)) rects.push(nodeRect(node));
      const box = $('graph').getBoundingClientRect();
      canvasState.pan = fitViewport(rects, box.width, box.height);
      render();
    }
    function freeNodeSpot(rect) {
      const hidden = /* @__PURE__ */ new Set(),
        obstacles = [];
      for (const group of workspaceState.project.document.groups.filter((g) => !g.parent_id)) {
        const b = groupBounds(group);
        obstacles.push({
          ...b,
          w: group.collapsed ? 220 : b.w,
          h: group.collapsed ? 76 : b.h
        });
        for (const id of groupNodeIds(group)) hidden.add(id);
      }
      for (const node of workspaceState.project.document.nodes)
        if (node.type !== 'marker' && !hidden.has(node.id)) obstacles.push(nodeRect(node));
      const spot = {
        ...rect
      };
      for (
        let i = 0;
        i <
        workspaceState.project.document.nodes.length +
          workspaceState.project.document.groups.length +
          2;
        i++
      ) {
        const collisions = obstacles.filter((r) => intersects(spot, r, 25));
        if (!collisions.length) break;
        spot.y = Math.max(...collisions.map((r) => r.y + r.h)) + 35;
      }
      return spot;
    }
    function makeRoomForGroup(group) {
      const ancestors = groupAncestors(group.id),
        excluded = groupDescendantIds(group.id);
      for (const id of ancestors) excluded.add(id);
      makeRoomAround(groupBounds(group), groupNodeIds(group), excluded);
    }
    function makeRoomForNode(node) {
      const excluded = /* @__PURE__ */ new Set();
      for (const group of workspaceState.project.document.groups)
        if (group.members.includes(node.id)) {
          excluded.add(group.id);
          for (const id of groupAncestors(group.id)) excluded.add(id);
        }
      makeRoomAround(nodeRect(node), /* @__PURE__ */ new Set([node.id]), excluded);
    }
    function makeRoomAround(bounds, owned, excluded) {
      const units = [];
      for (const other of orderedGroups()) {
        if (excluded.has(other.id)) continue;
        const ids = groupNodeIds(other);
        if ([...ids].some((id) => owned.has(id))) continue;
        const nodes = workspaceState.project.document.nodes.filter((n) => ids.has(n.id));
        nodes.forEach((n) => owned.add(n.id));
        const b = groupBounds(other);
        units.push({
          nodes,
          rect: {
            ...b,
            w: other.collapsed ? 220 : b.w,
            h: other.collapsed ? 76 : b.h
          }
        });
      }
      for (const node of workspaceState.project.document.nodes)
        if (node.type !== 'marker' && !owned.has(node.id))
          units.push({
            nodes: [node],
            rect: nodeRect(node)
          });
      const placed = [bounds];
      for (const unit of units) {
        const y = unit.rect.y;
        for (let i = 0; i < units.length + 1; i++) {
          const hit = placed.find((b) => intersects(unit.rect, b, 30));
          if (!hit) break;
          unit.rect.y = hit.y + hit.h + 40;
        }
        for (const node of unit.nodes) node.y += unit.rect.y - y;
        placed.push(unit.rect);
      }
      canvasState.groupBoundsCache = null;
    }
    function arrangeGroupContents(mode) {
      for (const group of orderedGroups().reverse()) {
        const origin = groupBounds(group),
          units = [];
        for (const id of group.members) {
          const node = workspaceState.project.document.nodes.find((n) => n.id === id);
          if (node)
            units.push({
              id,
              members: [node],
              ...nodeRect(node)
            });
        }
        for (const child of workspaceState.project.document.groups.filter(
          (g) => g.parent_id === group.id
        )) {
          const bounds = groupBounds(child);
          units.push({
            id: 'group:' + child.id,
            members: workspaceState.project.document.nodes.filter((n) =>
              groupNodeIds(child).has(n.id)
            ),
            x: bounds.x,
            y: bounds.y,
            w: child.collapsed ? 220 : bounds.w,
            h: child.collapsed ? 76 : bounds.h
          });
        }
        if (units.length < 2) continue;
        const unitOwners = new Map(units.flatMap((u) => u.members.map((n) => [n.id, u.id]))),
          edges = workspaceState.project.document.edges.map((e) => [
            unitOwners.get(e.source),
            unitOwners.get(e.target)
          ]),
          positions = layoutPositions(units, edges, mode),
          minX = Math.min(...[...positions.values()].map((p) => p.x)),
          minY = Math.min(...[...positions.values()].map((p) => p.y));
        for (const unit of units) {
          const spot = positions.get(unit.id);
          for (const node of unit.members) {
            node.x += origin.x + 20 + spot.x - minX - unit.x;
            node.y += origin.y + 42 + spot.y - minY - unit.y;
          }
        }
        canvasState.groupBoundsCache = null;
      }
    }
    return {
      layoutPositions,
      arrangeProject,
      fitViewport,
      centerProject,
      freeNodeSpot,
      makeRoomForGroup,
      makeRoomForNode,
      makeRoomAround,
      arrangeGroupContents
    };
  }
};
var layout_default2 = layout_default;

// static/app/groups.js
var groups_default = {
  name: 'groups',
  dependencies: [
    'askText',
    'change',
    'freeNodeSpot',
    'inspect',
    'inspectGroup',
    'makeRoomForGroup',
    'nodeRect',
    'pluginText',
    'render',
    'uid'
  ],
  create({
    canvasState,
    workspaceState,
    persistenceState,
    selectionState,
    pluginsState,
    askText,
    change,
    freeNodeSpot,
    inspect,
    inspectGroup,
    makeRoomForGroup,
    nodeRect,
    pluginText,
    render,
    uid
  }) {
    function groupBounds(g) {
      if (!canvasState.groupBoundsCache) {
        const groups = workspaceState.project.document.groups,
          byId = new Map(groups.map((v) => [v.id, v])),
          children = new Map(groups.map((v) => [v.id, []])),
          nodes = new Map(workspaceState.project.document.nodes.map((n) => [n.id, n])),
          pending = /* @__PURE__ */ new Map();
        for (const group of groups)
          if (byId.has(group.parent_id)) children.get(group.parent_id).push(group);
        for (const group of groups) pending.set(group.id, children.get(group.id).length);
        const queue = groups.filter((g2) => !pending.get(g2.id)),
          bounds = /* @__PURE__ */ new Map();
        for (let i = 0; i < queue.length; i++) {
          const group = queue[i],
            rects = group.members
              .map((id) => nodes.get(id))
              .filter(Boolean)
              .map(nodeRect);
          for (const child of children.get(group.id)) {
            const b = bounds.get(child.id);
            if (b)
              rects.push({
                ...b,
                w: child.collapsed ? 220 : b.w,
                h: child.collapsed ? 76 : b.h
              });
          }
          let result = {
            x: 0,
            y: 0,
            w: 220,
            h: 100
          };
          if (rects.length) {
            const x = Math.min(...rects.map((r) => r.x)) - 20,
              y = Math.min(...rects.map((r) => r.y)) - 42;
            result = {
              x,
              y,
              w: Math.max(...rects.map((r) => r.x + r.w)) - x + 20,
              h: Math.max(...rects.map((r) => r.y + r.h)) - y + 20
            };
          }
          bounds.set(group.id, result);
          if (pending.has(group.parent_id)) {
            pending.set(group.parent_id, pending.get(group.parent_id) - 1);
            if (!pending.get(group.parent_id)) queue.push(byId.get(group.parent_id));
          }
        }
        canvasState.groupBoundsCache = bounds;
      }
      return (
        canvasState.groupBoundsCache.get(g.id) || {
          x: 0,
          y: 0,
          w: 220,
          h: 100
        }
      );
    }
    function graphGroupModel() {
      const groups = orderedGroups(),
        byId = new Map(groups.map((g) => [g.id, g])),
        paths = /* @__PURE__ */ new Map(),
        nodePaths = /* @__PURE__ */ new Map();
      function pathFor(group) {
        if (paths.has(group.id)) return paths.get(group.id);
        const path = [],
          seen = /* @__PURE__ */ new Set();
        let current = group;
        while (current && !seen.has(current.id)) {
          seen.add(current.id);
          path.unshift(current.id);
          current = byId.get(current.parent_id);
        }
        paths.set(group.id, path);
        return path;
      }
      for (const group of groups) {
        const full = pathFor(group);
        for (const id of group.members) {
          const previous = nodePaths.get(id) || [];
          if (full.length > previous.length) nodePaths.set(id, full);
        }
      }
      const visible = groups.filter(
        (group) =>
          !pathFor(group)
            .slice(0, -1)
            .some((id) => byId.get(id).collapsed)
      );
      for (const [id, full] of nodePaths) {
        const collapsed = full.findIndex((id2) => byId.get(id2).collapsed);
        if (collapsed >= 0) nodePaths.set(id, full.slice(0, collapsed + 1));
      }
      const hidden = /* @__PURE__ */ new Set();
      for (const [id, path] of nodePaths) if (byId.get(path.at(-1))?.collapsed) hidden.add(id);
      const rects = new Map(
        visible.map((group) => {
          const bounds = groupBounds(group);
          return [
            group.id,
            {
              ...bounds,
              w: group.collapsed ? 220 : bounds.w,
              h: group.collapsed ? 76 : bounds.h
            }
          ];
        })
      );
      const nodes = new Map(workspaceState.project.document.nodes.map((n) => [n.id, n]));
      function connection(edge) {
        const ap = nodePaths.get(edge.source) || [],
          bp = nodePaths.get(edge.target) || [];
        let shared = 0;
        while (shared < ap.length && shared < bp.length && ap[shared] === bp[shared]) shared++;
        const context = shared ? ap[shared - 1] : null;
        if (context && byId.get(context).collapsed) return null;
        const endpoint = (id, path) =>
          shared < path.length
            ? {
                key: 'group:' + path[shared],
                rect: rects.get(path[shared])
              }
            : {
                key: 'node:' + id,
                rect: nodes.has(id) ? nodeRect(nodes.get(id)) : null
              };
        const a = endpoint(edge.source, ap),
          b = endpoint(edge.target, bp);
        if (!a.rect || !b.rect || a.key === b.key) return null;
        return {
          context,
          a,
          b,
          key: (context || 'root') + '|' + a.key + '>' + b.key + ':' + (edge.label || '')
        };
      }
      const obstacles = /* @__PURE__ */ new Map([[null, []]]);
      for (const group of visible) if (!group.collapsed) obstacles.set(group.id, []);
      for (const group of visible) {
        const path = pathFor(group),
          parent = path.length > 1 ? path[path.length - 2] : null;
        if (obstacles.has(parent)) obstacles.get(parent).push(rects.get(group.id));
      }
      for (const node of nodes.values()) {
        if (hidden.has(node.id)) continue;
        const context = (nodePaths.get(node.id) || []).at(-1) || null;
        if (obstacles.has(context)) obstacles.get(context).push(nodeRect(node));
      }
      return {
        groups: visible,
        byId,
        nodePaths,
        hidden,
        rects,
        obstacles,
        connection
      };
    }
    function toggleGroup(group) {
      if (!workspaceState.project || workspaceState.project.archived_at) return;
      group = workspaceState.project.document.groups.find((item) => item.id === group.id);
      if (!group) return;
      group.collapsed = !group.collapsed;
      canvasState.groupBoundsCache = null;
      if (!group.collapsed) makeRoomForGroup(group);
      change();
      render();
      inspectGroup(group);
    }
    function setAllGroups(collapsed) {
      if (!workspaceState.project || workspaceState.project.archived_at) return;
      const groups = workspaceState.project.document.groups;
      if (!groups.some((g) => Boolean(g.collapsed) !== collapsed)) return;
      for (const group2 of groups) group2.collapsed = collapsed;
      canvasState.groupBoundsCache = null;
      if (!collapsed)
        for (const group2 of groups.filter((g) => !g.parent_id)) makeRoomForGroup(group2);
      change(null, 'all-groups');
      render();
      const group = groups.find((g) => g.id === selectionState.selectedGroup);
      if (group) inspectGroup(group);
      else inspect();
    }
    function moveGroup(group, dx, dy) {
      for (const node of workspaceState.project.document.nodes)
        if (group.members.includes(node.id)) {
          node.x += dx;
          node.y += dy;
        }
    }
    function groupTitle(group) {
      return group.label_key
        ? pluginText(
            pluginsState.catalog.find((p) => p.id === group.plugin),
            group.label_key
          )
        : group.label;
    }
    function groupAncestors(id) {
      const byId = new Map(workspaceState.project.document.groups.map((g) => [g.id, g])),
        ancestors = /* @__PURE__ */ new Set();
      let parent = byId.get(id)?.parent_id;
      while (parent && !ancestors.has(parent)) {
        ancestors.add(parent);
        parent = byId.get(parent)?.parent_id;
      }
      return ancestors;
    }
    function groupDescendantIds(id, doc = workspaceState.project.document) {
      const children = /* @__PURE__ */ new Map();
      for (const g of doc.groups) {
        if (!children.has(g.parent_id)) children.set(g.parent_id, []);
        children.get(g.parent_id).push(g.id);
      }
      const ids = /* @__PURE__ */ new Set(),
        stack = [id];
      while (stack.length) {
        const next = stack.pop();
        if (ids.has(next)) continue;
        ids.add(next);
        stack.push(...(children.get(next) || []));
      }
      return ids;
    }
    function groupNodeIds(group, doc = workspaceState.project.document) {
      if (!group) return /* @__PURE__ */ new Set();
      const ids = groupDescendantIds(group.id, doc),
        nodes = /* @__PURE__ */ new Set();
      for (const g of doc.groups) if (ids.has(g.id)) for (const id of g.members) nodes.add(id);
      return nodes;
    }
    function orderedGroups() {
      const groups = workspaceState.project.document.groups,
        children = /* @__PURE__ */ new Map();
      for (const g of groups) {
        if (!children.has(g.parent_id)) children.set(g.parent_id, []);
        children.get(g.parent_id).push(g);
      }
      const known = new Set(groups.map((g) => g.id)),
        stack = groups.filter((g) => !known.has(g.parent_id)).reverse(),
        result = [],
        seen = /* @__PURE__ */ new Set();
      while (stack.length) {
        const g = stack.pop();
        if (seen.has(g.id)) continue;
        seen.add(g.id);
        result.push(g);
        stack.push(...(children.get(g.id) || []).slice().reverse());
      }
      return result;
    }
    function hiddenGroupIds() {
      const hidden = /* @__PURE__ */ new Set();
      for (const g of orderedGroups()) {
        if (hidden.has(g.id)) continue;
        if (g.collapsed) {
          for (const id of groupDescendantIds(g.id)) if (id !== g.id) hidden.add(id);
        }
      }
      return hidden;
    }
    function pruneGroups(groups, nodeIds) {
      let result = groups.map((g) => ({
        ...g,
        members: g.members.filter((id) => nodeIds.has(id))
      }));
      let changed = true;
      while (changed) {
        const parents = new Set(result.map((g) => g.parent_id)),
          next = result.filter((g) => g.members.length || parents.has(g.id));
        changed = next.length !== result.length;
        result = next;
      }
      const ids = new Set(result.map((g) => g.id));
      for (const group of result) if (!ids.has(group.parent_id)) delete group.parent_id;
      return result;
    }
    async function createGroupFromSelection() {
      if (
        !selectionState.selected.size &&
        !selectionState.selectedGroup &&
        !selectionState.selectedGroups.size
      )
        throw Error(t('Bitte Knoten ausw\xE4hlen.'));
      const label = await askText(t('Gruppe erstellen'), t('Gruppenbezeichnung'), t('Neue Gruppe'));
      if (!label) return;
      const doc = workspaceState.project.document,
        groupIds = new Set(
          selectionState.selectedGroups.size
            ? selectionState.selectedGroups
            : selectionState.selectedGroup
              ? [selectionState.selectedGroup]
              : []
        );
      for (const group2 of orderedGroups()) {
        const ids = [...groupNodeIds(group2)];
        if (ids.length && ids.every((id) => selectionState.selected.has(id)))
          groupIds.add(group2.id);
      }
      for (const id of [...groupIds]) {
        if ([...groupIds].some((other) => other !== id && groupDescendantIds(other).has(id)))
          groupIds.delete(id);
      }
      const children = doc.groups.filter((g) => groupIds.has(g.id)),
        covered = /* @__PURE__ */ new Set();
      for (const child of children) for (const id of groupNodeIds(child)) covered.add(id);
      const members = [...selectionState.selected].filter((id) => !covered.has(id));
      const owners = [
          ...children.map((g) => g.parent_id || null),
          ...members.map((id) => doc.groups.find((g) => g.members.includes(id))?.id || null)
        ],
        parent = owners.length && owners.every((id) => id === owners[0]) ? owners[0] : null;
      const group = {
        id: uid(),
        label,
        members,
        collapsed: false,
        ...(parent
          ? {
              parent_id: parent
            }
          : {})
      };
      for (const child of children) child.parent_id = group.id;
      for (const old of doc.groups) old.members = old.members.filter((id) => !members.includes(id));
      doc.groups.push(group);
      doc.groups = pruneGroups(doc.groups, new Set(doc.nodes.map((n) => n.id)));
      selectionState.selected.clear();
      selectionState.selectedGroups = /* @__PURE__ */ new Set([group.id]);
      selectionState.selectedGroup = group.id;
      change();
      render();
      inspectGroup(group);
    }
    function dissolveGroup(group) {
      if (!workspaceState.project || !group) return;
      selectionState.selected = new Set(group.members);
      selectionState.selectedGroups = /* @__PURE__ */ new Set([group.id]);
      selectionState.selectedGroup = group.id;
      dissolveSelectedGroups();
    }
    function detachNodes(ids) {
      if (!workspaceState.project) return;
      const doc = workspaceState.project.document,
        wanted = new Set(ids),
        positions = /* @__PURE__ */ new Map();
      for (const id of wanted) {
        let group = doc.groups.find((g) => g.members.includes(id));
        if (!group) continue;
        const seen = /* @__PURE__ */ new Set();
        while (group.parent_id && !seen.has(group.id)) {
          seen.add(group.id);
          const parent = doc.groups.find((g) => g.id === group.parent_id);
          if (!parent) break;
          group = parent;
        }
        const bounds = groupBounds(group);
        positions.set(id, {
          x: bounds.x + (group.collapsed ? 220 : bounds.w) + 200,
          y: bounds.y
        });
      }
      for (const group of doc.groups) group.members = group.members.filter((id) => !wanted.has(id));
      doc.groups = pruneGroups(doc.groups, new Set(doc.nodes.map((n) => n.id)));
      canvasState.groupBoundsCache = null;
      for (const [id, pos] of positions) {
        const node = doc.nodes.find((n) => n.id === id);
        if (!node) continue;
        const rect = nodeRect(node),
          spot = freeNodeSpot({
            ...rect,
            x: pos.x,
            y: pos.y
          });
        node.x = spot.x;
        node.y = spot.y;
      }
      selectionState.selectedGroups.clear();
      selectionState.selectedGroup = null;
      selectionState.selected = new Set(ids);
      change();
      render();
      inspect();
    }
    function dissolveSelectedGroups() {
      if (!workspaceState.project) return;
      const ids = new Set(
        selectionState.selectedGroups.size
          ? selectionState.selectedGroups
          : selectionState.selectedGroup
            ? [selectionState.selectedGroup]
            : []
      );
      if (!ids.size) return;
      const doc = workspaceState.project.document;
      for (const group of [...orderedGroups()].reverse().filter((g) => ids.has(g.id))) {
        const parent = doc.groups.find((g) => g.id === group.parent_id);
        if (parent)
          parent.members = [.../* @__PURE__ */ new Set([...parent.members, ...group.members])];
        for (const child of doc.groups.filter((g) => g.parent_id === group.id)) {
          if (parent) child.parent_id = parent.id;
          else delete child.parent_id;
        }
        doc.groups = doc.groups.filter((g) => g.id !== group.id);
      }
      selectionState.selectedGroup = null;
      selectionState.selectedGroups.clear();
      change();
      render();
      inspect();
    }
    return {
      groupBounds,
      graphGroupModel,
      toggleGroup,
      setAllGroups,
      moveGroup,
      groupTitle,
      groupAncestors,
      groupDescendantIds,
      groupNodeIds,
      orderedGroups,
      hiddenGroupIds,
      pruneGroups,
      createGroupFromSelection,
      dissolveGroup,
      detachNodes,
      dissolveSelectedGroups
    };
  }
};
var groups_default2 = groups_default;

// static/layout-spec.json
var layout_spec_default = {
  base: {
    width: 210,
    height: 76
  },
  profile: {
    width: 280,
    height: 96
  },
  person: {
    width: 280,
    height: 76
  },
  error: {
    width: 300,
    height: 112
  },
  note: {
    width: 320,
    height: 180
  },
  location: {
    width: 300,
    height: 76,
    header: 64,
    line: 16
  },
  imagePreviewHeight: 210,
  mapHeight: 228,
  quickActionHeight: 48,
  marker: {
    width: 400,
    height: 240
  }
};

// static/app/canvas-renderer.js
var canvas_renderer_default = {
  name: 'canvas-renderer',
  dependencies: [
    '$',
    'formatLocation',
    'graphGroupModel',
    'groupNodeIds',
    'inspect',
    'locationDisplayLines',
    'nodeBadgeHeight',
    'noteInk',
    'pluginText',
    'renderEdges',
    'renderGroups',
    'renderNodes',
    'resourceActions',
    'svg',
    'updateMapOverlays'
  ],
  create({
    workspaceState,
    canvasState,
    pluginsState,
    executionState,
    selectionState,
    $,
    formatLocation,
    graphGroupModel,
    groupNodeIds,
    inspect,
    locationDisplayLines,
    nodeBadgeHeight,
    noteInk,
    pluginText,
    renderEdges,
    renderGroups,
    renderNodes,
    resourceActions,
    svg,
    updateMapOverlays
  }) {
    function render() {
      if (!workspaceState.project) return;
      canvasState.groupBoundsCache = null;
      if ($('zoomLevel')) $('zoomLevel').value = Math.round(canvasState.pan.scale * 100) + '%';
      const scene = $('scene');
      const previousPositions = new Map(
        [...scene.querySelectorAll('.node')].map((g) => [g.dataset.id, g.getAttribute('transform')])
      );
      scene.replaceChildren();
      $('grid').setAttribute(
        'patternTransform',
        `translate(${canvasState.pan.x} ${canvasState.pan.y}) scale(${canvasState.pan.scale})`
      );
      scene.setAttribute(
        'transform',
        `translate(${canvasState.pan.x} ${canvasState.pan.y}) scale(${canvasState.pan.scale})`
      );
      const doc = workspaceState.project.document,
        hidden = /* @__PURE__ */ new Map(),
        groupModel = graphGroupModel(),
        groupViews = /* @__PURE__ */ new Map(),
        groupEdges = /* @__PURE__ */ new Map(),
        labelsByContext = /* @__PURE__ */ new Map(),
        externalEdges = svg('g', {
          class: 'external-edges'
        }),
        labelOverlay = svg('g', {
          class: 'edge-label-overlay'
        });
      scene.append(externalEdges, labelOverlay);
      for (const id of groupModel.hidden) hidden.set(id, true);
      renderGroups({ scene, groupModel, groupViews, groupEdges });
      renderEdges({
        doc,
        hidden,
        groupModel,
        groupEdges,
        externalEdges,
        labelOverlay,
        labelsByContext
      });
      renderNodes({ doc, hidden, groupModel, groupViews, scene, previousPositions });
      for (const view of groupViews.values())
        for (const control of [...view.children].filter(
          (n) => n.classList.contains('group-toggle') || n.classList.contains('group-title')
        ))
          view.append(control);
      scene.append(labelOverlay);
      applyGraphHighlights(groupModel);
      updateMapOverlays(hidden);
    }
    function nodeRect(node) {
      const size = layout_spec_default[node.type] || layout_spec_default.base;
      let w = size.width,
        h = size.height;
      if (['note', 'marker'].includes(node.type)) {
        w = node.appearance?.width || w;
        h = node.appearance?.height || h;
      }
      if (node.type === 'image' && node.display?.preview)
        h = layout_spec_default.imagePreviewHeight;
      if (node.type === 'location') {
        h = Math.max(
          size.height,
          size.header + locationDisplayLines(node.data || {}, w).length * size.line
        );
        if (
          node.display?.map &&
          (formatLocation(node.data || {}) ||
            node.data.formatted_address ||
            node.data.original_input ||
            (node.data.latitude !== null &&
              node.data.latitude !== '' &&
              node.data.latitude !== void 0 &&
              node.data.longitude !== null &&
              node.data.longitude !== '' &&
              node.data.longitude !== void 0))
        )
          h += layout_spec_default.mapHeight;
      }
      h += nodeBadgeHeight(node, w);
      h +=
        layout_spec_default.quickActionHeight *
        resourceActions(node).filter((a) => node.display?.[a.key]).length;
      return {
        x: node.x,
        y: node.y,
        w,
        h,
        inputCount:
          node.type === 'actor'
            ? Math.max(
                1,
                pluginsState.catalog
                  .find((p) => p.id === node.data.plugin)
                  ?.actions.find((a) => a.id === node.data.action)?.min_inputs || 1
              )
            : 1
      };
    }
    function nodeIcon(g, node) {
      const n = icon(node.type === 'actor' ? actorIcon(node.data.plugin) : dataIcon(node.type));
      n.setAttribute('x', 11);
      n.setAttribute('y', node.type === 'note' ? 12 : 10);
      n.setAttribute('width', 16);
      n.setAttribute('height', 16);
      n.style.color =
        node.type === 'note'
          ? noteInk(node.appearance?.color || '#ffcc70')
          : node.type === 'actor'
            ? 'var(--actor-accent)'
            : '#ff9d45';
      g.append(n);
      if (node.type === 'note') g.querySelector('text').setAttribute('x', 34);
    }
    function dataIcon(type) {
      if (pluginsState.dataTypes.get(type)?.node.icon)
        return pluginsState.dataTypes.get(type).node.icon;
      return (
        {
          email: 'email',
          phone: 'phone',
          username: 'account',
          url: 'link',
          location: 'map',
          note: 'note',
          image: 'image',
          file: 'file',
          datetime: 'calendar',
          value: 'value'
        }[type] || 'nodes'
      );
    }
    function actorIcon(plugin) {
      return (
        pluginsState.catalog.find((p) => p.id === plugin)?.icon ||
        {
          email: 'email-search',
          phone: 'phone-search',
          username: 'account-search',
          holehe: 'email-search',
          phoneinfoga: 'phone-search',
          profiles: 'account-search',
          maigret: 'account-search',
          location: 'map-search',
          metadata: 'file',
          transform: 'code'
        }[plugin] ||
        'plugin'
      );
    }
    function summary(n) {
      if (n.type === 'actor')
        return executionState.activeActors.has(n.id)
          ? t('L\xE4uft \u2026')
          : executionState.actorQueue.some((job) => job.id === n.id)
            ? t('In Warteschlange')
            : t(n.data.status) || t('bereit');
      if (n.type === 'person')
        return [
          n.data.birth_date,
          n.data.birth_place,
          n.data.birth_country
            ? /^[A-Z]{2}$/.test(n.data.birth_country)
              ? new Intl.DisplayNames([language], {
                  type: 'region'
                }).of(n.data.birth_country)
              : n.data.birth_country
            : ''
        ]
          .filter(Boolean)
          .join(' \xB7 ');
      if (n.type === 'error') return n.data.message || '';
      if (n.type === 'profile')
        return [n.data.identifier, n.data.url].filter(Boolean).join(' \xB7 ');
      if (n.type === 'datetime')
        return [n.data.date, n.data.time, n.data.timezone].filter(Boolean).join(' \xB7 ');
      if (n.type === 'location')
        return formatLocation(n.data) || n.data.formatted_address || t('Standortangabe');
      return (
        (n.type === 'value' && n.evidence?.run_id
          ? pluginText(
              pluginsState.catalog.find((p) => p.id === n.evidence.plugin),
              n.data.value
            )
          : n.data.value) ??
        n.data.text ??
        n.data.filename ??
        Object.keys(n.data).join(', ')
      );
    }
    function short(s, n = 27) {
      return String(s).length > n ? String(s).slice(0, n - 1) + '\u2026' : String(s);
    }
    function measureEdgeText(text) {
      if (!measureEdgeText.context) {
        const canvas = document.createElement('canvas');
        measureEdgeText.context = canvas.getContext('2d');
      }
      const context = measureEdgeText.context;
      if (!context) return text.length * 7;
      context.font = '11px ' + getComputedStyle(document.body).fontFamily;
      return context.measureText(text).width;
    }
    function fitNodeText(value, width, size = 13, spacing = 0) {
      const text = String(value);
      const measure = (label) =>
        (measureEdgeText(label) * size) / 11 + Math.max(0, label.length - 1) * spacing;
      if (measure(text) <= width) return text;
      let out = '';
      for (const char of text) {
        if (measure(out + char + '\u2026') > width) break;
        out += char;
      }
      return out + '\u2026';
    }
    function edgeBundleIds(id) {
      if (!workspaceState.project) return [id];
      const model = graphGroupModel(),
        edge = workspaceState.project.document.edges.find((e) => e.id === id),
        visual = edge && model.connection(edge);
      if (!visual) return edge ? [id] : [];
      return workspaceState.project.document.edges
        .filter((e) => model.connection(e)?.key === visual.key)
        .map((e) => e.id);
    }
    function selectEdge(id, add = false) {
      const ids = edgeBundleIds(id),
        remove = add && ids.every((id2) => selectionState.selectedEdges.has(id2));
      if (!add) selectionState.selectedEdges.clear();
      for (const edge of ids)
        if (remove) selectionState.selectedEdges.delete(edge);
        else selectionState.selectedEdges.add(edge);
      selectionState.selected.clear();
      selectionState.selectedGroup = null;
      selectionState.selectedGroups.clear();
      render();
      inspect();
    }
    function applyGraphHighlights(providedModel = null) {
      if (!workspaceState.project) return;
      const connected = /* @__PURE__ */ new Set(),
        model = providedModel || graphGroupModel(),
        bundles = /* @__PURE__ */ new Map(),
        byId = new Map(workspaceState.project.document.edges.map((e) => [e.id, e]));
      for (const edge of workspaceState.project.document.edges) {
        const visual = model.connection(edge);
        if (!visual) continue;
        if (!bundles.has(visual.key)) bundles.set(visual.key, []);
        bundles.get(visual.key).push(edge);
        if (selectionState.selectedEdges.has(edge.id)) {
          connected.add(edge.source);
          connected.add(edge.target);
        }
      }
      for (const path of $('scene').querySelectorAll('[data-edge-path]')) {
        const edge = byId.get(path.dataset.edgePath),
          visual = edge && model.connection(edge),
          bundle = visual ? bundles.get(visual.key) || [] : [];
        path.classList.toggle(
          'highlighted',
          bundle.some(
            (e) =>
              selectionState.selected.has(e.source) ||
              selectionState.selected.has(e.target) ||
              selectionState.selectedEdges.has(e.id)
          )
        );
        path.classList.toggle(
          'selected-edge',
          bundle.some((e) => selectionState.selectedEdges.has(e.id))
        );
        if (path.dataset.hasArrow === 'true')
          path.style.markerEnd =
            'url(#' + (path.classList.contains('highlighted') ? 'arrow-highlight' : 'arrow') + ')';
      }
      for (const label of $('scene').querySelectorAll('[data-edge-label]'))
        label.classList.toggle(
          'edge-selected',
          selectionState.selectedEdges.has(label.dataset.edgeLabel)
        );
      for (const node of $('scene').querySelectorAll('.node'))
        node.classList.toggle('edge-connected', connected.has(node.dataset.id));
      for (const group of $('scene').querySelectorAll('.group')) {
        const item = workspaceState.project.document.groups.find(
          (g) => g.id === group.dataset.group
        );
        group.classList.toggle(
          'edge-connected',
          Boolean(connected.size && item && [...groupNodeIds(item)].some((id) => connected.has(id)))
        );
      }
    }
    return {
      render,
      nodeRect,
      nodeIcon,
      dataIcon,
      actorIcon,
      summary,
      short,
      measureEdgeText,
      fitNodeText,
      edgeBundleIds,
      selectEdge,
      applyGraphHighlights
    };
  }
};
var canvas_renderer_default2 = canvas_renderer_default;

// static/graph-routing.js
var ArgusRouting = (() => {
  function automaticBoundary(rect, toward) {
    const center = {
      x: rect.x + rect.w / 2,
      y: rect.y + rect.h / 2
    };
    let dx = toward.x - center.x,
      dy = toward.y - center.y;
    if (!dx && !dy) dx = 1;
    const factor = Math.min(
      dx ? rect.w / 2 / Math.abs(dx) : Infinity,
      dy ? rect.h / 2 / Math.abs(dy) : Infinity
    );
    let x = center.x + dx * factor,
      y = center.y + dy * factor;
    const horizontal = Math.abs(x - center.x) >= rect.w / 2 - 0.01;
    const inset = Math.min(12, rect.w / 4, rect.h / 4);
    if (horizontal) y = Math.max(rect.y + inset, Math.min(rect.y + rect.h - inset, y));
    else x = Math.max(rect.x + inset, Math.min(rect.x + rect.w - inset, x));
    return {
      x,
      y,
      nx: horizontal ? Math.sign(dx) : 0,
      ny: horizontal ? 0 : Math.sign(dy)
    };
  }
  function connectionGeometry(a, b, sourcePort = null, targetPort = null) {
    const from = portPosition(a, sourcePort?.startsWith('right') ? sourcePort : 'right'),
      to = portPosition(b, targetPort?.startsWith('left') ? targetPort : 'left'),
      distance = Math.min(180, Math.max(35, Math.hypot(to.x - from.x, to.y - from.y) * 0.42));
    const c1x = from.x + from.nx * distance,
      c1y = from.y + from.ny * distance,
      c2x = to.x + to.nx * distance,
      c2y = to.y + to.ny * distance;
    return {
      sx: from.x,
      sy: from.y,
      tx: to.x,
      ty: to.y,
      c1x,
      c1y,
      c2x,
      c2y,
      labelX: (from.x + 3 * c1x + 3 * c2x + to.x) / 8,
      labelY: (from.y + 3 * c1y + 3 * c2y + to.y) / 8
    };
  }
  function intersects(a, b, padding = 0) {
    return (
      a.x < b.x + b.w + padding &&
      a.x + a.w > b.x - padding &&
      a.y < b.y + b.h + padding &&
      a.y + a.h > b.y - padding
    );
  }
  function cubicPoint(points, t2) {
    const u = 1 - t2;
    return {
      x:
        u * u * u * points[0].x +
        3 * u * u * t2 * points[1].x +
        3 * u * t2 * t2 * points[2].x +
        t2 * t2 * t2 * points[3].x,
      y:
        u * u * u * points[0].y +
        3 * u * u * t2 * points[1].y +
        3 * u * t2 * t2 * points[2].y +
        t2 * t2 * t2 * points[3].y
    };
  }
  function splitCubic(points, t2) {
    const lerp = (a2, b2) => ({
        x: a2.x + (b2.x - a2.x) * t2,
        y: a2.y + (b2.y - a2.y) * t2
      }),
      a = lerp(points[0], points[1]),
      b = lerp(points[1], points[2]),
      c = lerp(points[2], points[3]),
      d = lerp(a, b),
      e = lerp(b, c),
      f = lerp(d, e);
    return [
      [points[0], a, d, f],
      [f, e, c, points[3]]
    ];
  }
  function cubicSlice(points, start, end) {
    const left = splitCubic(points, end)[0];
    return start ? splitCubic(left, start / end)[1] : left;
  }
  function curvePath(segments) {
    if (!segments.length) return '';
    let path = `M ${segments[0][0].x} ${segments[0][0].y}`;
    for (const segment of segments)
      path += ` C ${segment[1].x} ${segment[1].y}, ${segment[2].x} ${segment[2].y}, ${segment[3].x} ${segment[3].y}`;
    return path;
  }
  function curveLabelGap(segments, width, height = 28, labelPoint = null) {
    const table = [
        {
          length: 0,
          segment: 0,
          t: 0
        }
      ],
      starts = [];
    let length = 0,
      anchor = 0;
    for (const [index, segment] of segments.entries()) {
      starts.push(length);
      let previous = segment[0];
      for (let step = 1; step <= 64; step++) {
        const t2 = step / 64,
          p = cubicPoint(segment, t2);
        length += Math.hypot(p.x - previous.x, p.y - previous.y);
        table.push({
          length,
          segment: index,
          t: t2
        });
        previous = p;
        if (segments.length === 1 && step === 32) anchor = length;
      }
      if (segments.length === 2 && index === 0) anchor = length;
    }
    if (labelPoint) {
      let nearest = Infinity;
      for (const entry of table) {
        const p = cubicPoint(segments[entry.segment], entry.t),
          distance = Math.hypot(p.x - labelPoint.x, p.y - labelPoint.y);
        if (distance < nearest) {
          nearest = distance;
          anchor = entry.length;
        }
      }
    }
    const anchorPoint =
        labelPoint || (segments.length === 2 ? segments[0][3] : cubicPoint(segments[0], 0.5)),
      inside = (p) =>
        Math.abs(p.x - anchorPoint.x) <= width / 2 && Math.abs(p.y - anchorPoint.y) <= height / 2;
    let leftExtent = 0,
      rightExtent = 0;
    for (const entry of [...table].reverse()) {
      if (entry.length > anchor) continue;
      leftExtent = anchor - entry.length;
      if (!inside(cubicPoint(segments[entry.segment], entry.t))) break;
    }
    for (const entry of table) {
      if (entry.length < anchor) continue;
      rightExtent = entry.length - anchor;
      if (!inside(cubicPoint(segments[entry.segment], entry.t))) break;
    }
    const half = Math.max(
        0,
        Math.min(Math.max(leftExtent, rightExtent) + 2, anchor - 10, length - anchor - 10)
      ),
      left = anchor - half,
      right = anchor + half;
    const parameter = (distance) => {
      const index = table.findIndex((p) => p.length >= distance);
      if (index <= 0)
        return {
          segment: 0,
          t: 0
        };
      const a = table[index - 1],
        b = table[index],
        start = a.segment === b.segment ? a.t : 0,
        portion = (distance - a.length) / (b.length - a.length || 1);
      return {
        segment: b.segment,
        t: start + (b.t - start) * portion
      };
    };
    function between(begin, end) {
      if (end <= begin) return [];
      const a = parameter(begin),
        b = parameter(end),
        out = [];
      for (let index = a.segment; index <= b.segment; index++) {
        const from = index === a.segment ? a.t : 0,
          to = index === b.segment ? b.t : 1;
        if (to > from) out.push(cubicSlice(segments[index], from, to));
      }
      return out;
    }
    return {
      before: curvePath(between(0, left)),
      after: curvePath(between(right, length)),
      anchor,
      half,
      total: length
    };
  }
  function roundedRoute(points, radius = 16) {
    const clean = points.filter((p, i) => !i || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
    const segments = [];
    const line = (a, b) => {
      if (a.x !== b.x || a.y !== b.y) segments.push([a, a, b, b]);
    };
    let previous = clean[0];
    for (let i = 1; i < clean.length - 1; i++) {
      const a = clean[i - 1],
        b = clean[i],
        c = clean[i + 1];
      const before = Math.hypot(b.x - a.x, b.y - a.y),
        after = Math.hypot(c.x - b.x, c.y - b.y);
      const r = Math.min(radius, before / 2, after / 2);
      const entry = { x: b.x + ((a.x - b.x) * r) / before, y: b.y + ((a.y - b.y) * r) / before };
      const exit = { x: b.x + ((c.x - b.x) * r) / after, y: b.y + ((c.y - b.y) * r) / after };
      line(previous, entry);
      segments.push([
        entry,
        { x: entry.x + ((b.x - entry.x) * 2) / 3, y: entry.y + ((b.y - entry.y) * 2) / 3 },
        { x: exit.x + ((b.x - exit.x) * 2) / 3, y: exit.y + ((b.y - exit.y) * 2) / 3 },
        exit
      ]);
      previous = exit;
    }
    line(previous, clean.at(-1));
    return segments;
  }
  function routeConnection(a, b, label, obstacles, labels, edge = {}, measuredWidth = null) {
    const from = portPosition(a, edge.source_port || 'right'),
      to = portPosition(b, edge.target_port || 'left'),
      width = Math.max(0, measuredWidth ?? label.length * 7) + 66,
      height = 28,
      backwards = to.x - from.x < 80,
      middle = (from.x + to.x) / 2;
    const base = {
      x: middle,
      y: backwards ? Math.max(a.y + a.h, b.y + b.h) + 80 : (from.y + to.y) / 2
    };
    const clear = (p) => {
      const box = { x: p.x - width / 2, y: p.y - height / 2, w: width, h: height };
      return (
        !obstacles.some((r) => intersects(box, r, 8)) && !labels.some((r) => intersects(box, r, 8))
      );
    };
    let point = base;
    if (!clear(point)) {
      let found = false;
      for (let radius = 32; radius <= 640 && !found; radius += 32) {
        for (const dy of [-1, 1]) {
          const candidate = { x: base.x, y: base.y + dy * radius };
          if (clear(candidate)) {
            point = candidate;
            found = true;
            break;
          }
        }
      }
      if (!found)
        point = {
          x: base.x,
          y:
            Math.min(a.y, b.y, ...obstacles.map((r) => r.y), ...labels.map((r) => r.y)) -
            height -
            32
        };
    }
    let points;
    if (!backwards && point === base) {
      points = [from, { x: middle, y: from.y }, { x: middle, y: to.y }, to];
    } else {
      const lead = from.x + 40,
        tail = to.x - 40;
      points = [
        from,
        { x: lead, y: from.y },
        { x: lead, y: point.y },
        point,
        { x: tail, y: point.y },
        { x: tail, y: to.y },
        to
      ];
    }
    const segments = roundedRoute(points);
    labels.push({ x: point.x - width / 2, y: point.y - height / 2, w: width, h: height });
    const gap = curveLabelGap(
      segments,
      Math.max(0, measuredWidth ?? label.length * 7) + 16,
      height,
      point
    );
    return {
      path: curvePath(segments),
      labelX: point.x,
      labelY: point.y,
      visiblePaths: [
        { path: gap.before, arrow: false },
        { path: gap.after, arrow: true }
      ],
      gap
    };
  }
  function portPosition(rect, side) {
    const points = {
      left: {
        x: rect.x,
        y: rect.y + rect.h / 2,
        nx: -1,
        ny: 0
      },
      right: {
        x: rect.x + rect.w,
        y: rect.y + rect.h / 2,
        nx: 1,
        ny: 0
      },
      top: {
        x: rect.x + rect.w / 2,
        y: rect.y,
        nx: 0,
        ny: -1
      },
      bottom: {
        x: rect.x + rect.w / 2,
        y: rect.y + rect.h,
        nx: 0,
        ny: 1
      }
    };
    const [name, index, count] = String(side || 'right').split(':');
    const position = points[name] || points.right;
    if (count && (name === 'left' || name === 'right'))
      position.y = rect.y + (rect.h * (Number(index) + 1)) / (Number(count) + 1);
    return position;
  }
  return Object.freeze({
    automaticBoundary,
    connectionGeometry,
    intersects,
    cubicPoint,
    splitCubic,
    cubicSlice,
    curvePath,
    curveLabelGap,
    routeConnection,
    portPosition,
    roundedRoute
  });
})();
var graph_routing_default = ArgusRouting;

// static/app/canvas-input.js
var canvas_input_default = {
  name: 'canvas-input',
  dependencies: [
    '$',
    'change',
    'groupBounds',
    'groupNodeIds',
    'inspect',
    'inspectGroup',
    'nodeRect',
    'portPosition',
    'render',
    'svg',
    'uid'
  ],
  create({
    selectionState,
    persistenceState,
    canvasState,
    workspaceState,
    $,
    change,
    groupBounds,
    groupNodeIds,
    inspect,
    inspectGroup,
    nodeRect,
    portPosition,
    render,
    svg,
    uid
  }) {
    function startGroupDrag(group, event) {
      selectionState.selectedEdges.clear();
      if (
        persistenceState.busy ||
        event.button > 0 ||
        canvasState.spacePressed ||
        event.target.closest('.group-toggle')
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        selectionState.selectedGroups.has(group.id)
          ? selectionState.selectedGroups.delete(group.id)
          : selectionState.selectedGroups.add(group.id);
        if (!selectionState.selectedGroups.has(group.id)) {
          if (selectionState.selectedGroups.size)
            inspectGroup(
              workspaceState.project.document.groups.find(
                (g) => g.id === [...selectionState.selectedGroups][0]
              )
            );
          else {
            selectionState.selectedGroup = null;
            inspect();
          }
          return;
        }
      } else if (!selectionState.selectedGroups.has(group.id)) {
        selectionState.selectedGroups = /* @__PURE__ */ new Set([group.id]);
        selectionState.selected.clear();
      }
      const dragIds = new Set(selectionState.selected);
      for (const id of selectionState.selectedGroups)
        for (const node of groupNodeIds(
          workspaceState.project.document.groups.find((g) => g.id === id)
        ))
          dragIds.add(node);
      canvasState.drag = {
        kind: 'group',
        groupId: group.id,
        startX: event.clientX,
        startY: event.clientY,
        positions: workspaceState.project.document.nodes
          .filter((n) => dragIds.has(n.id))
          .map((n) => ({
            id: n.id,
            x: n.x,
            y: n.y
          })),
        moved: false
      };
      $('graph').setPointerCapture(event.pointerId);
      inspectGroup(group);
    }
    function updateDrag(event) {
      if (canvasState.connecting) {
        updateConnection(event);
        return;
      }
      if (!canvasState.drag || canvasState.pinchGesture || canvasState.gestureBlocked) return;
      const dx = event.clientX - canvasState.drag.startX,
        dy = event.clientY - canvasState.drag.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) canvasState.drag.moved = true;
      if (!canvasState.drag.moved) return;
      if (canvasState.drag.kind === 'note-resize') {
        const node = workspaceState.project.document.nodes.find(
          (n) => n.id === canvasState.drag.id
        );
        if (node) {
          node.appearance = {
            ...node.appearance,
            width: Math.max(
              200,
              Math.min(900, canvasState.drag.width + dx / canvasState.pan.scale)
            ),
            height: Math.max(
              120,
              Math.min(800, canvasState.drag.height + dy / canvasState.pan.scale)
            )
          };
          change(node.id, 'resize:' + canvasState.drag.id);
          render();
        }
        return;
      }
      if (canvasState.drag.kind === 'box') {
        drawSelectionFrame(canvasState.drag, event);
        return;
      }
      if (canvasState.drag.kind === 'pan') {
        canvasState.pan.x = canvasState.drag.x + dx;
        canvasState.pan.y = canvasState.drag.y + dy;
      } else {
        for (const pos of canvasState.drag.positions) {
          const node = workspaceState.project.document.nodes.find((n) => n.id === pos.id);
          if (node) {
            node.x = pos.x + dx / canvasState.pan.scale;
            node.y = pos.y + dy / canvasState.pan.scale;
          }
        }
        change(null, 'drag:' + canvasState.drag.startX + ':' + canvasState.drag.startY);
      }
      render();
    }
    function zoomAt(x, y, scale) {
      const next = Math.max(0.15, Math.min(2.5, scale));
      canvasState.pan.x = x - ((x - canvasState.pan.x) * next) / canvasState.pan.scale;
      canvasState.pan.y = y - ((y - canvasState.pan.y) * next) / canvasState.pan.scale;
      canvasState.pan.scale = next;
      render();
    }
    function zoomStep(direction) {
      const box = $('graph').getBoundingClientRect();
      zoomAt(
        box.width / 2,
        box.height / 2,
        nextZoomPercent(canvasState.pan.scale * 100, direction) / 100
      );
    }
    function nextZoomPercent(percent, direction) {
      return Math.max(
        15,
        Math.min(
          250,
          direction > 0
            ? (Math.floor((percent + 1e-7) / 5) + 1) * 5
            : (Math.ceil((percent - 1e-7) / 5) - 1) * 5
        )
      );
    }
    function frameRect(start, event) {
      const box = $('graph').getBoundingClientRect();
      const x1 = start.startX - box.left,
        y1 = start.startY - box.top,
        x2 = event.clientX - box.left,
        y2 = event.clientY - box.top;
      return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        w: Math.abs(x2 - x1),
        h: Math.abs(y2 - y1)
      };
    }
    function removeSelectionFrame() {
      $('selectionFrame')?.remove();
    }
    function drawSelectionFrame(start, event) {
      let frame = $('selectionFrame');
      if (!frame) {
        frame = svg('rect', {
          id: 'selectionFrame',
          class: 'selection-frame'
        });
        $('graph').append(frame);
      }
      const bounds = frameRect(start, event);
      for (const [key, value] of Object.entries({
        x: bounds.x,
        y: bounds.y,
        width: bounds.w,
        height: bounds.h
      }))
        frame.setAttribute(key, value);
    }
    function boxSelection(doc, rect, base) {
      const result = new Set(base),
        hidden = /* @__PURE__ */ new Set();
      function overlaps(b) {
        return (
          b.x + b.w >= rect.x &&
          b.x <= rect.x + rect.w &&
          b.y + b.h >= rect.y &&
          b.y <= rect.y + rect.h
        );
      }
      for (const group of doc.groups)
        if (group.collapsed) {
          const b = groupBounds(group);
          for (const id of groupNodeIds(group, doc)) hidden.add(id);
          if (
            overlaps({
              x: b.x,
              y: b.y,
              w: 220,
              h: 76
            })
          )
            for (const id of groupNodeIds(group, doc)) result.add(id);
        }
      for (const node of doc.nodes)
        if (
          !hidden.has(node.id) &&
          overlaps({
            x: node.x,
            y: node.y,
            ...nodeRect(node)
          })
        )
          result.add(node.id);
      return result;
    }
    function canvasPointerDown(event) {
      if (
        !workspaceState.project ||
        persistenceState.busy ||
        canvasState.pinchGesture ||
        canvasState.gestureBlocked ||
        event.target.closest('.edge-edit,.edge-delete,.edge-hit,.group-toggle')
      )
        return;
      const panning =
        event.button === 1 ||
        event.button === 2 ||
        canvasState.spacePressed ||
        (event.pointerType === 'touch' && !canvasState.touchSelection);
      if (!panning && event.target.closest('.node,.group')) return;
      selectionState.selectedEdges.clear();
      event.preventDefault();
      canvasState.drag = {
        kind: panning ? 'pan' : 'box',
        startX: event.clientX,
        startY: event.clientY,
        x: canvasState.pan.x,
        y: canvasState.pan.y,
        moved: false,
        base: new Set(event.shiftKey || canvasState.touchSelection ? selectionState.selected : [])
      };
      $('graph').setPointerCapture(event.pointerId);
    }
    function canvasPointerUp(event) {
      if (canvasState.connecting) {
        finishConnection(event);
        return;
      }
      if (canvasState.drag?.kind === 'box') {
        if (canvasState.drag.moved) {
          const b = frameRect(canvasState.drag, event);
          selectionState.selected = boxSelection(
            workspaceState.project.document,
            {
              x: (b.x - canvasState.pan.x) / canvasState.pan.scale,
              y: (b.y - canvasState.pan.y) / canvasState.pan.scale,
              w: b.w / canvasState.pan.scale,
              h: b.h / canvasState.pan.scale
            },
            canvasState.drag.base
          );
        } else if (!event.shiftKey) selectionState.selected.clear();
        removeSelectionFrame();
        render();
        inspect();
      } else if (canvasState.drag?.kind === 'pan' && !canvasState.drag.moved) {
        selectionState.selected.clear();
        render();
        inspect();
      }
      canvasState.drag = null;
      if ($('graph').hasPointerCapture(event.pointerId))
        $('graph').releasePointerCapture(event.pointerId);
    }
    function touchMetrics() {
      const [a, b] = [...canvasState.touchPointers.values()];
      return {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
      };
    }
    function touchGestureEvent(event) {
      if (event.pointerType !== 'touch') return;
      if (event.type === 'pointerup' || event.type === 'pointercancel') {
        const wasGesture = Boolean(canvasState.pinchGesture) || canvasState.gestureBlocked;
        canvasState.touchPointers.delete(event.pointerId);
        if (wasGesture) {
          event.stopImmediatePropagation();
          canvasState.drag = null;
          canvasState.pinchGesture = null;
          canvasState.gestureBlocked = canvasState.touchPointers.size > 0;
          removeSelectionFrame();
        }
        return;
      }
      canvasState.touchPointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY
      });
      if (event.type === 'pointerdown') {
        if (canvasState.touchPointers.size >= 2) {
          const metrics = touchMetrics(),
            box = $('graph').getBoundingClientRect();
          canvasState.pinchGesture = {
            ...metrics,
            scale: canvasState.pan.scale,
            worldX: (metrics.x - box.left - canvasState.pan.x) / canvasState.pan.scale,
            worldY: (metrics.y - box.top - canvasState.pan.y) / canvasState.pan.scale
          };
          canvasState.gestureBlocked = false;
          cancelConnection();
          canvasState.drag = null;
          removeSelectionFrame();
          $('graph').setPointerCapture(event.pointerId);
          event.stopImmediatePropagation();
          event.preventDefault();
        }
        return;
      }
      if (canvasState.pinchGesture && canvasState.touchPointers.size >= 2) {
        const metrics = touchMetrics(),
          box = $('graph').getBoundingClientRect();
        canvasState.pan.scale = Math.max(
          0.15,
          Math.min(
            2.5,
            (canvasState.pinchGesture.scale * metrics.distance) / canvasState.pinchGesture.distance
          )
        );
        canvasState.pan.x =
          metrics.x - box.left - canvasState.pinchGesture.worldX * canvasState.pan.scale;
        canvasState.pan.y =
          metrics.y - box.top - canvasState.pinchGesture.worldY * canvasState.pan.scale;
        render();
        event.stopImmediatePropagation();
        event.preventDefault();
      } else if (canvasState.gestureBlocked) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    }
    function nodePorts(g, node, bounds) {
      const count = Math.min(32, bounds.inputCount || 1);
      for (const side of [
        ...Array.from({ length: count }, (_, i) => `left:${i}:${count}`),
        'right'
      ]) {
        const pos = portPosition(
            {
              x: 0,
              y: 0,
              w: bounds.w,
              h: bounds.h
            },
            side
          ),
          dock = svg('g', {
            class: 'dock',
            'data-port': side,
            role: 'button',
            tabindex: 0,
            'aria-label':
              t(side.startsWith('left') ? 'Eingang' : 'Ausgang') +
              (side.startsWith('left') ? ' ' + (Number(side.split(':')[1]) + 1) : '')
          });
        dock.append(
          svg('circle', {
            class: 'dock-hit',
            cx: pos.x,
            cy: pos.y,
            r: 13
          }),
          svg('circle', {
            cx: pos.x,
            cy: pos.y,
            r: 5
          })
        );
        dock.addEventListener('pointerdown', (e) => {
          if (e.button > 0) return;
          e.preventDefault();
          e.stopPropagation();
          canvasState.connecting = {
            source: node.id,
            port: side,
            pointer: e.pointerId,
            target: null,
            targetPort: null
          };
          canvasState.drag = null;
          $('graph').setPointerCapture(e.pointerId);
          g.classList.add('connection-source');
          updateConnection(e);
        });
        dock.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') cancelConnection();
        });
        g.append(dock);
      }
    }
    function nearestConnectionTarget(point, source, nodes, visibleIds, scale) {
      let best = null,
        distance = Infinity;
      for (const node of nodes) {
        if (node.id === source || node.type === 'marker' || !visibleIds.has(node.id)) continue;
        const bounds = nodeRect(node),
          dx = Math.max(bounds.x - point.x, 0, point.x - bounds.x - bounds.w),
          dy = Math.max(bounds.y - point.y, 0, point.y - bounds.y - bounds.h);
        if (Math.hypot(dx, dy) > 30 / scale) continue;
        const count = Math.min(32, bounds.inputCount || 1);
        const sides = canvasState.connecting?.port.startsWith('left')
          ? ['right']
          : Array.from({ length: count }, (_, i) => `left:${i}:${count}`);
        for (const side of sides) {
          const port = portPosition(bounds, side),
            d = Math.hypot(point.x - port.x, point.y - port.y);
          if (d < distance) {
            best = {
              node: node.id,
              side,
              port
            };
            distance = d;
          }
        }
      }
      return best;
    }
    function updateConnection(event) {
      if (!canvasState.connecting || !workspaceState.project) return;
      const box = $('graph').getBoundingClientRect(),
        point = {
          x: (event.clientX - box.left - canvasState.pan.x) / canvasState.pan.scale,
          y: (event.clientY - box.top - canvasState.pan.y) / canvasState.pan.scale
        },
        nodes = workspaceState.project.document.nodes,
        visible = new Set([...$('scene').querySelectorAll('.node')].map((g) => g.dataset.id)),
        target = nearestConnectionTarget(
          point,
          canvasState.connecting.source,
          nodes,
          visible,
          canvasState.pan.scale
        );
      canvasState.connecting.target = target?.node || null;
      canvasState.connecting.targetPort = target?.side || null;
      for (const g of $('scene').querySelectorAll('.connection-near'))
        g.classList.remove('connection-near');
      const targetElement = [...$('scene').querySelectorAll('.node')].find(
        (g) => g.dataset.id === target?.node
      );
      targetElement?.classList.add('connection-near');
      const source = nodes.find((n) => n.id === canvasState.connecting.source);
      if (!source) {
        cancelConnection();
        return;
      }
      const from = portPosition(nodeRect(source), canvasState.connecting.port),
        to = target?.port || {
          ...point,
          nx: -from.nx,
          ny: -from.ny
        },
        middle = (from.x + to.x) / 2;
      let path = $('connectionPreview');
      if (!path) {
        path = svg('path', {
          id: 'connectionPreview',
          class: 'edge connection-preview'
        });
        $('scene').append(path);
      }
      const start = from.nx < 0 ? to : from,
        end = from.nx < 0 ? from : to;
      const points =
        end.x - start.x >= 80
          ? [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end]
          : [
              start,
              { x: start.x + 40, y: start.y },
              { x: start.x + 40, y: Math.max(start.y, end.y) + 130 },
              { x: end.x - 40, y: Math.max(start.y, end.y) + 130 },
              { x: end.x - 40, y: end.y },
              end
            ];
      path.setAttribute(
        'd',
        graph_routing_default.curvePath(graph_routing_default.roundedRoute(points))
      );
    }
    function finishConnection(event) {
      updateConnection(event);
      const state = canvasState.connecting;
      cancelConnection();
      if ($('graph').hasPointerCapture(event.pointerId))
        $('graph').releasePointerCapture(event.pointerId);
      if (!state?.target) return;
      const doc = workspaceState.project.document;
      const source = state.port.startsWith('left') ? state.target : state.source;
      const target = state.port.startsWith('left') ? state.source : state.target;
      if (doc.edges.some((e) => e.source === source && e.target === target)) return;
      doc.edges.push({
        id: uid(),
        source,
        target,
        source_port: 'right',
        target_port: state.port.startsWith('left') ? state.port : state.targetPort,
        label: t('verbunden mit')
      });
      change();
      render();
    }
    function cancelConnection() {
      canvasState.connecting = null;
      $('connectionPreview')?.remove();
      if ($('scene'))
        for (const g of $('scene').querySelectorAll('.connection-near,.connection-source')) {
          g.classList.remove('connection-near');
          g.classList.remove('connection-source');
        }
    }
    return {
      startGroupDrag,
      updateDrag,
      zoomAt,
      zoomStep,
      nextZoomPercent,
      frameRect,
      removeSelectionFrame,
      drawSelectionFrame,
      boxSelection,
      canvasPointerDown,
      canvasPointerUp,
      touchMetrics,
      touchGestureEvent,
      nodePorts,
      nearestConnectionTarget,
      updateConnection,
      finishConnection,
      cancelConnection
    };
  }
};
var canvas_input_default2 = canvas_input_default;

// static/app/geometry.js
var geometry_default = {
  name: 'geometry',
  dependencies: [],
  create() {
    function automaticBoundary(...args) {
      return graph_routing_default.automaticBoundary(...args);
    }
    function connectionGeometry(...args) {
      return graph_routing_default.connectionGeometry(...args);
    }
    function intersects(...args) {
      return graph_routing_default.intersects(...args);
    }
    function cubicPoint(...args) {
      return graph_routing_default.cubicPoint(...args);
    }
    function splitCubic(...args) {
      return graph_routing_default.splitCubic(...args);
    }
    function cubicSlice(...args) {
      return graph_routing_default.cubicSlice(...args);
    }
    function curvePath(...args) {
      return graph_routing_default.curvePath(...args);
    }
    function curveLabelGap(...args) {
      return graph_routing_default.curveLabelGap(...args);
    }
    function routeConnection(...args) {
      return graph_routing_default.routeConnection(...args);
    }
    function portPosition(...args) {
      return graph_routing_default.portPosition(...args);
    }
    return {
      automaticBoundary,
      connectionGeometry,
      intersects,
      cubicPoint,
      splitCubic,
      cubicSlice,
      curvePath,
      curveLabelGap,
      routeConnection,
      portPosition
    };
  }
};
var geometry_default2 = geometry_default;

// static/research-profiles.js
function researchProfiles(parent, initial, catalog, changed) {
  const rows = structuredClone(initial || []);
  const root = document.createElement('div');
  root.className = 'research-profiles';
  const label = document.createElement('label');
  label.textContent = t('Suchprofil hinzuf\xFCgen');
  const select = document.createElement('select');
  select.setAttribute('aria-label', t('Suchprofil hinzuf\xFCgen'));
  select.append(new Option(t('Suchprofil hinzuf\xFCgen \u2026'), ''));
  for (const entry of catalog) select.append(new Option(entry.label, entry.id));
  select.append(new Option(t('Eigene Websites'), 'custom'));
  label.append(select);
  const list = document.createElement('div');
  list.className = 'profile-list';
  const help = document.createElement('p');
  help.className = 'source-help';
  root.append(label, list, help);
  parent.append(root);
  let dragging = null;
  function move(index, to) {
    if (to < 0 || to >= rows.length || index === to) return;
    rows.splice(to, 0, rows.splice(index, 1)[0]);
    paint();
    changed();
    list.children[to]?.querySelector('button')?.focus();
  }
  function control(title, glyph, callback) {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = t(title);
    button.setAttribute('aria-label', t(title));
    button.append(icon(glyph));
    button.addEventListener('click', callback);
    return button;
  }
  function paint() {
    list.replaceChildren();
    help.textContent = rows.length
      ? t(
          'Profile werden in dieser Reihenfolge durchsucht. Doppelte Treffer werden zusammengef\xFChrt.'
        )
      : t('Keine Einschr\xE4nkung \u2013 alle Websites werden durchsucht.');
    rows.forEach((row, index) => {
      const tile = document.createElement('div');
      tile.className = 'profile-item';
      const bar = document.createElement('div');
      bar.className = 'profile-row';
      const handle = control('Suchprofil verschieben', 'drag', () => {});
      handle.className = 'source-handle borderless';
      handle.draggable = true;
      handle.addEventListener('dragstart', (event) => {
        dragging = index;
        event.stopPropagation();
        event.dataTransfer.setData('application/x-argus-profile', String(index));
      });
      handle.addEventListener('dragend', () => {
        dragging = null;
      });
      handle.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopPropagation();
          move(index, index + (event.key === 'ArrowUp' ? -1 : 1));
        }
      });
      tile.addEventListener('dragover', (event) => {
        if (dragging !== null) {
          event.preventDefault();
          event.stopPropagation();
        }
      });
      tile.addEventListener('drop', (event) => {
        if (dragging === null) return;
        event.preventDefault();
        event.stopPropagation();
        const from = dragging;
        dragging = null;
        move(from, index);
      });
      const title = document.createElement('span');
      title.textContent =
        row.id === 'custom'
          ? t('Eigene Websites')
          : catalog.find((entry) => entry.id === row.id)?.label || row.id;
      const up = control('Nach oben', 'chevron-up', () => move(index, index - 1));
      const down = control('Nach unten', 'chevron-down', () => move(index, index + 1));
      up.className = down.className = 'source-move borderless';
      up.disabled = index === 0;
      down.disabled = index === rows.length - 1;
      const remove = control('Suchprofil entfernen', 'trash', () => {
        rows.splice(index, 1);
        paint();
        changed();
      });
      remove.className = 'danger-filled';
      bar.classList.add('source-row');
      bar.append(handle, title, up, down, remove);
      tile.append(bar);
      if (row.id === 'custom') {
        const input = document.createElement('textarea');
        input.rows = 4;
        input.value = (row.sites || []).join('\n');
        input.placeholder = t('Eine Website pro Zeile, zum Beispiel GitHub');
        input.setAttribute('aria-label', t('Eigene Websites \u2013 eine pro Zeile'));
        input.addEventListener('input', () => {
          row.sites = input.value
            .split(/\r?\n/)
            .map((value) => value.trim())
            .filter(Boolean);
          changed();
        });
        tile.append(input);
      }
      list.append(tile);
    });
  }
  select.addEventListener('change', () => {
    const id = select.value;
    if (id && (id === 'custom' || !rows.some((row) => row.id === id))) {
      rows.push(id === 'custom' ? { id, sites: [] } : { id });
      paint();
      changed();
    }
    select.value = '';
  });
  paint();
  return () => structuredClone(rows);
}

// static/app/inspector.js
var inspector_default = {
  name: 'inspector',
  dependencies: [
    '$',
    'actorIncompatible',
    'applyFields',
    'applyGraphHighlights',
    'button',
    'change',
    'dataLabel',
    'deleteEdges',
    'deleteGroup',
    'deleteNodes',
    'detachNodes',
    'displayControls',
    'dissolveGroup',
    'editFields',
    'editableNodeData',
    'el',
    'facts',
    'formatLocation',
    'groupNodeIds',
    'groupTitle',
    'iconActionButton',
    'inputField',
    'inspectorAvailability',
    'makeRoomForGroup',
    'nodePlugin',
    'phoneControls',
    'pluginText',
    'refreshDetailMap',
    'render',
    'renderPalette',
    'reviewControls',
    'run',
    'saveButtons',
    'toast',
    'toggleGroup'
  ],
  create({
    selectionState,
    workspaceState,
    pluginsState,
    executionState,
    canvasState,
    $,
    actorIncompatible,
    applyFields,
    applyGraphHighlights,
    button,
    change,
    dataLabel,
    deleteEdges,
    deleteGroup,
    deleteNodes,
    detachNodes,
    displayControls,
    dissolveGroup,
    editFields,
    editableNodeData,
    el,
    facts,
    formatLocation,
    groupNodeIds,
    groupTitle,
    iconActionButton,
    inputField,
    inspectorAvailability,
    makeRoomForGroup,
    nodePlugin,
    phoneControls,
    pluginText,
    refreshDetailMap,
    render,
    renderPalette,
    reviewControls,
    run,
    saveButtons,
    toast,
    toggleGroup
  }) {
    function inspect(preserveGroups = false) {
      applyGraphHighlights();
      if (!preserveGroups) {
        selectionState.selectedGroup = null;
        selectionState.selectedGroups.clear();
        for (const g of document.querySelectorAll('.group.selected'))
          g.classList.remove('selected');
      }
      renderPalette();
      const panel = $('inspector');
      panel.replaceChildren();
      if (!workspaceState.project) {
        inspectorAvailability('');
        return;
      }
      const nodes = workspaceState.project.document.nodes.filter((n) =>
        selectionState.selected.has(n.id)
      );
      inspectorAvailability(
        nodes
          .map((n) => n.id)
          .sort()
          .join(',')
      );
      if (!nodes.length) {
        if (selectionState.selectedEdges.size) {
          inspectorAvailability('edges:' + Array.from(selectionState.selectedEdges).join(','));
          panel.append(
            el(
              'span',
              {
                class: 'tag'
              },
              t('Verbindung')
            ),
            el('h2', {}, t('Verbindungsdetails'))
          );
          for (const edge of workspaceState.project.document.edges.filter((e) =>
            selectionState.selectedEdges.has(e.id)
          )) {
            const label = inputField(panel, t('Bezeichnung'), edge.label || '');
            label.addEventListener('input', () => {
              edge.label = label.value;
              change();
              render();
            });
          }
          panel.append(
            iconActionButton(
              t('Verbindung l\xF6schen'),
              () => deleteEdges([...selectionState.selectedEdges]),
              'trash',
              'danger-filled'
            )
          );
        }
        return;
      }
      if (nodes.length !== 1) {
        panel.append(
          el(
            'span',
            {
              class: 'tag'
            },
            t('Mehrfachauswahl')
          ),
          el('h2', {}, nodes.length + t(' Knoten ausgew\xE4hlt'))
        );
        if (
          nodes.some((n) =>
            workspaceState.project.document.groups.some((g) => g.members.includes(n.id))
          )
        )
          panel.append(
            iconActionButton(
              t('Aus Gruppe l\xF6sen'),
              () => detachNodes(nodes.map((n) => n.id)),
              'ungroup',
              'wide'
            )
          );
        const report = el('input', { type: 'checkbox' });
        report.checked = nodes.every((node2) => node2.report);
        report.indeterminate = nodes.some((node2) => node2.report) && !report.checked;
        const label = el('label', { class: 'checkbox-label' });
        label.append(report, document.createTextNode(t('In Report aufnehmen')));
        report.addEventListener('change', () => {
          for (const node2 of nodes) node2.report = report.checked;
          change();
        });
        const actions = el('section', { class: 'multi-selection-actions node-report-section' });
        actions.append(
          label,
          iconActionButton(
            t('Knoten l\xF6schen'),
            () => deleteNodes(nodes.map((n) => n.id)),
            'trash',
            'danger-filled wide'
          )
        );
        panel.append(actions);
        return;
      }
      const node = nodes[0],
        actorAction =
          node.type === 'actor'
            ? pluginsState.catalog
                .find((p) => p.id === node.data.plugin)
                ?.actions.find((a) => a.id === node.data.action)
            : null;
      panel.append(
        el(
          'span',
          {
            class: 'tag'
          },
          dataLabel(node.type)
        ),
        el('h2', {}, t('Knotendetails'))
      );
      const name = inputField(panel, t('Titel'), node.label, 'node-label');
      const readers = ['note', 'marker'].includes(node.type)
        ? []
        : editFields(
            panel,
            node.type === 'actor'
              ? Object.fromEntries(
                  Object.entries({ ...actorAction?.default_params, ...node.data.params }).filter(
                    ([key]) =>
                      !key.startsWith('_merge_') &&
                      !(
                        actorAction?.default_params?.source_order &&
                        (key === 'source' || key === 'source_order' || key.startsWith('use_'))
                      ) &&
                      key !== 'search_profiles' &&
                      !(actorAction?.settings_only || []).includes(key)
                  )
                )
              : editableNodeData(node),
            [],
            (key) =>
              pluginText(
                node.type === 'actor'
                  ? pluginsState.catalog.find((p) => p.id === node.data.plugin)
                  : nodePlugin(node.type),
                key
              ),
            {
              schema: actorAction?.parameter_schema,
              sections: actorAction?.parameter_sections,
              help: actorAction?.parameter_help
            }
          );
      if (['note', 'marker'].includes(node.type)) noteControls(panel, node);
      if (['url', 'profile', 'image', 'location', 'file'].includes(node.type))
        displayControls(panel, node);
      if (node.type === 'phone') phoneControls(panel, node, readers);
      let profileReaders = null;
      const commitNode = () => {
        try {
          const data = applyFields(
            node.type === 'actor' ? node.data.params || {} : node.data,
            readers
          );
          if (profileReaders)
            data.search_profiles = {
              ...node.data.params?.search_profiles,
              ...Object.fromEntries(
                Object.entries(profileReaders).map(([provider, read]) => [provider, read()])
              )
            };
          if (node.type === 'actor') node.data.params = data;
          else node.data = data;
          if (node.type === 'location') node.data.formatted_address = formatLocation(node.data);
          node.label = name.value;
          if (node.type === 'error') node.data.title = name.value;
          change(node.id);
          render();
          if (node.type === 'location') refreshDetailMap(panel, node);
        } catch (error) {
          toast(error.message);
        }
      };
      if (actorAction?.research_profiles) {
        profileReaders = {};
        const defaults = actorAction.default_params || {};
        const profiles = node.data.params?.search_profiles ?? defaults.search_profiles ?? {};
        const section = el('section', { class: 'tool-search-profiles' });
        section.append(el('h3', {}, t('Suchprofile f\xFCr diese Suche')));
        const labels = {
          consensus: 'Consensus',
          sherlock: 'Sherlock',
          maigret: 'Maigret',
          holehe: 'Holehe',
          user_scanner: 'User Scanner',
          blackbird: 'Blackbird',
          ignorant: 'Ignorant'
        };
        for (const [provider, catalog] of Object.entries(actorAction.research_profiles)) {
          if (defaults['use_' + provider] === false) continue;
          const box = el('details', { class: 'provider-profiles' });
          box.append(el('summary', {}, labels[provider] || provider));
          const legacyField = {
            consensus: 'consensus_sites',
            sherlock: 'sherlock_sites',
            maigret: 'maigret_sites',
            holehe: 'holehe_sites'
          }[provider];
          const legacy = node.data.params?.[legacyField] ?? defaults[legacyField];
          const initial =
            profiles[provider] ?? (legacy?.length ? [{ id: 'custom', sites: legacy }] : []);
          profileReaders[provider] = researchProfiles(box, initial, catalog, commitNode);
          section.append(box);
        }
        if (Object.keys(profileReaders).length) panel.append(section);
      }
      name.addEventListener('input', () => {
        delete node.evidence.label_key;
        commitNode();
      });
      for (const field of readers) field.control.addEventListener('input', commitNode);
      if (node.type !== 'actor') reviewControls(panel, node);
      const nodeSave = el('span', {
        class: 'save-indicator'
      });
      nodeSave.id = 'nodeSave';
      nodeSave.dataset.nodeSave = node.id;
      panel.append(nodeSave);
      saveButtons();
      if (node.type === 'image' && node.data.file_id)
        panel.append(
          el('img', {
            class: 'preview',
            src: '/api/files/' + node.data.file_id,
            alt: node.label
          })
        );
      if (node.type === 'actor') {
        const mod = pluginsState.catalog.find((p) => p.id === node.data.plugin);
        const act = mod?.actions.find((a) => a.id === node.data.action);
        panel.append(el('h3', {}, t('Ausf\xFChrung')));
        if (act?.external)
          panel.append(
            el(
              'p',
              {
                class: 'warning'
              },
              pluginText(mod, act.external_notice) ||
                t('Bei konfiguriertem Geocoder werden Standortangaben an diesen Anbieter gesendet.')
            )
          );
        if (act?.execution === 'browser') {
          panel.append(el('label', {}, t('JavaScript \xB7 inputs = verbundene Datenknoten')));
          const code = el('textarea', {
            rows: 12,
            spellcheck: false
          });
          code.value = node.data.params?.code || transformExample;
          code.addEventListener('input', () => {
            node.data.params = {
              ...node.data.params,
              code: code.value
            };
            change(node.id);
          });
          panel.append(code);
        }
        const queued = executionState.actorQueue.some(
          (j) => j.pid === workspaceState.project.id && j.id === node.id
        );
        const runButton = button(
          executionState.activeActors.has(node.id)
            ? t('L\xE4uft \u2026')
            : queued
              ? t('In Warteschlange')
              : executionState.queueRunning
                ? t('In die Warteschleife hinzuf\xFCgen')
                : t('Aktor ausf\xFChren'),
          () => run(node),
          'primary'
        );
        buttonContent(
          runButton,
          runButton.textContent,
          executionState.activeActors.has(node.id)
            ? 'spinner'
            : executionState.queueRunning
              ? 'logs'
              : 'play'
        );
        const connected = workspaceState.project.document.nodes.filter(
          (n) =>
            n.type !== 'actor' &&
            workspaceState.project.document.edges.some(
              (e) => e.target === node.id && e.source === n.id
            )
        );
        runButton.disabled =
          executionState.activeActors.has(node.id) ||
          queued ||
          Boolean(act && actorIncompatible(act, connected));
        runButton.classList.toggle('saving', executionState.activeActors.has(node.id));
        panel.insertBefore(runButton, panel.children[2] || null);
      }
      const reportSection = el('section', { class: 'node-report-section' });
      const reportLabel = el('label');
      const checkbox = el('input', {
        type: 'checkbox'
      });
      checkbox.checked = Boolean(node.report);
      checkbox.addEventListener('change', () => {
        node.report = checkbox.checked;
        change();
      });
      reportLabel.append(checkbox, document.createTextNode(t('In Report aufnehmen')));
      reportSection.append(reportLabel);
      panel.append(reportSection);
      const provenance = el('details', {
        class: 'provenance'
      });
      provenance.append(el('summary', {}, t('Quelle / Herkunft')));
      facts(provenance, node.evidence || {});
      panel.append(provenance);
      for (const r of workspaceState.project.document.runs
        .filter((r2) => r2.actor_id === node.id)
        .slice(-5)
        .reverse()) {
        const box = el('div', {
          class: 'run ' + r.status
        });
        box.append(
          el('strong', {}, t(r.status) + ' \xB7 ' + new Date(r.started_at).toLocaleString())
        );
        for (const w of r.warnings || []) box.append(el('p', {}, diagnostic(w)));
        if (r.error) box.append(el('p', {}, diagnostic(r.error)));
        panel.append(box);
      }
      if (workspaceState.project.document.groups.some((g) => g.members.includes(node.id)))
        panel.append(
          iconActionButton(
            t('Aus Gruppe l\xF6sen'),
            () => detachNodes([node.id]),
            'ungroup',
            'wide'
          )
        );
      panel.append(
        iconActionButton(
          t('Knoten l\xF6schen'),
          () => deleteNodes([node.id]),
          'trash',
          'danger-filled wide node-delete'
        )
      );
    }
    function inspectGroup(group) {
      selectionState.selectedGroup = group.id;
      if (!selectionState.selectedGroups.size) selectionState.selectedGroups.add(group.id);
      inspectorAvailability('group:' + group.id);
      for (const element of document.querySelectorAll('.node.selected'))
        if (!selectionState.selected.has(element.dataset.id)) element.classList.remove('selected');
      for (const element of document.querySelectorAll('.group'))
        element.classList.toggle(
          'selected',
          selectionState.selectedGroups.has(element.dataset.group)
        );
      renderPalette();
      const panel = $('inspector');
      panel.replaceChildren();
      panel.append(
        el(
          'span',
          {
            class: 'tag'
          },
          t('GRUPPE')
        ),
        el('h2', {}, groupTitle(group))
      );
      const name = inputField(panel, t('Bezeichnung'), groupTitle(group));
      name.addEventListener('input', () => {
        delete group.label_key;
        group.label = name.value;
        change();
        render();
      });
      panel.append(
        button(t('Umbenennen'), () => {
          group.label = name.value;
          change();
          render();
          inspectGroup(group);
        })
      );
      panel.append(
        button(group.collapsed ? t('Aufklappen') : t('Einklappen'), () => toggleGroup(group))
      );
      panel.append(
        button(t('Gruppe in Report aufnehmen'), () => {
          const ids = groupNodeIds(group);
          for (const n of workspaceState.project.document.nodes) if (ids.has(n.id)) n.report = true;
          change();
          toast(t('Mitglieder f\xFCr Report markiert.'));
        })
      );
      const parent = workspaceState.project.document.groups.find((g) => g.id === group.parent_id);
      if (parent)
        panel.append(
          button(
            t('\xDCbergeordnete Gruppe') + ': ' + parent.label,
            () => {
              selectionState.selectedGroups = /* @__PURE__ */ new Set([parent.id]);
              selectionState.selected.clear();
              inspectGroup(parent);
            },
            'wide'
          )
        );
      const children = workspaceState.project.document.groups.filter(
        (g) => g.parent_id === group.id
      );
      if (children.length) panel.append(el('h3', {}, t('Untergruppen')));
      for (const child of children)
        panel.append(
          button(
            child.label,
            () => {
              group.collapsed = false;
              canvasState.groupBoundsCache = null;
              makeRoomForGroup(group);
              selectionState.selectedGroups = /* @__PURE__ */ new Set([child.id]);
              selectionState.selected.clear();
              change();
              render();
              inspectGroup(child);
            },
            'wide'
          )
        );
      for (const id of groupNodeIds(group)) {
        const n = workspaceState.project.document.nodes.find((n2) => n2.id === id);
        if (n)
          panel.append(
            button(
              dataLabel(n.type) + ' \xB7 ' + n.label,
              () => {
                for (const owner of workspaceState.project.document.groups)
                  if (groupNodeIds(owner).has(id)) owner.collapsed = false;
                selectionState.selected = /* @__PURE__ */ new Set([id]);
                change();
                render();
                inspect();
              },
              'wide'
            )
          );
      }
      panel.append(
        iconActionButton(
          t('Gruppierung aufl\xF6sen'),
          () => dissolveGroup(group),
          'ungroup',
          'wide'
        ),
        button(t('Gruppe l\xF6schen'), () => deleteGroup(group), 'danger-filled')
      );
    }
    function noteInk(color) {
      const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
      return rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 140 ? '#30271b' : '#f7f7f7';
    }
    function noteControls(panel, node) {
      if (node.type === 'note')
        panel.append(el('p', {}, t('Notiz direkt auf der Arbeitsfl\xE4che bearbeiten.')));
      for (const [key, label, min, max] of [
        ['width', 'Breite', 200, 900],
        ['height', 'H\xF6he', 120, 800]
      ]) {
        const input = inputField(
          panel,
          t(label),
          node.appearance?.[key] || (key === 'width' ? 320 : 180)
        );
        input.type = 'number';
        input.min = min;
        input.max = max;
        input.addEventListener('input', () => {
          if (input.value === '') return;
          node.appearance = {
            ...node.appearance,
            [key]: Math.max(min, Math.min(max, Number(input.value)))
          };
          change(node.id);
          render();
        });
      }
      const color = inputField(panel, t('Farbe'), node.appearance?.color || '#ffcc70');
      color.maxLength = 7;
      color.addEventListener('input', () => {
        if (!/^#[0-9a-f]{6}$/i.test(color.value)) return;
        node.appearance = {
          ...node.appearance,
          color: color.value
        };
        change(node.id);
        render();
      });
      const swatches = el('div', {
        class: 'note-swatches'
      });
      for (const hex of ['#ffcc70', '#f3a2a2', '#a8dfc3', '#a9d5f5', '#d6b4ef']) {
        const b = button(
          '',
          () => {
            node.appearance = {
              ...node.appearance,
              color: hex
            };
            color.value = hex;
            change(node.id);
            render();
          },
          'note-swatch'
        );
        b.style.backgroundColor = hex;
        b.setAttribute('aria-label', t('Farbe') + ' ' + hex);
        swatches.append(b);
      }
      panel.append(swatches);
    }
    return { inspect, inspectGroup, noteInk, noteControls };
  }
};
var inspector_default2 = inspector_default;

// static/form-sections.js
var ArgusForms = (() => {
  function sections(parent, data, definitions = [], translate = (value) => value, help = '') {
    const readers = [],
      keys = /* @__PURE__ */ new Set();
    if (!definitions.length) return { readers, keys };
    if (help) parent.append(ui_default.el('p', { class: 'source-help' }, translate(help)));
    for (const definition of definitions) {
      const key = definition.toggle;
      if (!(key in data)) continue;
      const section = ui_default.el('div', { class: 'parameter-section' });
      const toggle = ui_default.checkbox(
        translate(definition.label || definition.key),
        Boolean(data[key])
      );
      toggle.input.dataset.field = key;
      section.append(toggle.label);
      keys.add(key);
      readers.push({
        control: toggle.input,
        path: [key],
        read: () => toggle.input.checked
      });
      const fields = ui_default.el('div', { class: 'parameter-limits' });
      for (const name of definition.limits || []) {
        if (!(name in data)) continue;
        const label = ui_default.el('label', {}, translate(name));
        const input = ui_default.el('input', {
          type: 'number',
          min: '0',
          step: '1',
          'data-field': name,
          'aria-label': translate(name)
        });
        input.value = data[name];
        fields.append(label, input);
        keys.add(name);
        readers.push({
          control: input,
          path: [name],
          read: () => {
            const value = Number(input.value);
            if (!input.value.trim() || !Number.isSafeInteger(value) || value < 0)
              throw Error(translate('Limits m\xFCssen ganze Zahlen ab 0 sein.'));
            return value;
          }
        });
      }
      const update = () => {
        for (const input of fields.querySelectorAll('input'))
          input.disabled = !toggle.input.checked;
      };
      toggle.input.addEventListener('change', update);
      update();
      if (fields.children.length) section.append(fields);
      parent.append(section);
    }
    return { readers, keys };
  }
  return Object.freeze({ sections });
})();
var form_sections_default = ArgusForms;

// static/location-countries.js
var LOCATION_COUNTRIES = [
  'AD',
  'AE',
  'AF',
  'AG',
  'AI',
  'AL',
  'AM',
  'AO',
  'AQ',
  'AR',
  'AS',
  'AT',
  'AU',
  'AW',
  'AX',
  'AZ',
  'BA',
  'BB',
  'BD',
  'BE',
  'BF',
  'BG',
  'BH',
  'BI',
  'BJ',
  'BL',
  'BM',
  'BN',
  'BO',
  'BQ',
  'BR',
  'BS',
  'BT',
  'BV',
  'BW',
  'BY',
  'BZ',
  'CA',
  'CC',
  'CD',
  'CF',
  'CG',
  'CH',
  'CI',
  'CK',
  'CL',
  'CM',
  'CN',
  'CO',
  'CQ',
  'CR',
  'CU',
  'CV',
  'CW',
  'CX',
  'CY',
  'CZ',
  'DE',
  'DJ',
  'DK',
  'DM',
  'DO',
  'DZ',
  'EC',
  'EE',
  'EG',
  'EH',
  'ER',
  'ES',
  'ET',
  'FI',
  'FJ',
  'FK',
  'FM',
  'FO',
  'FR',
  'GA',
  'GB',
  'GD',
  'GE',
  'GF',
  'GG',
  'GH',
  'GI',
  'GL',
  'GM',
  'GN',
  'GP',
  'GQ',
  'GR',
  'GS',
  'GT',
  'GU',
  'GW',
  'GY',
  'HK',
  'HM',
  'HN',
  'HR',
  'HT',
  'HU',
  'ID',
  'IE',
  'IL',
  'IM',
  'IN',
  'IO',
  'IQ',
  'IR',
  'IS',
  'IT',
  'JE',
  'JM',
  'JO',
  'JP',
  'KE',
  'KG',
  'KH',
  'KI',
  'KM',
  'KN',
  'KP',
  'KR',
  'KW',
  'KY',
  'KZ',
  'LA',
  'LB',
  'LC',
  'LI',
  'LK',
  'LR',
  'LS',
  'LT',
  'LU',
  'LV',
  'LY',
  'MA',
  'MC',
  'MD',
  'ME',
  'MF',
  'MG',
  'MH',
  'MK',
  'ML',
  'MM',
  'MN',
  'MO',
  'MP',
  'MQ',
  'MR',
  'MS',
  'MT',
  'MU',
  'MV',
  'MW',
  'MX',
  'MY',
  'MZ',
  'NA',
  'NC',
  'NE',
  'NF',
  'NG',
  'NI',
  'NL',
  'NO',
  'NP',
  'NR',
  'NU',
  'NZ',
  'OM',
  'PA',
  'PE',
  'PF',
  'PG',
  'PH',
  'PK',
  'PL',
  'PM',
  'PN',
  'PR',
  'PS',
  'PT',
  'PW',
  'PY',
  'QA',
  'RE',
  'RO',
  'RS',
  'RU',
  'RW',
  'SA',
  'SB',
  'SC',
  'SD',
  'SE',
  'SG',
  'SH',
  'SI',
  'SJ',
  'SK',
  'SL',
  'SM',
  'SN',
  'SO',
  'SR',
  'SS',
  'ST',
  'SV',
  'SX',
  'SY',
  'SZ',
  'TC',
  'TD',
  'TF',
  'TG',
  'TH',
  'TJ',
  'TK',
  'TL',
  'TM',
  'TN',
  'TO',
  'TR',
  'TT',
  'TV',
  'TW',
  'TZ',
  'UA',
  'UG',
  'UM',
  'US',
  'UY',
  'UZ',
  'VA',
  'VC',
  'VE',
  'VG',
  'VI',
  'VN',
  'VU',
  'WF',
  'WS',
  'XK',
  'YE',
  'YT',
  'ZA',
  'ZM',
  'ZW'
];
var location_countries_default = LOCATION_COUNTRIES;

// static/app/fields.js
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
            control2 = el('select', { id, 'data-field': fieldPath.join('.') });
          for (const choice of schema.enum)
            control2.append(el('option', { value: choice }, translate(choice)));
          control2.value = value;
          parent.append(el('label', { for: id }, translate(fieldNames[key] || key)), control2);
          readers.push({ control: control2, path: fieldPath, read: () => control2.value });
          continue;
        }
        if (schema.control === 'range') {
          const id = 'field-' + uid(),
            row = el('div', { class: 'range-field' });
          const control2 = el('input', {
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
          control2.value = number.value = value;
          let fromNumber = false;
          control2.addEventListener('input', () => {
            if (!fromNumber) number.value = control2.value;
          });
          number.addEventListener('input', () => {
            if (!number.value || !number.validity.valid) return;
            control2.value = number.value;
            fromNumber = true;
            control2.dispatchEvent(new Event('input', { bubbles: true }));
            fromNumber = false;
          });
          parent.append(el('label', { for: id }, translate(fieldNames[key] || key)));
          row.append(control2, number);
          parent.append(row);
          readers.push({
            control: control2,
            path: fieldPath,
            read: () => readField(number, value, key)
          });
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
var fields_default2 = fields_default;

// static/app/palette.js
var palette_default = {
  name: 'palette',
  dependencies: [
    '$',
    'actorIcon',
    'addActor',
    'addData',
    'button',
    'dataIcon',
    'dataLabel',
    'dropFiles',
    'el',
    'pluginText',
    'providerSearchKey',
    'render',
    'searchText',
    'selectedData',
    'toast',
    'updateDeleteButtons'
  ],
  create({
    libraryState,
    workspaceState,
    pluginsState,
    persistenceState,
    selectionState,
    canvasState,
    $,
    actorIcon,
    addActor,
    addData,
    button,
    dataIcon,
    dataLabel,
    dropFiles,
    el,
    pluginText,
    providerSearchKey,
    render,
    searchText,
    selectedData,
    toast,
    updateDeleteButtons
  }) {
    function dataCategory(type) {
      return (
        {
          email: 'Kennungen',
          username: 'Kennungen',
          phone: 'Kennungen',
          url: 'Kennungen',
          location: 'Orte und Zeit',
          datetime: 'Orte und Zeit',
          image: 'Medien',
          file: 'Medien',
          note: 'Eigene Angaben',
          value: 'Eigene Angaben'
        }[type] || 'Weitere'
      );
    }
    function actionCategory(plugin, action) {
      return (
        action.category ||
        plugin.category ||
        {
          location: 'Orte und Zeit',
          metadata: 'Medien',
          transform: 'Datenbearbeitung'
        }[plugin.id] ||
        'Weitere'
      );
    }
    function paletteEntries(kind, entries) {
      const state = libraryState.paletteState[kind],
        filter = $(kind + 'Category'),
        categories = [...new Set(entries.map((e) => e.category))].sort((a, b) =>
          t(a).localeCompare(t(b), language)
        );
      state.categories = state.categories.filter((c) => categories.includes(c));
      filter.replaceChildren();
      const all = el('label', {
          class: 'checkbox-label'
        }),
        allBox = el('input', {
          type: 'checkbox'
        });
      allBox.checked = !state.categories.length;
      allBox.addEventListener('change', () => {
        state.categories = [];
        renderPalette();
      });
      all.append(allBox, document.createTextNode(t('Alle Kategorien')));
      filter.append(all);
      for (const category of categories) {
        const label = el('label', {
            class: 'checkbox-label'
          }),
          box = el('input', {
            type: 'checkbox',
            value: category
          });
        box.checked = state.categories.includes(category);
        box.addEventListener('change', () => {
          state.categories = box.checked
            ? [.../* @__PURE__ */ new Set([...state.categories, category])]
            : state.categories.filter((c) => c !== category);
          renderPalette();
        });
        label.append(box, document.createTextNode(t(category)));
        filter.append(label);
      }
      const query = searchText(state.query);
      return entries
        .filter(
          (e) =>
            (!state.categories.length || state.categories.includes(e.category)) &&
            searchText(e.label + ' ' + e.search + ' ' + t(e.category)).includes(query)
        )
        .sort((a, b) => {
          const byName = a.label.localeCompare(b.label, language);
          return state.sort === 'za'
            ? -byName
            : state.sort === 'category' ||
                state.sort === 'category_az' ||
                state.sort === 'category_za'
              ? (state.sort === 'category_za' ? -1 : 1) *
                  t(a.category).localeCompare(t(b.category), language) || byName
              : byName;
        });
    }
    function renderPalette() {
      if (!workspaceState.project) return;
      const nodes = $('nodePalette'),
        actors = $('actorPalette');
      nodes.replaceChildren();
      actors.replaceChildren();
      const data = Object.keys(workspaceState.templates)
        .filter((type) => pluginsState.dataTypes.get(type)?.installed)
        .map((type) => ({
          type,
          label: dataLabel(type),
          search: type,
          category: pluginsState.dataTypes.get(type)?.node.category || dataCategory(type)
        }));
      for (const entry of paletteEntries('node', data)) {
        const b = button(entry.label, () => addData(entry.type), 'palette-item');
        buttonContent(b, entry.label, dataIcon(entry.type));
        b.dataset.type = entry.type;
        b.disabled = persistenceState.busy;
        b.title = t(entry.category);
        paletteDrag(b, {
          kind: 'node',
          type: entry.type
        });
        nodes.append(b);
      }
      const inputs = selectedData(),
        entries = pluginsState.catalog.flatMap((plugin) =>
          (plugin.actions || []).map((action) => ({
            plugin,
            action,
            label: pluginText(plugin, action.name),
            search:
              plugin.name + ' ' + plugin.id + ' ' + pluginText(plugin, plugin.description || ''),
            category: actionCategory(plugin, action)
          }))
        );
      const sortedActors = paletteEntries('actor', entries);
      if (inputs.length)
        sortedActors.sort(
          (a, b) =>
            Number(actorIncompatible(a.action, inputs)) -
            Number(actorIncompatible(b.action, inputs))
        );
      let lastActorCategory = null;
      for (const { plugin, action, label, category } of sortedActors) {
        if (
          libraryState.paletteState.actor.sort.startsWith('category') &&
          category !== lastActorCategory
        ) {
          actors.append(
            el(
              'div',
              {
                class: 'palette-category-divider'
              },
              t(category)
            )
          );
          lastActorCategory = category;
        }
        const b = button(label, () => addActor(plugin, action), 'palette-item actor-item');
        buttonContent(b, label, actorIcon(plugin.id));
        b.dataset.plugin = plugin.id;
        b.dataset.action = action.id;
        b.disabled = persistenceState.busy || actorIncompatible(action, inputs, true);
        b.title =
          t(category) +
          ' \xB7 ' +
          t('Eingabe: ') +
          action.inputs.map((x) => (nodeLabels[x] ? t(nodeLabels[x]) : x)).join(', ');
        paletteDrag(b, {
          kind: 'actor',
          plugin: plugin.id,
          action: action.id
        });
        actors.append(b);
      }
      for (const list of [nodes, actors])
        if (!list.children.length)
          list.append(
            el(
              'p',
              {
                class: 'palette-empty'
              },
              t('Keine passenden Eintr\xE4ge.')
            )
          );
      const key = inputs
        .map((n) => n.id)
        .sort()
        .join(',');
      if (key !== selectionState.lastPaletteSelection) {
        selectionState.lastPaletteSelection = key;
        if (inputs.length) actors.scrollTop = 0;
      }
      updateDeleteButtons();
    }
    function setupPaletteControls() {
      for (const kind of ['node', 'actor']) {
        const sort = $(kind + 'Sort');
        sort.replaceChildren(
          ...[
            ['category_az', 'Kategorie A\u2013Z'],
            ['category_za', 'Kategorie Z\u2013A'],
            ['az', 'A\u2013Z'],
            ['za', 'Z\u2013A']
          ].map(([value, label]) =>
            el(
              'option',
              {
                value,
                'data-i18n': label
              },
              t(label)
            )
          )
        );
        sort.value = libraryState.paletteState[kind].sort;
        const search = $(kind + 'Search');
        search.addEventListener('input', () => {
          libraryState.paletteState[kind].query = search.value;
          renderPalette();
        });
        $(kind + 'SearchToggle').addEventListener('click', () => {
          const row = $(kind + 'SearchRow');
          row.hidden = !row.hidden;
          $(kind + 'SearchToggle').setAttribute('aria-expanded', String(!row.hidden));
          if (!row.hidden) search.focus();
        });
        for (const mode of ['Filter', 'Sort'])
          $(kind + mode + 'Toggle').addEventListener('click', () => {
            const row = $(kind + mode + 'Row');
            row.hidden = !row.hidden;
            $(kind + mode + 'Toggle').setAttribute('aria-expanded', String(!row.hidden));
          });
        $(kind + 'Sort').addEventListener('change', (e) => {
          libraryState.paletteState[kind].sort = e.target.value;
          renderPalette();
        });
      }
    }
    function paletteDrag(button2, payload) {
      touchPaletteDrag(button2, payload);
      button2.draggable = true;
      button2.addEventListener('dragstart', (event) => {
        if (persistenceState.busy) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData('application/x-argus-palette', JSON.stringify(payload));
        event.dataTransfer.effectAllowed = 'copy';
      });
    }
    async function dropPalette(event) {
      if (event.dataTransfer?.files?.length) {
        try {
          await dropFiles(event);
        } catch (error) {
          toast(error.message);
        }
        return;
      }
      event.preventDefault();
      for (const element of document.querySelectorAll('.drop-target'))
        element.classList.remove('drop-target');
      try {
        const payload = JSON.parse(event.dataTransfer.getData('application/x-argus-palette'));
        const box = $('graph').getBoundingClientRect(),
          x = (event.clientX - box.left - canvasState.pan.x) / canvasState.pan.scale,
          y = (event.clientY - box.top - canvasState.pan.y) / canvasState.pan.scale;
        if (payload.kind === 'node' && workspaceState.templates[payload.type])
          addData(payload.type, x, y);
        else if (payload.kind === 'actor') {
          const plugin = pluginsState.catalog.find((p) => p.id === payload.plugin),
            action = plugin?.actions.find((a) => a.id === payload.action);
          if (!action) throw Error(t('Aktor nicht verf\xFCgbar.'));
          const targetId = event.target.closest('.node')?.dataset.id,
            target = workspaceState.project.document.nodes.find((n) => n.id === targetId);
          if (target?.type === 'actor')
            throw Error(t('Aktoren ben\xF6tigen einen Datenknoten als Eingabe.'));
          const selected = selectedData();
          const inputs = target
            ? selected.some((node) => node.id === target.id)
              ? selected.filter((node) => actionAcceptsNode(action, node))
              : [target]
            : [];
          const actor = addActor(plugin, action, inputs);
          if (!target) {
            actor.x = x;
            actor.y = y;
            render();
          }
        }
      } catch (error) {
        toast(error.message);
      }
    }
    function touchPaletteDrag(button2, payload) {
      let state = null,
        ghost = null;
      button2.style.touchAction = 'none';
      button2.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' || button2.disabled) return;
        state = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          at: Date.now(),
          moved: false,
          scroll: false,
          scrollTop: button2.closest('.palette-list')?.scrollTop || 0
        };
        button2.setPointerCapture(e.pointerId);
      });
      button2.addEventListener('pointermove', (e) => {
        if (!state || e.pointerId !== state.id) return;
        const dx = e.clientX - state.x,
          dy = e.clientY - state.y;
        if (Math.hypot(dx, dy) < 8 && !state.moved && !state.scroll) return;
        e.preventDefault();
        if (
          state.scroll ||
          (!state.moved && Date.now() - state.at < 220 && Math.abs(dy) > Math.abs(dx) * 1.3)
        ) {
          state.scroll = true;
          const list = button2.closest('.palette-list');
          if (list) list.scrollTop = state.scrollTop - dy;
          return;
        }
        state.moved = true;
        if (!ghost) {
          ghost = el(
            'div',
            {
              class: 'palette-ghost'
            },
            button2.textContent
          );
          document.body.append(ghost);
        }
        ghost.style.left = e.clientX + 12 + 'px';
        ghost.style.top = e.clientY + 12 + 'px';
      });
      const end = (e) => {
        if (!state) return;
        const moved = state.moved,
          scrolled = state.scroll;
        state = null;
        ghost?.remove();
        ghost = null;
        if (scrolled) {
          button2.dataset.suppressClick = '1';
          setTimeout(() => delete button2.dataset.suppressClick, 400);
          return;
        }
        if (!moved || e.type === 'pointercancel') return;
        e.preventDefault();
        button2.dataset.suppressClick = '1';
        setTimeout(() => delete button2.dataset.suppressClick, 400);
        const target = document.elementFromPoint(e.clientX, e.clientY);
        if (target?.closest('#graph'))
          dropPalette({
            preventDefault() {},
            clientX: e.clientX,
            clientY: e.clientY,
            target,
            dataTransfer: {
              getData() {
                return JSON.stringify(payload);
              }
            }
          });
      };
      button2.addEventListener('pointerup', end);
      button2.addEventListener('pointercancel', end);
      button2.addEventListener(
        'click',
        (e) => {
          if (button2.dataset.suppressClick) {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
        },
        true
      );
    }
    function actionAcceptsNode(action, node) {
      if (!action.inputs.includes('*') && !action.inputs.includes(node.type)) return false;
      if (node.type !== 'profile') return true;
      const record = pluginsState.providerIndex.get(providerSearchKey(node.data.provider)),
        provider = record?.id || node.data.provider;
      if (action.providers && !action.providers.includes(provider)) return false;
      if (
        action.generic_profile &&
        pluginsState.catalog.some((p) =>
          (p.actions || []).some((a) => a.providers?.includes(provider))
        )
      )
        return false;
      return true;
    }
    function actorIncompatible(action, inputs, allowPartial = false) {
      if (
        action.max_inputs &&
        inputs.filter((n) => actionAcceptsNode(action, n)).length > action.max_inputs
      )
        return true;
      if (action.same_type && inputs.length && new Set(inputs.map((n) => n.type)).size > 1)
        return true;
      if (
        !allowPartial &&
        action.min_inputs &&
        inputs.length > 0 &&
        inputs.length < action.min_inputs
      )
        return true;
      return selectionState.selectedGroup
        ? inputs.length > 0 && !inputs.some((n) => actionAcceptsNode(action, n))
        : inputs.some((n) => !actionAcceptsNode(action, n));
    }
    return {
      dataCategory,
      actionCategory,
      paletteEntries,
      renderPalette,
      setupPaletteControls,
      paletteDrag,
      dropPalette,
      touchPaletteDrag,
      actionAcceptsNode,
      actorIncompatible
    };
  }
};
var palette_default2 = palette_default;

// static/jobs-client.js
var delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function pollJob(id, onUpdate = () => {}) {
  while (true) {
    let response;
    try {
      response = await authorizedFetch('/api/jobs/' + encodeURIComponent(id));
    } catch {
      await delay(1500);
      continue;
    }
    if (!response.ok) throw Error('Job status unavailable');
    const job = await response.json();
    onUpdate(job);
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(job.state)) return job;
    await delay(750);
  }
}

// static/app/actors.js
var actors_default = {
  name: 'actors',
  dependencies: [
    'actorTitle',
    'api',
    'change',
    'inspect',
    'reconcileWorkspace',
    'modalChoice',
    'openPluginSettings',
    'parameterModal',
    'render',
    'save',
    'toast',
    'updateStatus'
  ],
  create({
    workspaceState,
    executionState,
    pluginsState,
    actorTitle,
    api,
    change,
    inspect,
    reconcileWorkspace,
    modalChoice,
    openPluginSettings,
    parameterModal,
    render,
    save,
    toast,
    updateStatus
  }) {
    async function transform(node, documentData = workspaceState.project.document) {
      const ids = new Set(
        documentData.edges.filter((e) => e.target === node.id).map((e) => e.source)
      );
      const inputs = documentData.nodes.filter((n) => ids.has(n.id) && n.type !== 'actor');
      return new Promise((resolve, reject) => {
        const worker = new Worker('/transform-worker.js');
        const timer = setTimeout(() => {
          worker.terminate();
          reject(Error(t('Transform nach 2 Sekunden abgebrochen.')));
        }, 2e3);
        worker.onmessage = (e) => {
          clearTimeout(timer);
          worker.terminate();
          e.data.error ? reject(Error(e.data.error)) : resolve(e.data.outputs);
        };
        worker.onerror = (e) => {
          clearTimeout(timer);
          worker.terminate();
          reject(Error(e.message));
        };
        worker.postMessage({
          inputs,
          code: node.data.params?.code || transformExample
        });
      });
    }
    async function run(node) {
      if (
        !workspaceState.project ||
        executionState.preflighting.has(node.id) ||
        executionState.activeActors.has(node.id) ||
        executionState.actorQueue.some((j) => j.id === node.id)
      )
        return;
      executionState.preflighting.add(node.id);
      try {
        if (node.data?.plugin === 'instagram' && !(await instagramPreflight())) return;
        await performActorJob({
          pid: workspaceState.project.id,
          id: node.id,
          label: actorTitle(node)
        });
      } finally {
        executionState.preflighting.delete(node.id);
        await syncActorJobs().catch(() => {});
        if (workspaceState.project) inspect();
      }
    }
    async function syncActorJobs() {
      const data = await api('/api/jobs');
      executionState.vpnWaiting = Boolean(data.vpn_waiting);
      executionState.actorQueue = data.jobs
        .filter((job) => job.state === 'queued')
        .map((job) => ({ ...job, id: job.actor_id, pid: job.project_id, serverId: job.id }));
      executionState.activeActors = new Set(
        data.jobs.filter((job) => job.state !== 'queued').map((job) => job.actor_id)
      );
      const active = data.jobs.find((job) => job.state !== 'queued');
      executionState.currentActorJob = active
        ? { ...active, id: active.actor_id, pid: active.project_id, serverId: active.id }
        : null;
      executionState.queueRunning = Boolean(active);
      updateStatus();
    }
    async function cancelCurrentActor() {
      if (executionState.currentActorJob?.serverId)
        await api('/api/jobs/' + executionState.currentActorJob.serverId + '/cancel', {});
      await syncActorJobs();
    }
    function pendingJobIds() {
      try {
        const ids = JSON.parse(localStorage.getItem('argus.jobs') || '[]');
        return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
      } catch {
        return [];
      }
    }
    function startJobMonitor() {
      for (const id of pendingJobIds())
        pollJob(id)
          .then(async (job) => {
            localStorage.setItem(
              'argus.jobs',
              JSON.stringify(pendingJobIds().filter((item) => item !== id))
            );
            if (workspaceState.project?.id === job.project_id) {
              await reconcileWorkspace(workspaceState.lastServerSnapshot);
              render();
              inspect();
            }
          })
          .catch((error) => toast(error.message));
      syncActorJobs().catch(() => {});
      const monitor = async () => {
        try {
          if (!document.hidden) await syncActorJobs();
        } catch {}
        setTimeout(
          monitor,
          executionState.queueRunning || executionState.actorQueue.length ? 2e3 : 15e3
        );
      };
      setTimeout(monitor, 15e3);
    }
    async function performActorJob(job) {
      let transient = {};
      if (workspaceState.project?.id === job.pid) await save();
      let current =
        workspaceState.project?.id === job.pid
          ? workspaceState.project
          : await api('/api/projects/' + job.pid);
      let node = current.document.nodes.find((n) => n.id === job.id && n.type === 'actor');
      if (!node) return;
      const action = pluginsState.catalog
        .find((p) => p.id === node.data.plugin)
        ?.actions.find((a) => a.id === node.data.action);
      if (action?.input_prompt) {
        const values = await parameterModal(action.input_prompt, node.data.params || {});
        if (values === null) return;
        const temporary = new Set(
          (action.input_prompt.fields || [])
            .filter((field) => field.transient)
            .map((field) => field.key)
        );
        transient = Object.fromEntries(
          Object.entries(values).filter(([key]) => temporary.has(key))
        );
        node.data.params = {
          ...node.data.params,
          ...Object.fromEntries(Object.entries(values).filter(([key]) => !temporary.has(key)))
        };
        await persistActorParameters(job, current, node);
      }
      for (let attempt = 0; attempt < 4; attempt++) {
        current =
          workspaceState.project?.id === job.pid
            ? workspaceState.project
            : await api('/api/projects/' + job.pid);
        node = current.document.nodes.find((n) => n.id === job.id && n.type === 'actor');
        if (!node) return;
        if (workspaceState.project?.id === job.pid) await save();
        const base = structuredClone(current.document),
          body = {
            actor_id: node.id,
            revision: current.revision,
            ...(Object.keys(transient).length
              ? {
                  transient
                }
              : {})
          };
        if (node.data.plugin === 'transform') {
          try {
            body.outputs = await transform(node, current.document);
          } catch (error) {
            body.browser_error = error.message;
          }
        }
        body.request_key = Array.from(crypto.getRandomValues(new Uint8Array(24)), (n) =>
          n.toString(16).padStart(2, '0')
        ).join('');
        const submitted = await api('/api/projects/' + job.pid + '/run', body);
        job.serverId = submitted.id;
        const pending = pendingJobIds();
        if (!pending.includes(submitted.id))
          localStorage.setItem('argus.jobs', JSON.stringify([...pending, submitted.id]));
        const terminal = await pollJob(submitted.id, () => syncActorJobs().catch(() => {}));
        localStorage.setItem(
          'argus.jobs',
          JSON.stringify(pendingJobIds().filter((id) => id !== submitted.id))
        );
        await syncActorJobs();
        const finished = await api('/api/projects/' + job.pid);
        if (workspaceState.project?.id === job.pid) {
          await reconcileWorkspace(base);
          render();
          inspect();
        }
        if (terminal.state !== 'completed') {
          if (terminal.state !== 'cancelled')
            throw Error(t('errors.' + (terminal.error_code || 'execution_interrupted')));
          return;
        }
        const last = finished.document.runs.find((run2) => run2.id === terminal.run_id);
        if (last?.input_request) {
          const values = await parameterModal(last.input_request, node.data.params || {});
          if (values === null) {
            await cancelActorRun(job.pid, last.id);
            return;
          }
          current = workspaceState.project?.id === job.pid ? workspaceState.project : finished;
          node = current.document.nodes.find((n) => n.id === job.id);
          if (!node) return;
          const temporary = new Set(
            (last.input_request.fields || [])
              .filter((field) => field.transient)
              .map((field) => field.key)
          );
          transient = Object.fromEntries(
            Object.entries(values).filter(([key]) => temporary.has(key))
          );
          node.data.params = {
            ...node.data.params,
            ...Object.fromEntries(Object.entries(values).filter(([key]) => !temporary.has(key)))
          };
          await persistActorParameters(job, current, node);
          continue;
        }
        if (last?.candidates?.some((c) => !c.chosen)) await handleManualChoices(job.pid, last);
        toast(last?.status === 'failed' ? diagnostic(last.error) : t('Aktion abgeschlossen.'));
        return;
      }
      throw Error(t('Zu viele aufeinanderfolgende Eingabeanforderungen.'));
    }
    async function persistActorParameters(job, current, node) {
      if (workspaceState.project?.id === job.pid) {
        change(node.id);
        await save();
      } else
        await api('/api/projects/' + job.pid, {
          title: current.title,
          document: current.document,
          revision: current.revision
        });
    }
    async function cancelActorRun(pid, runId) {
      if (workspaceState.project?.id === pid) await save();
      const current =
          workspaceState.project?.id === pid
            ? workspaceState.project
            : await api('/api/projects/' + pid),
        base = structuredClone(current.document);
      await api('/api/projects/' + pid + '/cancel-run', {
        revision: current.revision,
        run_id: runId
      });
      if (workspaceState.project?.id === pid) {
        await reconcileWorkspace(base);
        change();
        render();
        inspect();
      }
    }
    async function handleManualChoices(pid, run2) {
      for (const choice of run2.candidates || []) {
        if (choice.chosen || choice.cancelled || run2.status === 'cancelled') continue;
        const value = await modalChoice(
          t('Adresse ausw\xE4hlen'),
          t('Bitte die passende Ortsangabe ausw\xE4hlen.'),
          choice.options.map((option, index) => ({
            label:
              (option.formatted_address || option.locality || option.country || String(index + 1)) +
              ' \xB7 ' +
              (option.provider || ''),
            value: index
          }))
        );
        if (value === null) {
          await cancelActorRun(pid, run2.id);
          return;
        }
        if (workspaceState.project?.id === pid) await save();
        const current =
            workspaceState.project?.id === pid
              ? workspaceState.project
              : await api('/api/projects/' + pid),
          base = structuredClone(current.document);
        await api('/api/projects/' + pid + '/location-choice', {
          revision: current.revision,
          run_id: run2.id,
          input_id: choice.input_id,
          index: value
        });
        if (workspaceState.project?.id === pid) {
          await reconcileWorkspace(base);
          change();
          render();
          inspect();
        }
        choice.chosen = true;
      }
    }
    async function instagramPreflight() {
      if (!workspaceState.project) return false;
      const plugin = pluginsState.catalog.find((p) => p.id === 'instagram'),
        params = plugin?.actions?.[0]?.default_params || {};
      if (
        params.sessionid ||
        (params.login_username && params.login_password) ||
        workspaceState.project.document.preferences?.instagram_anonymous_notice_dismissed
      )
        return true;
      const pid = workspaceState.project.id,
        result = await ui_default.notice({
          title: t('Instagram ohne Anmeldung'),
          message: t(
            'Ohne Instagram-Zugangsdaten sind m\xF6glicherweise nicht alle Ergebnisse verf\xFCgbar. Du kannst fortfahren oder Zugangsdaten in den Plugin-Einstellungen hinterlegen.'
          ),
          checkboxText: t('F\xFCr dieses Projekt nicht mehr anzeigen'),
          actions: [
            {
              id: 'settings',
              label: t('Plugin-Einstellungen')
            },
            {
              id: 'continue',
              label: t('Ohne Anmeldung fortfahren'),
              primary: true
            }
          ]
        });
      if (!result || workspaceState.project?.id !== pid) return false;
      if (result.checked) {
        workspaceState.project.document.preferences = {
          ...workspaceState.project.document.preferences,
          instagram_anonymous_notice_dismissed: true
        };
        change();
        await save();
      }
      if (result.action === 'settings') {
        await openPluginSettings('instagram');
        return false;
      }
      return result.action === 'continue';
    }
    return {
      syncActorJobs,
      cancelCurrentActor,
      startJobMonitor,
      transform,
      run,
      performActorJob,
      persistActorParameters,
      cancelActorRun,
      handleManualChoices,
      instagramPreflight
    };
  }
};
var actors_default2 = actors_default;

// static/app/history.js
var history_default = {
  name: 'history',
  dependencies: ['$', 'change', 'inspect', 'render'],
  create({
    workspaceState,
    persistenceState,
    historyState,
    selectionState,
    $,
    change,
    inspect,
    render
  }) {
    function projectSnapshot() {
      return workspaceState.project
        ? {
            title: workspaceState.project.title,
            document: structuredClone(workspaceState.project.document)
          }
        : null;
    }
    function historyButtons() {
      if ($('undo'))
        $('undo').disabled = persistenceState.busy || historyState.undoStack.length === 0;
      if ($('redo'))
        $('redo').disabled = persistenceState.busy || historyState.redoStack.length === 0;
    }
    function recordHistory(scope) {
      if (!workspaceState.project || historyState.historyMuted) return;
      const snapshot = projectSnapshot(),
        at = Date.now();
      if (
        historyState.lastSnapshot &&
        JSON.stringify(snapshot) !== JSON.stringify(historyState.lastSnapshot)
      ) {
        if (!(
          scope &&
          historyState.lastHistoryScope === scope &&
          at - historyState.lastHistoryAt < 700
        ))
          historyState.undoStack.push(historyState.lastSnapshot);
        if (historyState.undoStack.length > 60) historyState.undoStack.shift();
        historyState.redoStack = [];
        historyState.lastSnapshot = snapshot;
        historyState.lastHistoryScope = scope;
        historyState.lastHistoryAt = at;
      } else if (!historyState.lastSnapshot) historyState.lastSnapshot = snapshot;
      historyButtons();
    }
    function applyHistory(direction) {
      if (!workspaceState.project || persistenceState.busy) return;
      const from = direction === 'undo' ? historyState.undoStack : historyState.redoStack,
        to = direction === 'undo' ? historyState.redoStack : historyState.undoStack;
      if (!from.length) return;
      to.push(projectSnapshot());
      const restored = from.pop();
      historyState.historyMuted = true;
      workspaceState.project.title = restored.title;
      workspaceState.project.document = structuredClone(restored.document);
      $('projectTitle').textContent = workspaceState.project.title;
      selectionState.selected.clear();
      selectionState.selectedEdges.clear();
      selectionState.selectedGroup = null;
      for (const node of workspaceState.project.document.nodes)
        persistenceState.dirtyNodes.add(node.id);
      historyState.lastSnapshot = projectSnapshot();
      historyState.lastHistoryAt = 0;
      change();
      historyState.historyMuted = false;
      render();
      inspect();
      historyButtons();
    }
    return { projectSnapshot, historyButtons, recordHistory, applyHistory };
  }
};
var history_default2 = history_default;

// static/app/clipboard.js
var clipboard_default = {
  name: 'clipboard',
  dependencies: [
    '$',
    'api',
    'change',
    'groupNodeIds',
    'inspect',
    'openProject',
    'render',
    'toast',
    'uid'
  ],
  create({
    workspaceState,
    historyState,
    selectionState,
    persistenceState,
    canvasState,
    $,
    api,
    change,
    groupNodeIds,
    inspect,
    openProject,
    render,
    toast,
    uid
  }) {
    function clipboardDocument(doc, selection) {
      const all = selection.size === 0,
        ids = all ? new Set(doc.nodes.map((n) => n.id)) : selection,
        groups = doc.groups
          .filter((g) => all || [...groupNodeIds(g, doc)].some((id) => ids.has(id)))
          .map((g) => ({
            ...g,
            members: g.members.filter((id) => ids.has(id))
          })),
        gids = new Set(groups.map((g) => g.id));
      for (const g of groups) if (!gids.has(g.parent_id)) delete g.parent_id;
      return {
        nodes: structuredClone(doc.nodes.filter((n) => ids.has(n.id))),
        edges: structuredClone(doc.edges.filter((e) => ids.has(e.source) && ids.has(e.target))),
        groups: structuredClone(groups),
        runs: structuredClone(all ? doc.runs : doc.runs.filter((r) => ids.has(r.actor_id))),
        report_notes: all ? doc.report_notes || '' : '',
        preferences: all ? structuredClone(doc.preferences || {}) : {}
      };
    }
    function remapDocument(doc, origin) {
      const result = structuredClone(doc),
        nodes = new Map(result.nodes.map((n) => [n.id, uid()])),
        runs = new Map((result.runs || []).map((r) => [r.id, uid()]));
      for (const n of result.nodes) {
        const old = n.id;
        n.id = nodes.get(old);
        n.evidence = {
          ...n.evidence,
          copied_from: {
            project: origin,
            node: old
          }
        };
        if (n.evidence.source_input && nodes.has(n.evidence.source_input))
          n.evidence.source_input = nodes.get(n.evidence.source_input);
        if (runs.has(n.evidence.run_id)) n.evidence.run_id = runs.get(n.evidence.run_id);
      }
      for (const e of result.edges) {
        e.id = uid();
        e.source = nodes.get(e.source);
        e.target = nodes.get(e.target);
        if (runs.has(e.run_id)) e.run_id = runs.get(e.run_id);
      }
      const groupIds = new Map(result.groups.map((g) => [g.id, uid()]));
      for (const g of result.groups) {
        g.id = groupIds.get(g.id);
        if (g.parent_id) g.parent_id = groupIds.get(g.parent_id);
        g.members = g.members.map((id) => nodes.get(id)).filter(Boolean);
        if (runs.has(g.run_id)) g.run_id = runs.get(g.run_id);
      }
      for (const r of result.runs || []) {
        r.id = runs.get(r.id);
        r.actor_id = nodes.get(r.actor_id) || r.actor_id;
        for (const choice of r.candidates || [])
          choice.input_id = nodes.get(choice.input_id) || choice.input_id;
        for (const key of ['inputs', 'outputs', 'updated_inputs'])
          if (r[key]) r[key] = r[key].map((id) => nodes.get(id) || id);
        for (const n of r.input_snapshot || []) n.id = nodes.get(n.id) || n.id;
      }
      return result;
    }
    function textEditing(target) {
      return Boolean(
        target?.closest('input,textarea,select,[contenteditable]:not([contenteditable=false])')
      );
    }
    function copyGraph(event) {
      if (
        !workspaceState.project ||
        $('workspace').hidden ||
        textEditing(event.target) ||
        document.querySelector('dialog[open]')
      )
        return;
      const documentData = clipboardDocument(
          workspaceState.project.document,
          clipboardSelectionIds()
        ),
        selection = clipboardSelectionIds(),
        payload = {
          format: 'argus-clipboard',
          version: 1,
          kind: selection.size ? 'selection' : 'project',
          title: workspaceState.project.title,
          origin: workspaceState.project.id,
          document: documentData
        },
        text = JSON.stringify(payload, null, 2);
      historyState.internalClipboard = text;
      event.clipboardData.setData('text/plain', text);
      event.clipboardData.setData('application/json', text);
      event.preventDefault();
      toast(
        selectionState.selected.size
          ? selectionState.selected.size + t(' Knoten kopiert.')
          : t('Projekt kopiert.')
      );
    }
    async function pasteGraph(event) {
      clearTimeout(historyState.pendingClipboardPaste);
      if (
        persistenceState.busy ||
        textEditing(event.target) ||
        document.querySelector('dialog[open]')
      )
        return;
      const text = event.clipboardData.getData('text/plain');
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        return;
      }
      if (!['argus-clipboard', 'trace-project'].includes(payload?.format)) return;
      event.preventDefault();
      try {
        const doc = payload.document;
        if (!doc || !['nodes', 'edges', 'groups', 'runs'].every((key) => Array.isArray(doc[key])))
          throw Error(t('Ung\xFCltige Projektdaten in der Zwischenablage.'));
        const imported = remapDocument(doc, payload.origin || payload.title);
        if (!workspaceState.project || $('workspace').hidden) {
          const created = await api('/api/projects', {
            title: (payload.title || t('Eingef\xFCgtes Projekt')) + t(' \xB7 Kopie'),
            document: imported
          });
          await openProject(created.id);
        } else {
          const minX = Math.min(...imported.nodes.map((n) => n.x)),
            minY = Math.min(...imported.nodes.map((n) => n.y));
          const box = $('graph').getBoundingClientRect(),
            x = (box.width / 2 - canvasState.pan.x) / canvasState.pan.scale,
            y = (box.height / 2 - canvasState.pan.y) / canvasState.pan.scale;
          for (const n of imported.nodes) {
            n.x += x - minX;
            n.y += y - minY;
          }
          for (const key of ['nodes', 'edges', 'groups', 'runs'])
            workspaceState.project.document[key].push(...imported[key]);
          selectionState.selected = new Set(imported.nodes.map((n) => n.id));
          change();
          render();
          inspect();
        }
        toast(imported.nodes.length + t(' Knoten eingef\xFCgt.'));
      } catch (error) {
        toast(error.message);
      }
    }
    function graphClipboardText() {
      const selection = clipboardSelectionIds(),
        doc = clipboardDocument(workspaceState.project.document, selection);
      return JSON.stringify(
        {
          format: 'argus-clipboard',
          version: 1,
          kind: selection.size ? 'selection' : 'project',
          title: workspaceState.project.title,
          origin: workspaceState.project.id,
          document: doc
        },
        null,
        2
      );
    }
    function clipboardSelectionIds() {
      const ids = new Set(selectionState.selected);
      for (const id of selectionState.selectedGroups.size
        ? selectionState.selectedGroups
        : selectionState.selectedGroup
          ? [selectionState.selectedGroup]
          : []) {
        const group = workspaceState.project.document.groups.find((g) => g.id === id);
        if (group) for (const node of groupNodeIds(group)) ids.add(node);
      }
      return ids;
    }
    return {
      clipboardDocument,
      remapDocument,
      textEditing,
      copyGraph,
      pasteGraph,
      graphClipboardText,
      clipboardSelectionIds
    };
  }
};
var clipboard_default2 = clipboard_default;

// static/app/catalogue.js
var catalogue_default = {
  name: 'catalogue',
  dependencies: ['api', 'providerSearchKey', 'renderPalette'],
  create({
    pluginsState,
    workspaceState,
    preferencesState,
    api,
    providerSearchKey,
    renderPalette
  }) {
    async function refreshCatalog() {
      const [info, providers] = await Promise.all([api('/api/plugins'), api('/api/providers')]);
      pluginsState.providerCatalogue = providers.providers || [];
      pluginsState.providerIndex = new Map(
        pluginsState.providerCatalogue.flatMap((p) =>
          [p.id, p.name, ...p.aliases].map((name) => [providerSearchKey(name), p])
        )
      );
      pluginsState.catalog = info.plugins;
      pluginsState.dataPlugins =
        info.data_plugins || pluginsState.catalog.filter((p) => p.nodes?.length);
      pluginsState.dataTypes = /* @__PURE__ */ new Map();
      for (const plugin of pluginsState.dataPlugins)
        for (const node of plugin.nodes || [])
          pluginsState.dataTypes.set(node.type, {
            plugin,
            node,
            installed: pluginsState.catalog.some((p) => p.id === plugin.id)
          });
      for (const [type, defaults] of Object.entries(info.node_defaults || {}))
        workspaceState.templates[type] = structuredClone(defaults);
      preferencesState.appSettings.node_display_defaults =
        info.node_display_defaults || preferencesState.appSettings.node_display_defaults || {};
      if (workspaceState.project) renderPalette();
    }
    function pluginText(plugin, key) {
      const localized = plugin?.translations?.[language]?.[key];
      if (localized !== void 0) return localized;
      const common = t(key);
      if (common !== key) return common;
      return (
        plugin?.translations?.en?.[key] ??
        plugin?.translations?.[plugin.default_language || 'de']?.[key] ??
        diagnostic(common)
      );
    }
    function nodePlugin(type) {
      return pluginsState.dataTypes.get(type)?.plugin;
    }
    function dataLabel(type) {
      const entry = pluginsState.dataTypes.get(type);
      return entry ? pluginText(entry.plugin, entry.node.name) : t(nodeLabels[type] || type);
    }
    function nodeTitle(node) {
      if (node.evidence?.label_key)
        return pluginText(nodePlugin(node.type), node.evidence.label_key);
      if (node.evidence?.origin === 'manual') return node.label;
      return pluginText(
        pluginsState.catalog.find((p) => p.id === node.evidence?.plugin) || nodePlugin(node.type),
        node.label
      );
    }
    function pluginDisplayName(plugin) {
      return pluginText(
        plugin,
        plugin.actions?.length === 1 ? plugin.actions[0].name : plugin.name
      );
    }
    function sourceLabel(key) {
      return (
        {
          consensus: 'Consensus',
          argus: 'Argus Web',
          sherlock: 'Sherlock',
          maigret: 'Maigret',
          holehe: 'Holehe',
          user_scanner: 'User Scanner',
          blackbird: 'Blackbird',
          phoneinfoga: 'PhoneInfoga',
          ignorant: 'Ignorant',
          toutatis: 'Toutatis',
          photon: 'Photon',
          nominatim: 'Nominatim'
        }[key] || key
      );
    }
    function newNodeLabel(type) {
      const entry = pluginsState.dataTypes.get(type);
      if (entry) return pluginText(entry.plugin, entry.node.new_label || entry.node.name);
      return t(
        {
          email: 'Neue E-Mail',
          phone: 'Neue Telefonnummer',
          url: 'Neue URL',
          username: 'Neuer Benutzername',
          value: 'Neuer Wert',
          note: 'Neue Notiz',
          location: 'Neuer Ort',
          datetime: 'Neues Datum / Zeit',
          image: 'Neues Bild',
          file: 'Neue Datei'
        }[type] || 'Neue Information'
      );
    }
    function actorTitle(node) {
      const plugin = pluginsState.catalog.find((p) => p.id === node.data.plugin);
      return pluginText(
        plugin,
        plugin?.actions.find((a) => a.id === node.data.action)?.name || node.label
      );
    }
    return {
      refreshCatalog,
      pluginText,
      nodePlugin,
      dataLabel,
      nodeTitle,
      pluginDisplayName,
      sourceLabel,
      newNodeLabel,
      actorTitle
    };
  }
};
var catalogue_default2 = catalogue_default;

// static/app/plugin-sources.js
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
          const initial2 =
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
            initial2,
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
        controls2 = [];
      form.append(el('h3', {}, pluginText(plugin, node.name)));
      const presets = el('section', { class: 'plugin-default-section' });
      presets.append(
        el('h4', {}, t('Standardwerte f\xFCr neue Daten-Nodes')),
        el(
          'p',
          { class: 'source-help' },
          t('Diese Anzeigeoptionen kannst du sp\xE4ter in den Knotendetails \xE4ndern.')
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
        controls2.push({
          key,
          control
        });
      }
      if (!controls2.length) presets.remove();
      const configuration = el('section', { class: 'plugin-config-section' });
      const mapReaders = {};
      if (node.type === 'location') {
        configuration.append(
          el('h4', {}, t('Plugin-Einstellungen')),
          el(
            'p',
            { class: 'source-help' },
            t('Gilt f\xFCr das gesamte Plugin, zum Beispiel Zugangsdaten und Quellenkonfiguration.')
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
      if (!controls2.length && !Object.keys(mapReaders).length)
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
        display_defaults: Object.fromEntries(controls2.map((c) => [c.key, c.control.checked])),
        ...Object.fromEntries(Object.entries(mapReaders).map(([key, read]) => [key, read()]))
      });
    }
    return { providerFieldKeys, sourceOrderControl, mapSourcesControl, dataPluginSettings };
  }
};
var plugin_sources_default2 = plugin_sources_default;

// static/app/plugin-settings.js
var plugin_settings_default = {
  name: 'plugin-settings',
  dependencies: [
    '$',
    'api',
    'applyFields',
    'button',
    'dataPluginSettings',
    'editFields',
    'el',
    'iconActionButton',
    'leaveWorkspace',
    'parameterModal',
    'pluginDisplayName',
    'pluginText',
    'providerFieldKeys',
    'refreshCatalog',
    'saveIndicator',
    'searchText',
    'show',
    'sourceOrderControl',
    'toast',
    'updateStatus'
  ],
  create({
    pluginsState,
    preferencesState,
    $,
    api,
    applyFields,
    button,
    dataPluginSettings,
    editFields,
    el,
    iconActionButton,
    leaveWorkspace,
    parameterModal,
    pluginDisplayName,
    pluginText,
    providerFieldKeys,
    refreshCatalog,
    saveIndicator,
    searchText,
    show,
    sourceOrderControl,
    toast,
    updateStatus
  }) {
    async function pluginsHome() {
      await leaveWorkspace();
      show('pluginsView');
      await refreshCatalog();
      renderInstalled();
    }
    function renderInstalled() {
      const root = $('pluginList');
      root.replaceChildren();
      const query = searchText($('pluginSearch').value),
        sections = /* @__PURE__ */ new Map();
      for (const plugin of pluginsState.catalog.filter((p) =>
        searchText(
          pluginDisplayName(p) +
            ' ' +
            p.name +
            ' ' +
            p.id +
            ' ' +
            pluginText(p, p.description || '')
        ).includes(query)
      )) {
        const row = el('article', {
            class: 'plugin-row',
            'data-plugin-row': plugin.id
          }),
          header = el('div', {
            class: 'plugin-header'
          }),
          copy = el('div', {
            class: 'plugin-copy'
          });
        copy.append(
          el('strong', {}, pluginDisplayName(plugin)),
          el(
            'p',
            {
              title: pluginText(plugin, plugin.description || '')
            },
            pluginText(plugin, plugin.description || '')
          )
        );
        let model = pluginsState.activePluginForms.get(plugin.id);
        if (
          model &&
          model.language !== language &&
          !pluginsState.pendingPluginDirty.has(plugin.id) &&
          !pluginsState.pendingPluginSaves.has(plugin.id)
        ) {
          pluginsState.activePluginForms.delete(plugin.id);
          model = null;
        }
        let form = model?.form;
        if (!form) {
          form = el('form', {
            class: 'plugin-settings'
          });
          form.id = 'plugin-settings-' + plugin.id;
          const indicator = el('span', {
              class: 'save-indicator'
            }),
            defaults = {},
            nodes = {};
          model = {
            form,
            indicator,
            defaults,
            nodes,
            version: 0,
            settings: plugin.settings,
            language
          };
          pluginsState.activePluginForms.set(plugin.id, model);
          const changed = () => {
            model.version++;
            pluginsState.pendingPluginDirty.add(plugin.id);
            saveIndicator(indicator, 'pending');
            clearTimeout(pluginsState.pendingPluginTimers.get(plugin.id));
            pluginsState.pendingPluginTimers.set(
              plugin.id,
              setTimeout(() => persistPluginForm(plugin.id), 500)
            );
          };
          form.append(el('small', {}, plugin.id + ' \xB7 ' + (plugin.version || '')));
          for (const node of plugin.nodes || [])
            nodes[node.type] = dataPluginSettings(form, plugin, node, changed);
          for (const action of plugin.actions || []) {
            form.append(el('h3', {}, pluginText(plugin, action.name)));
            const parameters = structuredClone(action.default_params || {});
            delete parameters.code;
            const actual = el('section', { class: 'plugin-config-section' }),
              preset = el('section', { class: 'plugin-default-section' });
            actual.append(
              el('h4', {}, t('Plugin-Einstellungen')),
              el(
                'p',
                { class: 'source-help' },
                t(
                  'Gilt f\xC3\xBCr das gesamte Plugin, zum Beispiel Zugangsdaten und Quellenkonfiguration.'
                )
              )
            );
            preset.append(
              el('h4', {}, t('Standardwerte f\xC3\xBCr neue Tools')),
              el(
                'p',
                { class: 'source-help' },
                t(
                  'Diese Werte kannst du sp\xC3\xA4ter f\xC3\xBCr jedes Tool in den Knotendetails \xC3\xA4ndern.'
                )
              )
            );
            form.append(actual, preset);
            const sourceReader = sourceOrderControl(actual, parameters, changed, {
              profileCatalog: action.research_profiles,
              profileContainer: preset,
              translate: (key) => pluginText(plugin, key)
            });
            const data = Object.fromEntries(
              Object.entries(parameters).filter(
                ([key]) =>
                  !key.startsWith('use_') &&
                  key !== 'source_order' &&
                  key !== 'search_profiles' &&
                  !providerFieldKeys(parameters).includes(key)
              )
            );
            const settingsOnly = new Set(action.settings_only || []);
            const isSetting = (key) =>
              settingsOnly.has(key) ||
              action.parameter_schema?.[key]?.secret === true ||
              /(password|token|secret|api_key|sessionid)$/.test(key);
            const readers = [];
            for (const [container, fields] of [
              [actual, Object.fromEntries(Object.entries(data).filter(([key]) => isSetting(key)))],
              [preset, Object.fromEntries(Object.entries(data).filter(([key]) => !isSetting(key)))]
            ]) {
              readers.push(
                ...editFields(container, fields, [], (key) => pluginText(plugin, key), {
                  schema: action.parameter_schema,
                  sections: action.parameter_sections,
                  help: action.parameter_help
                })
              );
            }
            if (actual.children.length === 2) actual.remove();
            if (preset.children.length === 2) preset.remove();
            defaults[action.id] = {
              data,
              readers,
              sourceReader
            };
          }
          if (plugin.connection_action)
            form.append(
              iconActionButton(
                pluginText(plugin, plugin.connection_action.label),
                () => connectPlugin(plugin),
                'play',
                'primary wide'
              )
            );
          form.append(indicator);
          saveIndicator(indicator, 'saved');
          form.addEventListener('input', changed);
          form.addEventListener('change', changed);
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            persistPluginForm(plugin.id);
          });
        }
        form.hidden = !pluginsState.pluginSettingsOpen.has(plugin.id);
        const expand = button(
          form.hidden ? '\u25B8' : '\u25BE',
          () => {
            form.hidden = !form.hidden;
            if (form.hidden) pluginsState.pluginSettingsOpen.delete(plugin.id);
            else pluginsState.pluginSettingsOpen.add(plugin.id);
            expand.replaceChildren(icon(form.hidden ? 'chevron-right' : 'chevron-down'));
            expand.setAttribute('aria-expanded', String(!form.hidden));
          },
          'plugin-expand'
        );
        expand.replaceChildren(icon(form.hidden ? 'chevron-right' : 'chevron-down'));
        expand.setAttribute('aria-label', t('Plugin-Einstellungen'));
        expand.setAttribute('aria-expanded', String(!form.hidden));
        expand.setAttribute('aria-controls', form.id);
        const remove = button(
          t('Entfernen'),
          async () => {
            if (pluginsState.pendingPluginDirty.has(plugin.id)) await persistPluginForm(plugin.id);
            if (pluginsState.pendingPluginSaves.has(plugin.id))
              throw Error(t('Bitte das Speichern abwarten.'));
            clearTimeout(pluginsState.pendingPluginTimers.get(plugin.id));
            await api('/api/plugin/remove', {
              id: plugin.id
            });
            pluginsState.activePluginForms.delete(plugin.id);
            pluginsState.pendingPluginDirty.delete(plugin.id);
            await refreshCatalog();
            renderInstalled();
          },
          'danger-filled'
        );
        header.append(expand, copy, remove);
        row.append(header, form);
        const category = plugin.actions?.length ? 'Aktoren' : 'Daten-Nodes';
        if (!sections.has(category)) {
          const section = el('section', {
            class: 'installed-plugin-section',
            'data-plugin-kind': category === 'Aktoren' ? 'actor' : 'data'
          });
          section.append(el('h2', {}, t(category)));
          const list = el('div', {
            class: 'installed-plugin-items'
          });
          section.append(list);
          sections.set(category, {
            section,
            list
          });
        }
        sections.get(category).list.append(row);
      }
      for (const category of ['Daten-Nodes', 'Aktoren'])
        if (sections.has(category)) root.append(sections.get(category).section);
      if (!root.children.length)
        root.append(el('p', {}, t('Keine passenden Plugins installiert.')));
    }
    async function persistPluginForm(id) {
      const model = pluginsState.activePluginForms.get(id);
      if (
        !model ||
        !pluginsState.pendingPluginDirty.has(id) ||
        pluginsState.pendingPluginSaves.has(id)
      )
        return;
      clearTimeout(pluginsState.pendingPluginTimers.get(id));
      pluginsState.pendingPluginSaves.add(id);
      const version = model.version;
      saveIndicator(model.indicator, 'saving');
      preferencesState.settingsError = '';
      updateStatus();
      let failed = false;
      try {
        const settings = {
          ...model.settings,
          defaults: {},
          nodes: {
            ...(model.settings?.nodes || {})
          }
        };
        for (const [type, read] of Object.entries(model.nodes || {})) settings.nodes[type] = read();
        for (const [action, item] of Object.entries(model.defaults))
          settings.defaults[action] = {
            ...applyFields(item.data, item.readers),
            ...(item.sourceReader ? item.sourceReader() : {})
          };
        await api('/api/plugin/settings', {
          id,
          settings
        });
        model.settings = settings;
        if (version === model.version) pluginsState.pendingPluginDirty.delete(id);
        await refreshCatalog();
        if (version === model.version) {
          const stored = pluginsState.catalog.find((plugin) => plugin.id === id);
          model.settings = stored?.settings || model.settings;
          for (const [actionId, form] of Object.entries(model.defaults)) {
            const defaults =
              stored?.actions.find((action) => action.id === actionId)?.default_params || {};
            for (const field of form.readers)
              if (field.control.type === 'password') {
                const key = field.path.at(-1);
                form.data[key] = defaults[key] || '';
              }
          }
        }
        saveIndicator(
          model.indicator,
          pluginsState.pendingPluginDirty.has(id) ? 'pending' : 'saved'
        );
      } catch (error) {
        failed = true;
        preferencesState.settingsError = error.message;
        saveIndicator(model.indicator, 'error', error.message);
      } finally {
        pluginsState.pendingPluginSaves.delete(id);
        updateStatus();
        if (pluginsState.pendingPluginDirty.has(id))
          pluginsState.pendingPluginTimers.set(
            id,
            setTimeout(() => persistPluginForm(id), failed ? 5e3 : 500)
          );
      }
    }
    async function openPluginSettings(id) {
      pluginsState.pluginSettingsOpen.add(id);
      await pluginsHome();
      document.querySelector('[data-plugin-row="' + CSS.escape(id) + '"]')?.scrollIntoView({
        block: 'center',
        behavior: 'smooth'
      });
    }
    async function connectPlugin(plugin) {
      const model = pluginsState.activePluginForms.get(plugin.id);
      if (model?.connecting) return;
      const control = model?.form.querySelector('button.primary.wide');
      if (model) model.connecting = true;
      const originalIcon = control?.querySelector('.ui-icon')?.cloneNode(true);
      if (control) {
        control.querySelector('.ui-icon')?.replaceWith(icon('spinner'));
        control.disabled = true;
        control.classList.add('connection-pending');
        control.setAttribute('aria-busy', 'true');
      }
      try {
        await performConnection(plugin);
      } finally {
        if (model) model.connecting = false;
        if (control) {
          if (originalIcon) control.querySelector('.ui-icon')?.replaceWith(originalIcon);
          control.disabled = false;
          control.classList.remove('connection-pending');
          control.removeAttribute('aria-busy');
        }
      }
    }
    async function performConnection(plugin) {
      if (pluginsState.pendingPluginDirty.has(plugin.id)) await persistPluginForm(plugin.id);
      if (
        pluginsState.pendingPluginDirty.has(plugin.id) ||
        pluginsState.pendingPluginSaves.has(plugin.id)
      )
        throw Error(t('Bitte das Speichern abwarten.'));
      let transient = {};
      for (let attempt = 0; attempt < 4; attempt++) {
        const submitted = await api('/api/plugin/connection', {
          request_key: Array.from(crypto.getRandomValues(new Uint8Array(24)), (n) =>
            n.toString(16).padStart(2, '0')
          ).join(''),
          id: plugin.id,
          action: plugin.connection_action.id,
          transient
        });
        const job = await pollJob(submitted.id);
        if (job.state !== 'completed')
          throw Error(t('errors.' + (job.error_code || 'execution_interrupted')));
        const result = job.result;
        if (result.input_request) {
          const values = await parameterModal(result.input_request, {});
          if (values === null) return;
          transient = values;
          continue;
        }
        if (!result.authenticated)
          throw Error((result.warnings || []).join(' \xB7 ') || t('Anmeldung fehlgeschlagen.'));
        toast(t('Instagram-Anmeldung erfolgreich.'));
        await refreshCatalog();
        return;
      }
      throw Error(t('Zu viele aufeinanderfolgende Eingabeanforderungen.'));
    }
    return { pluginsHome, renderInstalled, persistPluginForm, openPluginSettings, connectPlugin };
  }
};
var plugin_settings_default2 = plugin_settings_default;

// static/app/plugin-library.js
var plugin_library_default = {
  name: 'plugin-library',
  dependencies: [
    '$',
    'api',
    'askConfirm',
    'button',
    'el',
    'pluginDisplayName',
    'pluginText',
    'refreshCatalog',
    'renderInstalled',
    'searchText'
  ],
  create({
    pluginsState,
    $,
    api,
    askConfirm,
    button,
    el,
    pluginDisplayName,
    pluginText,
    refreshCatalog,
    renderInstalled,
    searchText
  }) {
    async function refreshLibrary() {
      const info = await api('/api/plugin-library');
      pluginsState.libraryItems = info.plugins;
      pluginsState.repositories = info.repositories;
    }
    async function openLibrary() {
      await refreshLibrary();
      renderLibrary();
      $('libraryDialog').showModal();
    }
    function renderLibrary() {
      const root = $('libraryList');
      root.replaceChildren();
      const query = searchText($('librarySearch').value);
      for (const plugin of pluginsState.libraryItems.filter((p) =>
        searchText(
          t(p.name) + ' ' + p.name + ' ' + p.id + ' ' + pluginText(p, p.description || '')
        ).includes(query)
      )) {
        const row = el('article', {
          class: 'plugin-row'
        });
        row.append(
          el('h3', {}, pluginDisplayName(plugin)),
          el('p', {}, pluginText(plugin, plugin.description || '')),
          el('small', {}, plugin.origin === 'builtin' ? t('Mitgeliefert') : t('Community'))
        );
        const install = button(
          plugin.installed ? t('Installiert') : t('Installieren'),
          async () => {
            if (plugin.origin === 'community') {
              const accepted = await askConfirm(
                t('Community-Plugin installieren'),
                t(
                  'Der Python-Code dieses Repositories wird im Argus-Container ausgef\xFChrt. Nur vertrauensw\xFCrdige Repositories installieren.'
                )
              );
              if (!accepted) return;
            }
            install.disabled = true;
            install.setAttribute('aria-busy', 'true');
            install.textContent = t('Wird installiert \u2026');
            try {
              await api('/api/plugin/install', {
                id: plugin.id
              });
              await refreshCatalog();
              await refreshLibrary();
              renderLibrary();
              renderInstalled();
            } finally {
              install.disabled = false;
              install.removeAttribute('aria-busy');
              if (install.isConnected) install.textContent = t('Installieren');
            }
          },
          'primary'
        );
        install.disabled = plugin.installed;
        row.append(install);
        root.append(row);
      }
      if (!root.children.length)
        root.append(el('p', { class: 'empty-state' }, t('Keine passenden Plugins gefunden.')));
    }
    async function openRepositories() {
      await refreshLibrary();
      renderRepositories();
      $('reposDialog').showModal();
    }
    function renderRepositories() {
      const root = $('repoList');
      root.replaceChildren();
      for (const repo of pluginsState.repositories) {
        const row = el('article', {
          class: 'plugin-row'
        });
        row.append(
          el('strong', {}, repo.url),
          el('p', {}, t(repo.error) || repo.manifest.plugins.length + t(' Plugins'))
        );
        row.append(
          button(t('Aktualisieren'), async () => {
            await api('/api/repositories/refresh', {
              id: repo.id
            });
            await refreshLibrary();
            renderRepositories();
            renderLibrary();
          }),
          button(
            t('Entfernen'),
            async () => {
              await api('/api/repositories/remove', {
                id: repo.id
              });
              await refreshLibrary();
              renderRepositories();
              renderLibrary();
            },
            'danger-filled'
          )
        );
        root.append(row);
      }
      if (!pluginsState.repositories.length)
        root.append(el('p', {}, t('Noch keine Community-Repositories hinzugef\xFCgt.')));
    }
    return { refreshLibrary, openLibrary, renderLibrary, openRepositories, renderRepositories };
  }
};
var plugin_library_default2 = plugin_library_default;

// static/system-logs.js
function systemLogs(container, { api, el, iconActionButton, toast }) {
  clearTimeout(container.logTimer);
  container.replaceChildren();
  container.append(el('h2', {}, t('Systemlogs')));
  const search = el('input', {
    type: 'search',
    placeholder: t('Systemlogs durchsuchen'),
    'aria-label': t('Systemlogs durchsuchen')
  });
  const limit = el('input', {
    type: 'number',
    min: 0,
    step: 1,
    value: 0,
    'aria-label': t('Exportzeilen (0 = alle)')
  });
  const output = el('pre', { class: 'system-log-lines', tabindex: 0 });
  const status = el('p', { role: 'status' });
  const more = iconActionButton(t('Weitere laden'), () => load(true), 'plus');
  let offset = 0,
    generation = 0,
    timer,
    loading = false;
  const automatic = el('input', { type: 'checkbox' });
  const follow = el('input', { type: 'checkbox' });
  automatic.checked = localStorage.getItem('argus.logs.autoRefresh') === 'true';
  follow.checked = localStorage.getItem('argus.logs.autoScroll') !== 'false';
  const options = el('div', { class: 'system-log-options' });
  for (const [input, text, key] of [
    [automatic, 'Automatisch aktualisieren', 'autoRefresh'],
    [follow, 'Automatisch nach unten scrollen', 'autoScroll']
  ]) {
    const label = el('label', { class: 'checkbox-label' });
    label.append(input, document.createTextNode(t(text)));
    input.addEventListener('change', () => {
      localStorage.setItem('argus.logs.' + key, String(input.checked));
      if (input === follow && follow.checked) output.scrollTop = output.scrollHeight;
    });
    options.append(label);
  }
  async function load(append = false) {
    if (loading) return;
    loading = true;
    const revision = ++generation;
    try {
      const data = await api(
        '/api/system-logs?q=' +
          encodeURIComponent(search.value) +
          '&offset=' +
          (append ? offset : 0)
      );
      if (revision !== generation || !container.isConnected) return;
      const lines = [...(data.lines || [])]
        .reverse()
        .map((row) => row.text)
        .join('\n');
      const oldTop = output.scrollTop,
        oldHeight = output.scrollHeight;
      if (append) output.textContent = lines + '\n' + output.textContent;
      else output.textContent = lines;
      if (append) output.scrollTop = oldTop + output.scrollHeight - oldHeight;
      else if (follow.checked) output.scrollTop = output.scrollHeight;
      else output.scrollTop = oldTop;
      offset = (append ? offset : 0) + (data.lines || []).length;
      status.textContent = t('Logzeilen: {count}', { count: data.total || 0 });
      more.hidden = offset >= (data.total || 0);
    } catch (error) {
      toast(error.message);
    } finally {
      loading = false;
    }
  }
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => load(), 200);
  });
  const exportButton = iconActionButton(
    t('Exportieren'),
    () => {
      if (!limit.checkValidity()) {
        limit.reportValidity();
        return;
      }
      const link = el('a', {
        href:
          '/api/system-logs/export?q=' +
          encodeURIComponent(search.value) +
          '&limit=' +
          (Number(limit.value) || 0),
        download: 'argus-system-logs.txt'
      });
      link.click();
    },
    'download'
  );
  const clear = iconActionButton(
    t('Systemlogs leeren'),
    async () => {
      try {
        await api('/api/system-logs/clear', {});
        await load();
      } catch (error) {
        toast(error.message);
      }
    },
    'trash',
    'danger-filled'
  );
  const controls2 = el('div', { class: 'system-log-controls' });
  const exportLabel = el('label', {}, t('Exportzeilen (0 = alle)'));
  exportLabel.append(limit);
  controls2.append(
    search,
    iconActionButton(t('Aktualisieren'), () => load(), 'refresh'),
    exportLabel,
    exportButton,
    clear
  );
  container.append(controls2, options, status, output, more);
  load();
  const refresh = async () => {
    if (!container.isConnected) return;
    if (automatic.checked && !document.hidden && !container.closest('main')?.hidden) await load();
    container.logTimer = setTimeout(refresh, 5e3);
  };
  container.logTimer = setTimeout(refresh, 5e3);
}

// static/vpn-settings.js
async function vpnSettings(container, { api, el, iconActionButton, toast }) {
  clearInterval(container.vpnTimer);
  container.replaceChildren(el('h2', {}, t('VPN')));
  let settings = {
      enabled: false,
      profiles: [],
      rotation_enabled: false,
      rotation_mode: 'interval',
      interval_seconds: 900
    },
    status = {},
    saving = false;
  const state = el('span', { class: 'vpn-state', role: 'status' });
  const hint = el('p', { class: 'source-help' });
  const enabled = el('input', { type: 'checkbox' });
  const rotation = el('input', { type: 'checkbox' });
  const mode = el('select', { 'aria-label': t('VPN-Rotation') });
  mode.append(
    el('option', { value: 'interval' }, t('Nach Zeitintervall')),
    el('option', { value: 'actor' }, t('Nach jedem Tool'))
  );
  const interval = el('input', {
    type: 'number',
    min: 1,
    max: 1440,
    step: 1,
    'aria-label': t('Intervall in Minuten')
  });
  const list = el('div', { class: 'vpn-profiles' });
  const check = (input, text) => {
    const label = el('label', { class: 'checkbox-label' });
    label.append(input, document.createTextNode(t(text)));
    return label;
  };
  const controls2 = el('div', { class: 'vpn-controls' });
  const intervalLabel = el('label', {}, t('Intervall in Minuten'));
  intervalLabel.append(interval);
  const rotate = iconActionButton(
    t('VPN jetzt wechseln'),
    async () => {
      try {
        const data = await api('/api/vpn/rotate', {});
        apply(data);
      } catch (error) {
        toast(error.message);
      }
    },
    'refresh'
  );
  controls2.append(
    check(enabled, 'VPN verwenden'),
    check(rotation, 'Rotation aktivieren'),
    mode,
    intervalLabel,
    rotate
  );
  container.append(state, hint, controls2, list);
  function renderStatus() {
    const labels = {
      connected: 'VPN verbunden',
      connecting: 'VPN wird verbunden',
      unhealthy: 'Kein VPN-Profil erreichbar',
      disabled: 'VPN aus',
      disabling: 'VPN wird deaktiviert'
    };
    const label = status.available
      ? t(labels[status.state] || 'VPN wird verbunden')
      : t('VPN nicht verf\xFCgbar: Container-Netzwerkrechte pr\xFCfen');
    state.replaceChildren(
      document.createTextNode(label + (status.active?.name ? ' \xB7 ' + status.active.name : '')),
      el('i', { class: status.connected ? 'connected' : settings.enabled ? 'warning' : '' })
    );
    hint.textContent = status.available
      ? t('W\xE4hrend eines VPN-Wechsels warten Tools auf die n\xE4chste gepr\xFCfte Verbindung.')
      : t(
          'VPN ist im Image enthalten. Ben\xF6tigt werden NET_ADMIN und das TUN-Ger\xE4t im Container.'
        );
    enabled.disabled = saving || !status.available;
    rotate.disabled = saving || !settings.enabled || !status.available;
  }
  function apply(data) {
    if (data.settings) settings = data.settings;
    status = data.status || status;
    enabled.checked = settings.enabled;
    rotation.checked = settings.rotation_enabled;
    mode.value = settings.rotation_mode;
    interval.value = settings.interval_seconds / 60;
    mode.disabled = saving || !settings.rotation_enabled;
    interval.disabled =
      saving || !settings.rotation_enabled || settings.rotation_mode !== 'interval';
    rotation.disabled = saving;
    list.replaceChildren();
    for (const [index, profile] of (settings.profiles || []).entries()) {
      const row = el('div', { class: 'vpn-profile' });
      const header = el('div', { class: 'vpn-profile-header' });
      const grip = iconActionButton(t('Profil verschieben'), () => {}, 'drag', 'source-drag');
      grip.replaceChildren(icon('drag'));
      grip.setAttribute('aria-label', t('Profil verschieben'));
      grip.draggable = true;
      grip.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('application/x-argus-vpn', profile.id);
        event.dataTransfer.effectAllowed = 'move';
      });
      grip.addEventListener('keydown', (event) => {
        const direction = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
        if (!direction || index + direction < 0 || index + direction >= settings.profiles.length)
          return;
        event.preventDefault();
        const profiles = [...settings.profiles];
        profiles.splice(index + direction, 0, profiles.splice(index, 1)[0]);
        save({ profiles });
      });
      row.addEventListener('dragover', (event) => event.preventDefault());
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const from = settings.profiles.findIndex(
          (p) => p.id === event.dataTransfer.getData('application/x-argus-vpn')
        );
        if (from < 0 || from === index) return;
        const profiles = [...settings.profiles];
        profiles.splice(index, 0, profiles.splice(from, 1)[0]);
        save({ profiles });
      });
      const body = el('div', { class: 'vpn-profile-body', hidden: '' });
      const nameInput = el('input', {
        value: profile.name,
        maxlength: 80,
        'aria-label': t('Profilname')
      });
      nameInput.addEventListener('change', () =>
        save({
          profiles: settings.profiles.map((p) =>
            p.id === profile.id ? { ...p, name: nameInput.value } : p
          )
        })
      );
      body.append(
        el('label', {}, t('Profilname')),
        nameInput,
        el(
          'p',
          { class: 'source-help' },
          t(
            'Zugangsdaten werden verschl\xFCsselt gespeichert. Zum Ersetzen das Profil entfernen und neu hinzuf\xFCgen.'
          )
        )
      );
      const expand = iconActionButton(
        t('Profil aufklappen'),
        () => {
          body.hidden = !body.hidden;
          expand.setAttribute('aria-expanded', String(!body.hidden));
          expand.replaceChildren(icon(body.hidden ? 'chevron-down' : 'chevron-up'));
        },
        'chevron-down',
        'source-expand'
      );
      expand.setAttribute('aria-expanded', 'false');
      expand.replaceChildren(icon('chevron-down'));
      expand.setAttribute('aria-label', t('Profil aufklappen'));
      const remove = iconActionButton(
        t('Profil entfernen'),
        () => save({ profiles: settings.profiles.filter((p) => p.id !== profile.id) }),
        'trash',
        'danger-filled'
      );
      remove.replaceChildren(icon('trash'));
      remove.setAttribute('aria-label', t('Profil entfernen'));
      remove.title = t('Profil entfernen');
      header.append(
        expand,
        grip,
        icon('vpn'),
        el('strong', {}, profile.name),
        el('span', { class: 'tag' }, profile.type === 'wireguard' ? 'WireGuard' : 'OpenVPN'),
        remove
      );
      row.append(header, body);
      list.append(row);
    }
    renderStatus();
  }
  async function save(changes) {
    if (saving) return;
    saving = true;
    renderStatus();
    try {
      apply(await api('/api/vpn', { ...settings, ...changes }));
    } catch (error) {
      toast(error.message);
      try {
        apply(await api('/api/vpn'));
      } catch {}
    } finally {
      saving = false;
      apply({});
    }
  }
  enabled.addEventListener('change', () => save({ enabled: enabled.checked }));
  rotation.addEventListener('change', () => save({ rotation_enabled: rotation.checked }));
  mode.addEventListener('change', () => save({ rotation_mode: mode.value }));
  interval.addEventListener('change', () => {
    if (interval.checkValidity()) save({ interval_seconds: Number(interval.value) * 60 });
    else interval.reportValidity();
  });
  const add = el('section', { class: 'vpn-add' });
  const form = el('form');
  form.hidden = true;
  const addButton = iconActionButton(
    t('VPN-Profil hinzuf\xFCgen'),
    () => {
      form.hidden = !form.hidden;
      addButton.setAttribute('aria-expanded', String(!form.hidden));
      if (!form.hidden) name.focus();
    },
    'plus',
    'primary'
  );
  add.append(addButton);
  const name = el('input', { required: '', maxlength: 80, 'aria-label': t('Profilname') });
  const type = el('select', { 'aria-label': t('VPN-Typ') });
  type.append(
    el('option', { value: 'openvpn' }, 'OpenVPN'),
    el('option', { value: 'wireguard' }, 'WireGuard')
  );
  const config = el('textarea', {
    rows: 9,
    required: '',
    maxlength: 131072,
    spellcheck: false,
    autocomplete: 'off',
    'aria-label': t('VPN-Profil')
  });
  const file = el('input', {
    type: 'file',
    accept: '.ovpn,.conf,.txt',
    'aria-label': t('Profildatei importieren')
  });
  file.addEventListener('change', async () => {
    const chosen = file.files[0];
    if (!chosen) return;
    if (chosen.size > 131072) {
      toast(t('Profildatei zu gro\xDF.'));
      return;
    }
    config.value = await chosen.text();
    if (!name.value) name.value = chosen.name.replace(/\.[^.]+$/, '');
    if (chosen.name.endsWith('.ovpn')) type.value = 'openvpn';
    else if (config.value.includes('[Interface]')) type.value = 'wireguard';
  });
  const username = el('input', {
    autocomplete: 'off',
    'aria-label': t('VPN-Benutzername (optional)')
  });
  const password = el('input', {
    type: 'password',
    autocomplete: 'new-password',
    'aria-label': t('VPN-Passwort (optional)')
  });
  for (const [label, input] of [
    ['Profilname', name],
    ['VPN-Typ', type],
    ['Profildatei importieren', file],
    ['VPN-Profil', config],
    ['VPN-Benutzername (optional)', username],
    ['VPN-Passwort (optional)', password]
  ]) {
    const field = el('label', {}, t(label));
    field.append(input);
    form.append(field);
  }
  const submit = el('button', { type: 'submit', class: 'primary' }, t('Profil speichern'));
  form.append(submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    submit.disabled = true;
    const previous = settings.profiles.length;
    await save({
      profiles: [
        ...settings.profiles,
        {
          name: name.value,
          type: type.value,
          config: config.value,
          username: username.value,
          password: password.value
        }
      ]
    });
    if (settings.profiles.length > previous) {
      form.reset();
      form.hidden = true;
      addButton.setAttribute('aria-expanded', 'false');
    }
    submit.disabled = false;
  });
  add.append(form);
  container.append(add);
  try {
    apply(await api('/api/vpn'));
  } catch (error) {
    toast(error.message);
    renderStatus();
  }
  container.vpnTimer = setInterval(async () => {
    if (!container.isConnected || container.closest('main')?.hidden || document.hidden || saving)
      return;
    try {
      const data = await api('/api/vpn');
      status = data.status || {};
      renderStatus();
    } catch {
      status = {};
      renderStatus();
    }
  }, 1e4);
}

// static/app/settings.js
var settings_default = {
  name: 'settings',
  dependencies: [
    '$',
    'api',
    'askText',
    'el',
    'iconActionButton',
    'leaveWorkspace',
    'renderProjects',
    'saveIndicator',
    'show',
    'toast',
    'uid',
    'updateStatus'
  ],
  create({
    preferencesState,
    $,
    api,
    askText,
    el,
    iconActionButton,
    leaveWorkspace,
    renderProjects,
    saveIndicator,
    show,
    toast,
    uid,
    updateStatus
  }) {
    async function settingsHome() {
      await leaveWorkspace();
      show('settingsView');
      const data = await api('/api/settings');
      preferencesState.appSettings = data.settings;
      $('languageSelect').replaceChildren(
        ...data.languages.map((lang) =>
          el(
            'option',
            {
              value: lang.code
            },
            lang.name
          )
        )
      );
      $('languageSelect').value = preferencesState.appSettings.language;
      renderDisplayDefaults();
      renderTagManager();
      preferencesState.settingsDirty = false;
      settingsState();
      systemLogs($('systemLogs'), { api, el, iconActionButton, toast });
      vpnSettings($('vpnSettings'), { api, el, iconActionButton, toast });
    }
    function settingsState() {
      $('settingsSave').hidden = true;
      saveIndicator(
        $('settingsSave'),
        preferencesState.settingsPromise
          ? 'saving'
          : preferencesState.settingsError
            ? 'error'
            : preferencesState.settingsDirty
              ? 'pending'
              : 'saved',
        preferencesState.settingsError
      );
      updateStatus();
    }
    function renderDisplayDefaults() {
      $('displayDefaults').replaceChildren();
    }
    async function persistLanguage() {
      if (preferencesState.settingsPromise) return preferencesState.settingsPromise;
      const languageChoice = $('languageSelect').value,
        defaults = structuredClone(preferencesState.appSettings.node_display_defaults || {});
      for (const input of $('displayDefaults').querySelectorAll('input')) {
        defaults[input.dataset.displayType] ??= {};
        defaults[input.dataset.displayType][input.dataset.displayKey] = input.checked;
      }
      const sentTags = structuredClone(preferencesState.appSettings.tags || []),
        signature = JSON.stringify({
          language: languageChoice,
          node_display_defaults: defaults,
          tags: sentTags
        });
      preferencesState.settingsError = '';
      preferencesState.settingsPromise = api('/api/settings', JSON.parse(signature))
        .then(async (saved) => {
          const newerTags = preferencesState.appSettings.tags;
          const tagsChanged = JSON.stringify(newerTags || []) !== JSON.stringify(sentTags);
          if (!tagsChanged)
            for (const tag of newerTags || []) {
              const stored = saved.tags?.find((item) => item.id === tag.id);
              if (stored) Object.assign(tag, stored);
            }
          preferencesState.appSettings = {
            ...preferencesState.appSettings,
            ...saved,
            tags: newerTags || saved.tags || []
          };
          const priorLanguage = language;
          await setLanguage(saved.language);
          if (priorLanguage !== saved.language) renderTagManager();
          decorateStaticIcons();
          const now = {
            language: $('languageSelect').value,
            node_display_defaults: structuredClone(saved.node_display_defaults),
            tags: structuredClone(preferencesState.appSettings.tags || [])
          };
          for (const input of $('displayDefaults').querySelectorAll('input'))
            now.node_display_defaults[input.dataset.displayType][input.dataset.displayKey] =
              input.checked;
          preferencesState.settingsDirty = JSON.stringify(now) !== signature;
          renderProjects();
        })
        .catch((error) => {
          preferencesState.settingsError = error.message;
          preferencesState.settingsDirty = true;
          throw error;
        })
        .finally(() => {
          preferencesState.settingsPromise = null;
          settingsState();
          if (preferencesState.settingsDirty) {
            clearTimeout(preferencesState.pendingSettingsTimer);
            preferencesState.pendingSettingsTimer = setTimeout(
              () => persistLanguage().catch((error) => toast(error.message)),
              preferencesState.settingsError ? 5e3 : 150
            );
          }
        });
      settingsState();
      return preferencesState.settingsPromise;
    }
    function scheduleGlobalSettings() {
      preferencesState.settingsDirty = true;
      settingsState();
      clearTimeout(preferencesState.pendingSettingsTimer);
      preferencesState.pendingSettingsTimer = setTimeout(
        () => persistLanguage().catch((error) => toast(error.message)),
        500
      );
    }
    function renderTagManager() {
      let root = $('globalTagManager');
      if (!root) {
        root = el('section', {
          id: 'globalTagManager'
        });
        $('displayDefaults').after(root);
      }
      root.replaceChildren(el('h2', {}, t('Globale Tags')));
      const list = el('div');
      for (const tag of preferencesState.appSettings.tags || []) {
        const row = el('div', {
            class: 'tag-manager-row',
            'data-global-tag': tag.id
          }),
          name = el('input', {
            type: 'text',
            maxlength: 40,
            'aria-label': t('Tag-Name')
          }),
          color = el('input', {
            type: 'color',
            'aria-label': t('Tag-Farbe')
          });
        name.value = tag.name;
        color.value = tag.color;
        name.addEventListener('input', () => {
          tag.name = name.value;
          scheduleGlobalSettings();
        });
        color.addEventListener('input', () => {
          tag.color = color.value;
          scheduleGlobalSettings();
        });
        const remove = iconActionButton(
          t('Tag l\xF6schen'),
          () => {
            preferencesState.appSettings.tags = preferencesState.appSettings.tags.filter(
              (item) => item.id !== tag.id
            );
            renderTagManager();
            scheduleGlobalSettings();
          },
          'trash',
          'danger-filled'
        );
        buttonContent(remove, t('Tag l\xF6schen'), 'trash', true);
        row.append(name, color, remove);
        list.append(row);
      }
      root.append(
        list,
        iconActionButton(
          t('Tag hinzuf\xFCgen'),
          async () => {
            const value = await askText(t('Tag erstellen'), t('Tag-Name'), '');
            if (!value?.trim()) return;
            if (
              (preferencesState.appSettings.tags || []).some(
                (tag) => tag.name.toLocaleLowerCase() === value.trim().toLocaleLowerCase()
              )
            )
              throw Error(t('Ein Tag mit diesem Namen existiert bereits.'));
            preferencesState.appSettings.tags = [
              ...(preferencesState.appSettings.tags || []),
              {
                id: uid(),
                name: value.trim(),
                color: '#8799b2'
              }
            ];
            renderTagManager();
            scheduleGlobalSettings();
          },
          'plus'
        )
      );
    }
    return {
      settingsHome,
      settingsState,
      renderDisplayDefaults,
      persistLanguage,
      scheduleGlobalSettings,
      renderTagManager
    };
  }
};
var settings_default2 = settings_default;

// static/app/resources.js
var resources_default = {
  name: 'resources',
  dependencies: [
    '$',
    'api',
    'button',
    'change',
    'el',
    'locationDisplayLines',
    'makeRoomForNode',
    'nodeRect',
    'render',
    'renderNodeBadges',
    'svg',
    'toast'
  ],
  create({
    pluginsState,
    canvasState,
    workspaceState,
    $,
    api,
    button,
    change,
    el,
    locationDisplayLines,
    makeRoomForNode,
    nodeRect,
    render,
    renderNodeBadges,
    svg,
    toast
  }) {
    function safeLink(value) {
      try {
        const url = new URL(value);
        return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
      } catch {
        return null;
      }
    }
    function openLink(node) {
      const link = safeLink(node.data.value);
      if (link) window.open(link, '_blank', 'noopener,noreferrer');
      else toast(t('Ung\xFCltige URL'));
    }
    function mapSources(kind) {
      const entry = pluginsState.dataTypes.get('location'),
        node = entry?.node,
        key = kind === 'preview' ? 'map_preview_sources' : 'map_action_sources';
      return (node?.[key] || []).filter((source) => source.enabled !== false);
    }
    function resourceActions(node) {
      if (node.type === 'location') {
        const actions = {
          google: {
            key: 'mapsButton',
            label: 'In Google Maps \xF6ffnen',
            icon: 'map',
            provider: 'google'
          },
          apple: {
            key: 'appleMapsButton',
            label: 'In Apple Maps \xF6ffnen',
            icon: 'map',
            provider: 'apple'
          },
          osm: {
            key: 'osmButton',
            label: 'In OpenStreetMap \xF6ffnen',
            icon: 'map',
            provider: 'osm'
          }
        };
        return mapSources('actions')
          .map((source) => actions[source.id])
          .filter(Boolean);
      }
      return ['url', 'profile'].includes(node.type)
        ? [
            {
              key: 'openButton',
              label: 'Link \xF6ffnen',
              icon: 'external'
            }
          ]
        : node.type === 'image'
          ? [
              {
                key: 'imageButton',
                label: 'Bild anzeigen',
                icon: 'image'
              }
            ]
          : node.type === 'file'
            ? [
                {
                  key: 'fileButton',
                  label: 'Datei \xF6ffnen',
                  icon: 'file'
                }
              ]
            : [];
    }
    function displayControls(panel, node) {
      panel.append(el('h3', {}, t('Quick Actions & Glances')));
      for (const action of resourceActions(node))
        panel.append(
          button(t(action.label), () => openNodeResource(node, action.provider), 'quick-action')
        );
      if (node.type === 'location') {
        const box = el('div', {
          class: 'detail-map'
        });
        panel.append(box);
        refreshDetailMap(panel, node);
      }
      for (const [key, text] of (displayOptions[node.type] || []).filter(
        ([key2]) =>
          !['mapsButton', 'appleMapsButton', 'osmButton'].includes(key2) ||
          resourceActions(node).some((a) => a.key === key2)
      )) {
        const label = el('label', {
            class: 'checkbox-label'
          }),
          checkbox = el('input', {
            type: 'checkbox'
          });
        checkbox.checked = Boolean(node.display?.[key]);
        label.append(checkbox, document.createTextNode(t(text)));
        checkbox.addEventListener('change', async () => {
          if (
            node.type === 'image' &&
            key === 'preview' &&
            checkbox.checked &&
            !node.data.file_id &&
            node.data.url
          ) {
            checkbox.disabled = true;
            try {
              const cached = await api('/api/media/store', { url: node.data.url });
              node.data.file_id = cached.file_id;
            } catch (error) {
              checkbox.checked = false;
              toast(error.message);
              return;
            } finally {
              checkbox.disabled = false;
            }
          }
          node.display = {
            ...node.display,
            [key]: checkbox.checked
          };
          canvasState.groupBoundsCache = null;
          makeRoomForNode(node);
          change(node.id);
          render();
        });
        panel.append(label);
      }
    }
    function locationQuery(node) {
      const d = node.data;
      if (
        d.latitude !== null &&
        d.latitude !== '' &&
        d.longitude !== null &&
        d.longitude !== '' &&
        Number.isFinite(Number(d.latitude)) &&
        Number.isFinite(Number(d.longitude))
      )
        return Number(d.latitude) + ',' + Number(d.longitude);
      return (
        d.formatted_address ||
        d.original_input ||
        [d.street, d.house_number, d.postal_code, d.locality, d.admin_area_1, d.country]
          .filter(Boolean)
          .join(' ')
      );
    }
    function mapsUrl(node, embed = false, provider = 'google') {
      if (!locationQuery(node)) return null;
      if (embed) {
        const source = mapSources('preview')[0];
        if (!source) return null;
        const d = node.data;
        return (
          '/api/map-preview?' +
          new URLSearchParams({
            provider: source.id,
            lat: d.latitude ?? '',
            lon: d.longitude ?? '',
            q: locationQuery(node) || ''
          })
        );
      }
      const query = locationQuery(node);
      if (!query) return null;
      if (provider === 'apple') return 'https://maps.apple.com/?q=' + encodeURIComponent(query);
      if (provider === 'osm') {
        const d = node.data,
          hasCoords =
            d.latitude !== null &&
            d.latitude !== '' &&
            d.longitude !== null &&
            d.longitude !== '' &&
            Number.isFinite(Number(d.latitude)) &&
            Number.isFinite(Number(d.longitude));
        return hasCoords
          ? 'https://www.openstreetmap.org/?mlat=' +
              Number(d.latitude) +
              '&mlon=' +
              Number(d.longitude) +
              '#map=16/' +
              Number(d.latitude) +
              '/' +
              Number(d.longitude)
          : 'https://www.openstreetmap.org/search?query=' + encodeURIComponent(query);
      }
      return (
        (embed
          ? 'https://maps.google.com/maps?output=embed&z=14&q='
          : 'https://www.google.com/maps/search/?api=1&query=') + encodeURIComponent(query)
      );
    }
    function openNodeResource(node, provider = 'google') {
      if (node.type === 'profile') {
        if (safeResourceUrl(node.data.url))
          openLink({
            data: {
              value: node.data.url
            }
          });
        else toast(t('Keine \xF6ffentliche Profil-URL'));
        return;
      }
      if (node.type === 'image' && !node.data.file_id && safeResourceUrl(node.data.url)) {
        window.open(safeResourceUrl(node.data.url), '_blank', 'noopener,noreferrer');
        return;
      }
      if (node.type === 'url') {
        openLink(node);
        return;
      }
      const url =
        ['image', 'file'].includes(node.type) && node.data.file_id
          ? '/api/files/' + encodeURIComponent(node.data.file_id)
          : node.type === 'location'
            ? mapsUrl(node, false, provider)
            : null;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      else toast(t('Noch keine anzeigbaren Daten vorhanden.'));
    }
    function refreshDetailMap(panel, node) {
      const box = panel.querySelector('.detail-map');
      if (!box) return;
      const src = mapsUrl(node, true);
      if (!src) {
        box.replaceChildren(el('p', {}, t('Ort erg\xE4nzen, um die Karte anzuzeigen.')));
        return;
      }
      let frame = box.querySelector('iframe');
      if (!frame) {
        frame = el('iframe', {
          class: 'embedded-map',
          title: t('Kartenvorschau'),
          loading: 'lazy',
          referrerpolicy: 'no-referrer'
        });
        box.replaceChildren(frame);
      }
      if (frame.getAttribute('src') !== src) frame.src = src;
    }
    function safeResourceUrl(value) {
      try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
          ? '/api/media?url=' + encodeURIComponent(url.href)
          : '';
      } catch {
        return '';
      }
    }
    function nodeExtras(g, node, bounds) {
      renderNodeBadges(g, node, bounds);
      const actions = resourceActions(node).filter((a) => node.display?.[a.key]),
        start = bounds.h - actions.length * 48;
      actions.forEach((action, index) => {
        const y = start + index * 48,
          b = svg('g', {
            class: 'node-open',
            role: 'button',
            tabindex: 0,
            'aria-label': t(action.label)
          });
        b.append(
          svg('rect', {
            x: 12,
            y,
            width: bounds.w - 24,
            height: 36,
            rx: 4
          })
        );
        const glyph = icon(action.icon);
        for (const [key, value] of Object.entries({
          x: 22,
          y: y + 9,
          width: 18,
          height: 18
        }))
          glyph.setAttribute(key, value);
        b.append(
          glyph,
          svg(
            'text',
            {
              x: 38,
              y: y + 18,
              'font-size': 11,
              'dominant-baseline': 'central'
            },
            t(action.label)
          )
        );
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          openNodeResource(node, action.provider);
        });
        b.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') openNodeResource(node, action.provider);
        });
        g.append(b);
      });
      if (
        node.type === 'image' &&
        node.display?.preview &&
        (node.data.file_id || safeResourceUrl(node.data.url))
      ) {
        const clip = svg('clipPath', {
          id: 'preview-' + node.id
        });
        clip.append(
          svg('rect', {
            x: 8,
            y: 80,
            width: bounds.w - 16,
            height: 120,
            rx: 8
          })
        );
        g.append(
          clip,
          svg('image', {
            x: 8,
            y: 80,
            width: bounds.w - 16,
            height: 120,
            href: node.data.file_id
              ? '/api/files/' + encodeURIComponent(node.data.file_id)
              : safeResourceUrl(node.data.url),
            'clip-path': 'url(#preview-' + node.id + ')',
            preserveAspectRatio: 'xMidYMid slice'
          })
        );
      }
    }
    function updateMapOverlays(hidden) {
      const root = $('mapOverlays');
      if (!root) return;
      const keep = /* @__PURE__ */ new Set();
      for (const node of workspaceState.project.document.nodes) {
        if (node.type !== 'location' || !node.display?.map || hidden.has(node.id)) continue;
        const src = mapsUrl(node, true);
        if (!src) continue;
        keep.add(node.id);
        let wrap = root.querySelector('[data-map-node="' + node.id + '"]');
        if (!wrap) {
          wrap = el('div', {
            class: 'node-map',
            'data-map-node': node.id
          });
          wrap.append(
            el('iframe', {
              class: 'embedded-map',
              title: t('Kartenvorschau'),
              referrerpolicy: 'no-referrer',
              loading: 'lazy'
            })
          );
          root.append(wrap);
        }
        const frame = wrap.firstChild;
        if (frame.getAttribute('src') !== src) frame.src = src;
        wrap.style.width = nodeRect(node).w - 16 + 'px';
        wrap.style.height = '210px';
        wrap.style.transform = `translate(${canvasState.pan.x + (node.x + 8) * canvasState.pan.scale}px,${canvasState.pan.y + (node.y + Math.max(76, 64 + locationDisplayLines(node.data, nodeRect(node).w).length * 16)) * canvasState.pan.scale}px) scale(${canvasState.pan.scale})`;
      }
      for (const wrap of [...root.children]) if (!keep.has(wrap.dataset.mapNode)) wrap.remove();
    }
    return {
      safeLink,
      openLink,
      mapSources,
      resourceActions,
      displayControls,
      locationQuery,
      mapsUrl,
      openNodeResource,
      refreshDetailMap,
      safeResourceUrl,
      nodeExtras,
      updateMapOverlays
    };
  }
};
var resources_default2 = resources_default;

// static/phone-countries.js
var PHONE_COUNTRIES = {
  AC: { code: '+247', example: '+247 40123' },
  AD: { code: '+376', example: '+376 312 345' },
  AE: { code: '+971', example: '+971 50 123 4567' },
  AF: { code: '+93', example: '+93 70 123 4567' },
  AG: { code: '+1', example: '+1 268-464-1234' },
  AI: { code: '+1', example: '+1 264-235-1234' },
  AL: { code: '+355', example: '+355 67 212 3456' },
  AM: { code: '+374', example: '+374 77 123456' },
  AO: { code: '+244', example: '+244 923 123 456' },
  AR: { code: '+54', example: '+54 9 11 2345-6789' },
  AS: { code: '+1', example: '+1 684-733-1234' },
  AT: { code: '+43', example: '+43 664 123456' },
  AU: { code: '+61', example: '+61 412 345 678' },
  AW: { code: '+297', example: '+297 560 1234' },
  AX: { code: '+358', example: '+358 41 2345678' },
  AZ: { code: '+994', example: '+994 40 123 45 67' },
  BA: { code: '+387', example: '+387 61 123 456' },
  BB: { code: '+1', example: '+1 246-250-1234' },
  BD: { code: '+880', example: '+880 1812-345678' },
  BE: { code: '+32', example: '+32 470 12 34 56' },
  BF: { code: '+226', example: '+226 70 12 34 56' },
  BG: { code: '+359', example: '+359 43 012 345' },
  BH: { code: '+973', example: '+973 3600 1234' },
  BI: { code: '+257', example: '+257 79 56 12 34' },
  BJ: { code: '+229', example: '+229 01 95 12 34 56' },
  BL: { code: '+590', example: '+590 690 00 12 34' },
  BM: { code: '+1', example: '+1 441-370-1234' },
  BN: { code: '+673', example: '+673 712 3456' },
  BO: { code: '+591', example: '+591 71234567' },
  BQ: { code: '+599', example: '+599 318 1234' },
  BR: { code: '+55', example: '+55 11 96123-4567' },
  BS: { code: '+1', example: '+1 242-359-1234' },
  BT: { code: '+975', example: '+975 17 12 34 56' },
  BW: { code: '+267', example: '+267 71 123 456' },
  BY: { code: '+375', example: '+375 29 491-19-11' },
  BZ: { code: '+501', example: '+501 622-1234' },
  CA: { code: '+1', example: '+1 506-234-5678' },
  CC: { code: '+61', example: '+61 412 345 678' },
  CD: { code: '+243', example: '+243 991 234 567' },
  CF: { code: '+236', example: '+236 70 01 23 45' },
  CG: { code: '+242', example: '+242 06 123 4567' },
  CH: { code: '+41', example: '+41 78 123 45 67' },
  CI: { code: '+225', example: '+225 01 23 45 6789' },
  CK: { code: '+682', example: '+682 71 234' },
  CL: { code: '+56', example: '+56 2 2123 4567' },
  CM: { code: '+237', example: '+237 6 71 23 45 67' },
  CN: { code: '+86', example: '+86 131 2345 6789' },
  CO: { code: '+57', example: '+57 321 1234567' },
  CR: { code: '+506', example: '+506 8312 3456' },
  CU: { code: '+53', example: '+53 5 1234567' },
  CV: { code: '+238', example: '+238 991 12 34' },
  CW: { code: '+599', example: '+599 9 518 1234' },
  CX: { code: '+61', example: '+61 412 345 678' },
  CY: { code: '+357', example: '+357 96 123456' },
  CZ: { code: '+420', example: '+420 601 123 456' },
  DE: { code: '+49', example: '+49 1512 3456789' },
  DJ: { code: '+253', example: '+253 77 83 10 01' },
  DK: { code: '+45', example: '+45 34 41 23 45' },
  DM: { code: '+1', example: '+1 767-225-1234' },
  DO: { code: '+1', example: '+1 809-234-5678' },
  DZ: { code: '+213', example: '+213 551 23 45 67' },
  EC: { code: '+593', example: '+593 99 123 4567' },
  EE: { code: '+372', example: '+372 5123 4567' },
  EG: { code: '+20', example: '+20 10 01234567' },
  EH: { code: '+212', example: '+212 650-123456' },
  ER: { code: '+291', example: '+291 7 123 456' },
  ES: { code: '+34', example: '+34 612 34 56 78' },
  ET: { code: '+251', example: '+251 91 123 4567' },
  FI: { code: '+358', example: '+358 41 2345678' },
  FJ: { code: '+679', example: '+679 701 2345' },
  FK: { code: '+500', example: '+500 51234' },
  FM: { code: '+691', example: '+691 350 1234' },
  FO: { code: '+298', example: '+298 211234' },
  FR: { code: '+33', example: '+33 6 12 34 56 78' },
  GA: { code: '+241', example: '+241 06 03 12 34' },
  GB: { code: '+44', example: '+44 7400 123456' },
  GD: { code: '+1', example: '+1 473-403-1234' },
  GE: { code: '+995', example: '+995 555 12 34 56' },
  GF: { code: '+594', example: '+594 694 20 12 34' },
  GG: { code: '+44', example: '+44 7781 123456' },
  GH: { code: '+233', example: '+233 23 123 4567' },
  GI: { code: '+350', example: '+350 57123456' },
  GL: { code: '+299', example: '+299 22 12 34' },
  GM: { code: '+220', example: '+220 301 2345' },
  GN: { code: '+224', example: '+224 601 12 34 56' },
  GP: { code: '+590', example: '+590 690 00 12 34' },
  GQ: { code: '+240', example: '+240 222 123 456' },
  GR: { code: '+30', example: '+30 691 234 5678' },
  GT: { code: '+502', example: '+502 5123 4567' },
  GU: { code: '+1', example: '+1 671-300-1234' },
  GW: { code: '+245', example: '+245 955 012 345' },
  GY: { code: '+592', example: '+592 609 1234' },
  HK: { code: '+852', example: '+852 5123 4567' },
  HN: { code: '+504', example: '+504 9123-4567' },
  HR: { code: '+385', example: '+385 92 123 4567' },
  HT: { code: '+509', example: '+509 34 10 1234' },
  HU: { code: '+36', example: '+36 20 123 4567' },
  ID: { code: '+62', example: '+62 812-345-678' },
  IE: { code: '+353', example: '+353 85 012 3456' },
  IL: { code: '+972', example: '+972 50-234-5678' },
  IM: { code: '+44', example: '+44 7924 123456' },
  IN: { code: '+91', example: '+91 81234 56789' },
  IO: { code: '+246', example: '+246 380 1234' },
  IQ: { code: '+964', example: '+964 791 234 5678' },
  IR: { code: '+98', example: '+98 912 345 6789' },
  IS: { code: '+354', example: '+354 611 1234' },
  IT: { code: '+39', example: '+39 312 345 6789' },
  JE: { code: '+44', example: '+44 7797 712345' },
  JM: { code: '+1', example: '+1 876-210-1234' },
  JO: { code: '+962', example: '+962 7 9012 3456' },
  JP: { code: '+81', example: '+81 90-1234-5678' },
  KE: { code: '+254', example: '+254 712 123456' },
  KG: { code: '+996', example: '+996 700 123 456' },
  KH: { code: '+855', example: '+855 91 234 567' },
  KI: { code: '+686', example: '+686 72001234' },
  KM: { code: '+269', example: '+269 321 23 45' },
  KN: { code: '+1', example: '+1 869-765-2917' },
  KP: { code: '+850', example: '+850 192 123 4567' },
  KR: { code: '+82', example: '+82 10-2000-0000' },
  KW: { code: '+965', example: '+965 500 12345' },
  KY: { code: '+1', example: '+1 345-323-1234' },
  KZ: { code: '+7', example: '+7 771 000 9998' },
  LA: { code: '+856', example: '+856 20 23 123 456' },
  LB: { code: '+961', example: '+961 71 123 456' },
  LC: { code: '+1', example: '+1 758-284-5678' },
  LI: { code: '+423', example: '+423 660 234 567' },
  LK: { code: '+94', example: '+94 71 234 5678' },
  LR: { code: '+231', example: '+231 77 012 3456' },
  LS: { code: '+266', example: '+266 5012 3456' },
  LT: { code: '+370', example: '+370 612 34567' },
  LU: { code: '+352', example: '+352 628 123 456' },
  LV: { code: '+371', example: '+371 21 234 567' },
  LY: { code: '+218', example: '+218 91-2345678' },
  MA: { code: '+212', example: '+212 650-123456' },
  MC: { code: '+377', example: '+377 6 12 34 56 78' },
  MD: { code: '+373', example: '+373 621 12 345' },
  ME: { code: '+382', example: '+382 60 123 456' },
  MF: { code: '+590', example: '+590 690 00 12 34' },
  MG: { code: '+261', example: '+261 32 12 345 67' },
  MH: { code: '+692', example: '+692 235-1234' },
  MK: { code: '+389', example: '+389 72 345 678' },
  ML: { code: '+223', example: '+223 65 01 23 45' },
  MM: { code: '+95', example: '+95 9 212 3456' },
  MN: { code: '+976', example: '+976 8812 3456' },
  MO: { code: '+853', example: '+853 6612 3456' },
  MP: { code: '+1', example: '+1 670-234-5678' },
  MQ: { code: '+596', example: '+596 696 20 12 34' },
  MR: { code: '+222', example: '+222 22 12 34 56' },
  MS: { code: '+1', example: '+1 664-492-3456' },
  MT: { code: '+356', example: '+356 9696 1234' },
  MU: { code: '+230', example: '+230 5251 2345' },
  MV: { code: '+960', example: '+960 771-2345' },
  MW: { code: '+265', example: '+265 991 23 45 67' },
  MX: { code: '+52', example: '+52 222 123 4567' },
  MY: { code: '+60', example: '+60 12-345 6789' },
  MZ: { code: '+258', example: '+258 82 123 4567' },
  NA: { code: '+264', example: '+264 81 123 4567' },
  NC: { code: '+687', example: '+687 75.12.34' },
  NE: { code: '+227', example: '+227 93 12 34 56' },
  NF: { code: '+672', example: '+672 3 81234' },
  NG: { code: '+234', example: '+234 802 123 4567' },
  NI: { code: '+505', example: '+505 8123 4567' },
  NL: { code: '+31', example: '+31 6 12345678' },
  NO: { code: '+47', example: '+47 40 61 23 45' },
  NP: { code: '+977', example: '+977 984-1234567' },
  NR: { code: '+674', example: '+674 555 1234' },
  NU: { code: '+683', example: '+683 888 4012' },
  NZ: { code: '+64', example: '+64 21 123 4567' },
  OM: { code: '+968', example: '+968 9212 3456' },
  PA: { code: '+507', example: '+507 6123-4567' },
  PE: { code: '+51', example: '+51 912 345 678' },
  PF: { code: '+689', example: '+689 87 12 34 56' },
  PG: { code: '+675', example: '+675 7012 3456' },
  PH: { code: '+63', example: '+63 905 123 4567' },
  PK: { code: '+92', example: '+92 301 2345678' },
  PL: { code: '+48', example: '+48 512 345 678' },
  PM: { code: '+508', example: '+508 55 12 34' },
  PR: { code: '+1', example: '+1 787-234-5678' },
  PS: { code: '+970', example: '+970 599 123 456' },
  PT: { code: '+351', example: '+351 912 345 678' },
  PW: { code: '+680', example: '+680 620 1234' },
  PY: { code: '+595', example: '+595 961 456789' },
  QA: { code: '+974', example: '+974 3312 3456' },
  RE: { code: '+262', example: '+262 692 12 34 56' },
  RO: { code: '+40', example: '+40 712 034 567' },
  RS: { code: '+381', example: '+381 60 1234567' },
  RU: { code: '+7', example: '+7 912 345-67-89' },
  RW: { code: '+250', example: '+250 720 123 456' },
  SA: { code: '+966', example: '+966 51 234 5678' },
  SB: { code: '+677', example: '+677 74 21234' },
  SC: { code: '+248', example: '+248 2 510 123' },
  SD: { code: '+249', example: '+249 91 123 1234' },
  SE: { code: '+46', example: '+46 70 123 45 67' },
  SG: { code: '+65', example: '+65 8123 4567' },
  SH: { code: '+290', example: '+290 51234' },
  SI: { code: '+386', example: '+386 31 234 567' },
  SJ: { code: '+47', example: '+47 41 23 45 67' },
  SK: { code: '+421', example: '+421 912 123 456' },
  SL: { code: '+232', example: '+232 25 123456' },
  SM: { code: '+378', example: '+378 66 66 12 12' },
  SN: { code: '+221', example: '+221 70 123 45 67' },
  SO: { code: '+252', example: '+252 7 1123456' },
  SR: { code: '+597', example: '+597 741-2345' },
  SS: { code: '+211', example: '+211 977 123 456' },
  ST: { code: '+239', example: '+239 981 2345' },
  SV: { code: '+503', example: '+503 7012 3456' },
  SX: { code: '+1', example: '+1 721-520-5678' },
  SY: { code: '+963', example: '+963 944 567 890' },
  SZ: { code: '+268', example: '+268 7612 3456' },
  TA: { code: '+290', example: '' },
  TC: { code: '+1', example: '+1 649-231-1234' },
  TD: { code: '+235', example: '+235 63 01 23 45' },
  TG: { code: '+228', example: '+228 90 11 23 45' },
  TH: { code: '+66', example: '+66 81 234 5678' },
  TJ: { code: '+992', example: '+992 91 712 3456' },
  TK: { code: '+690', example: '+690 7290' },
  TL: { code: '+670', example: '+670 7721 2345' },
  TM: { code: '+993', example: '+993 66 123456' },
  TN: { code: '+216', example: '+216 20 123 456' },
  TO: { code: '+676', example: '+676 771 5123' },
  TR: { code: '+90', example: '+90 501 234 56 78' },
  TT: { code: '+1', example: '+1 868-291-1234' },
  TV: { code: '+688', example: '+688 90 1234' },
  TW: { code: '+886', example: '+886 912 345 678' },
  TZ: { code: '+255', example: '+255 621 234 567' },
  UA: { code: '+380', example: '+380 50 123 4567' },
  UG: { code: '+256', example: '+256 712 345678' },
  US: { code: '+1', example: '+1 201-555-0123' },
  UY: { code: '+598', example: '+598 94 231 234' },
  UZ: { code: '+998', example: '+998 91 234 56 78' },
  VA: { code: '+39', example: '+39 312 345 6789' },
  VC: { code: '+1', example: '+1 784-430-1234' },
  VE: { code: '+58', example: '+58 412-1234567' },
  VG: { code: '+1', example: '+1 284-300-1234' },
  VI: { code: '+1', example: '+1 340-642-1234' },
  VN: { code: '+84', example: '+84 912 345 678' },
  VU: { code: '+678', example: '+678 591 2345' },
  WF: { code: '+681', example: '+681 82 12 34' },
  WS: { code: '+685', example: '+685 72 12345' },
  XK: { code: '+383', example: '+383 43 201 234' },
  YE: { code: '+967', example: '+967 712 345 678' },
  YT: { code: '+262', example: '+262 639 01 23 45' },
  ZA: { code: '+27', example: '+27 71 123 4567' },
  ZM: { code: '+260', example: '+260 95 5123456' },
  ZW: { code: '+263', example: '+263 71 234 5678' }
};
var phone_countries_default = PHONE_COUNTRIES;

// static/searchable-select.js
var ArgusSelect = (() => {
  const controls2 = /* @__PURE__ */ new WeakMap();
  let active = null;
  const tr = (key) => (typeof t === 'function' ? t(key) : key);
  function close(restore = false) {
    if (!active) return;
    const current = active;
    active = null;
    current.button.setAttribute('aria-expanded', 'false');
    if (current.popup.matches(':popover-open')) current.popup.hidePopover();
    current.popup.remove();
    if (restore) current.button.focus();
  }
  function enhance2(select) {
    if (select.multiple || controls2.has(select)) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'search-select';
    select.before(wrapper);
    wrapper.append(select);
    select.classList.add('search-select-source');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'search-select-button';
    button.setAttribute('role', 'combobox');
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    const text = document.createElement('span'),
      chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.innerHTML =
      '<path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2"/>';
    button.append(text, chevron);
    wrapper.append(button);
    const refresh = () => {
      const label =
        select.getAttribute('aria-label') ||
        document.querySelector('label[for="' + select.id + '"]')?.textContent ||
        (wrapper.previousElementSibling?.matches('label')
          ? wrapper.previousElementSibling.textContent
          : '');
      if (label) button.setAttribute('aria-label', label);
      const value = select.selectedOptions?.[0]?.textContent || tr('Bitte ausw\xE4hlen');
      if (text.textContent !== value) text.textContent = value;
      button.disabled = select.disabled;
    };
    const model = { select, wrapper, button, refresh };
    controls2.set(select, model);
    select.addEventListener('change', refresh);
    select.addEventListener('input', refresh);
    new MutationObserver(refresh).observe(select, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
    refresh();
    function open(initial = '') {
      close();
      const popup = document.createElement('div');
      popup.className = 'select-popup';
      popup.setAttribute('popover', 'manual');
      const search = document.createElement('input');
      search.type = 'search';
      search.placeholder = tr('Suchen \u2026');
      search.setAttribute('aria-label', tr('Optionen durchsuchen'));
      search.autocomplete = 'off';
      const list = document.createElement('div');
      list.className = 'select-options';
      list.setAttribute('role', 'listbox');
      const count = document.createElement('small');
      popup.append(search, list, count);
      (select.closest('dialog') || document.body).append(popup);
      const id = 'select-options-' + Math.random().toString(36).slice(2);
      list.id = id;
      button.setAttribute('aria-controls', id);
      button.setAttribute('aria-expanded', 'true');
      active = { ...model, popup, search };
      const rect = button.getBoundingClientRect(),
        width = Math.max(230, Math.min(520, rect.width));
      popup.style.width = Math.min(width, innerWidth - 20) + 'px';
      popup.style.left = Math.max(10, Math.min(rect.left, innerWidth - width - 10)) + 'px';
      const below = innerHeight - rect.bottom;
      popup.style.top =
        (below > 240 ? rect.bottom + 4 : Math.max(10, rect.top - Math.min(330, innerHeight - 20))) +
        'px';
      popup.style.maxHeight =
        Math.max(150, Math.min(330, below > 240 ? below - 12 : rect.top - 12)) + 'px';
      if (popup.showPopover) popup.showPopover();
      function choose(option) {
        select.value = option.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        refresh();
        close(true);
      }
      function paint() {
        const query = search.value.normalize('NFKC').toLocaleLowerCase(),
          matches = [...select.options].filter((o) =>
            (o.textContent + ' ' + o.value + ' ' + (o.closest('optgroup')?.label || ''))
              .normalize('NFKC')
              .toLocaleLowerCase()
              .includes(query)
          );
        list.replaceChildren();
        for (const option of matches.slice(0, 120)) {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'select-option';
          row.setAttribute('role', 'option');
          row.setAttribute('aria-selected', String(option.selected));
          row.disabled = option.disabled;
          row.textContent = option.textContent;
          row.addEventListener('click', () => choose(option));
          list.append(row);
        }
        if (!matches.length) {
          const empty = document.createElement('p');
          empty.textContent = tr('Keine passenden Optionen.');
          list.append(empty);
        }
        count.textContent =
          matches.length > 120
            ? tr('Weitere Optionen \xFCber die Suche eingrenzen.') + ' (' + matches.length + ')'
            : '';
      }
      search.addEventListener('input', paint);
      popup.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close(true);
          return;
        }
        const rows = [...list.querySelectorAll('button:not(:disabled)')],
          index = rows.indexOf(document.activeElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          rows[
            Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
          ]?.focus();
        } else if (
          event.key === 'Enter' &&
          document.activeElement === search &&
          rows.length === 1
        ) {
          event.preventDefault();
          rows[0].click();
        } else if (
          event.key.length === 1 &&
          !event.ctrlKey &&
          !event.metaKey &&
          document.activeElement !== search
        ) {
          event.preventDefault();
          search.focus({ preventScroll: true });
          search.value += event.key;
          paint();
        }
      });
      search.value = initial;
      paint();
      search.focus({ preventScroll: true });
    }
    button.addEventListener('click', () => (active?.select === select ? close() : open()));
    button.addEventListener('keydown', (event) => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        open();
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== ' ') {
        event.preventDefault();
        open(event.key);
      }
    });
  }
  function scan(root = document) {
    if (root.matches?.('select')) enhance2(root);
    root.querySelectorAll?.('select').forEach(enhance2);
  }
  const api = {
    scan,
    close,
    refresh: (select) => controls2.get(select)?.refresh()
  };
  if (typeof MutationObserver === 'function') {
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) if (node.nodeType === 1) scan(node);
      if (active && !active.select.isConnected) close();
    }).observe(document.body, { childList: true, subtree: true });
    scan();
    document.addEventListener('pointerdown', (event) => {
      if (active && !active.popup.contains(event.target) && !active.button.contains(event.target))
        close();
    });
    window.addEventListener('resize', () => close());
    document.addEventListener(
      'scroll',
      (event) => {
        if (active && !active.popup.contains(event.target)) close();
      },
      true
    );
  }
  return api;
})();
var searchable_select_default = ArgusSelect;

// static/app/location-fields.js
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
      const text = formatLocation(data) || data.formatted_address || t('Standortangabe'),
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
          'aria-label': t('L\xE4ndervorwahl'),
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
var location_fields_default2 = location_fields_default;

// static/app/uploads.js
var uploads_default = {
  name: 'uploads',
  dependencies: ['$', 'modalChoice', 'newNode'],
  create({ workspaceState, canvasState, $, modalChoice, newNode }) {
    async function uploadNodeFile(file, type, x, y, pid = workspaceState.project?.id) {
      if (!pid) return;
      const response = await authorizedFetch('/api/files', {
        method: 'POST',
        headers: {
          'X-File-Name': encodeURIComponent(file.name)
        },
        body: file
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error?.detail || data.error?.code || 'Upload failed');
      if (type === 'file' && data.is_image) {
        const choice = await modalChoice(t('Foto erkannt'), file.name, [
          {
            label: t('Bild-Node verwenden'),
            value: 'image'
          },
          {
            label: t('Datei-Node verwenden'),
            value: 'file'
          }
        ]);
        if (choice === null) return;
        type = choice;
      }
      if (type === 'image' && !data.is_image) type = 'file';
      if (workspaceState.project?.id !== pid)
        throw Error(
          t('Bitte das urspr\xFCngliche Projekt \xF6ffnen, um die Datei hinzuzuf\xFCgen.')
        );
      newNode(
        type,
        file.name,
        type === 'image'
          ? {
              file_id: data.file_id,
              filename: file.name
            }
          : {
              file_id: data.file_id,
              filename: file.name,
              mime: data.mime,
              size: data.size
            },
        x,
        y
      );
    }
    async function dropFiles(event) {
      if (!event.dataTransfer?.files?.length) return false;
      event.preventDefault();
      const box = $('graph').getBoundingClientRect(),
        x = (event.clientX - box.left - canvasState.pan.x) / canvasState.pan.scale,
        y = (event.clientY - box.top - canvasState.pan.y) / canvasState.pan.scale,
        pid = workspaceState.project?.id;
      for (const [index, file] of [...event.dataTransfer.files].entries())
        await uploadNodeFile(file, 'file', x, y + index * 110, pid);
      return true;
    }
    return { uploadNodeFile, dropFiles };
  }
};
var uploads_default2 = uploads_default;

// static/app/providers.js
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
          placeholder: t('Anbieter suchen \u2026'),
          'aria-label': t('Anbieter suchen \u2026'),
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
          placeholder: t('Eigener Anbieter'),
          'aria-label': t('Eigener Anbieter')
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
          ? t('Andere / Custom')
          : providerName(control.value) || t('Anbieter ausw\xE4hlen');
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
        if (!matches.length) list.append(el('p', {}, t('Kein passender Anbieter.')));
        const other = button(
          t('Andere / Custom'),
          () => choose('custom:' + custom.value),
          'provider-option provider-custom'
        );
        other.type = 'button';
        list.append(other);
        hint.textContent =
          matches.length > 80
            ? t('Weitere Anbieter \xFCber die Suche eingrenzen.') + ' (' + matches.length + ')'
            : matches.length + ' ' + t('Anbieter');
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
var providers_default2 = providers_default;

// static/app/tags.js
var tags_default = {
  name: 'tags',
  dependencies: [
    'change',
    'el',
    'fitNodeText',
    'makeRoomForNode',
    'measureEdgeText',
    'render',
    'resourceActions',
    'svg'
  ],
  create({
    preferencesState,
    canvasState,
    change,
    el,
    fitNodeText,
    makeRoomForNode,
    measureEdgeText,
    render,
    resourceActions,
    svg
  }) {
    function nodeBadgeRows(node, width) {
      if (['actor', 'marker'].includes(node.type)) return [];
      const status = ['unverified', 'unclear', 'verified'].includes(node.verification)
          ? node.verification
          : 'unverified',
        states = {
          unverified: {
            name: t('Unverifiziert'),
            color: '#e66a78'
          },
          unclear: {
            name: t('Unklar'),
            color: '#eab65c'
          },
          verified: {
            name: t('Verifiziert'),
            color: '#6fc58c'
          }
        },
        items = [
          ...(['note', 'error'].includes(node.type) ? [] : [states[status]]),
          ...(preferencesState.appSettings.tags || []).filter((tag) =>
            (node.tags || []).includes(tag.id)
          )
        ],
        rows = [[]];
      let used = 0;
      for (const item of items) {
        const size = Math.min(width - 24, 24 + Math.ceil((measureEdgeText(item.name) * 10) / 11));
        if (used && used + size > width - 24) {
          rows.push([]);
          used = 0;
        }
        rows.at(-1).push({
          ...item,
          x: 12 + used,
          w: size
        });
        used += size + 5;
      }
      return rows;
    }
    function nodeBadgeHeight(node, width) {
      const rows = nodeBadgeRows(node, width).filter((row) => row.length);
      return rows.length ? rows.length * 22 + 8 : 0;
    }
    function renderNodeBadges(g, node, bounds) {
      const rows = nodeBadgeRows(node, bounds.w);
      if (!rows.length) return;
      const start =
          bounds.h -
          resourceActions(node).filter((a) => node.display?.[a.key]).length * 48 -
          nodeBadgeHeight(node, bounds.w),
        group = svg('g', {
          class: 'node-badges'
        });
      for (const [index, row] of rows.entries())
        for (const tag of row) {
          const color = /^#[0-9a-f]{6}$/i.test(tag.color) ? tag.color : '#8799b2',
            y = start + index * 22;
          group.append(
            svg('rect', {
              x: tag.x,
              y,
              width: tag.w,
              height: 18,
              rx: 5,
              fill: color + '32',
              stroke: color,
              'stroke-width': 0.7
            }),
            svg('circle', {
              cx: tag.x + 7,
              cy: y + 9,
              r: 2.5,
              fill: color
            }),
            svg(
              'text',
              {
                x: tag.x + 14,
                y: y + 12,
                'font-size': 10,
                fill: '#e4ecf7'
              },
              fitNodeText(tag.name, tag.w - 19, 10)
            )
          );
        }
      g.append(group);
    }
    function reviewControls(panel, node) {
      const section = el('section', {
        class: 'node-review'
      });
      const verifiable = !['note', 'error', 'marker'].includes(node.type);
      if (verifiable) section.append(el('h3', {}, t('Verifizierung')));
      const status = el('select', {
        class: 'verification-select',
        'aria-label': t('Verifizierung')
      });
      for (const [value, label] of [
        ['unverified', 'Unverifiziert'],
        ['unclear', 'Unklar'],
        ['verified', 'Verifiziert']
      ])
        status.append(
          el(
            'option',
            {
              value
            },
            t(label)
          )
        );
      status.value = node.verification || 'unverified';
      status.addEventListener('change', () => {
        node.verification = status.value;
        canvasState.groupBoundsCache = null;
        makeRoomForNode(node);
        change(node.id);
        render();
      });
      if (verifiable) section.append(status);
      const list = el('div', {
        class: 'node-tag-options'
      });
      list.append(el('h3', {}, t('Tags')));
      const allTags = preferencesState.appSettings.tags || [];
      const picker = el('select', { 'aria-label': t('Tag hinzuf\xFCgen') });
      const badges = el('div', { class: 'selected-tag-badges' });
      list.append(badges, picker);
      function updateTags() {
        canvasState.groupBoundsCache = null;
        makeRoomForNode(node);
        change(node.id);
        render();
        paintTags();
      }
      function paintTags() {
        badges.replaceChildren();
        picker.replaceChildren(el('option', { value: '' }, t('Tag hinzuf\xFCgen \u2026')));
        for (const tag of allTags) {
          if (!(node.tags || []).includes(tag.id)) {
            picker.append(el('option', { value: tag.id }, tag.name));
            continue;
          }
          const badge = el('span', { class: 'selected-tag-badge' });
          badge.append(el('span', { class: 'tag-label' }, tag.name));
          if (/^#[0-9a-f]{6}$/i.test(tag.color)) badge.style.setProperty('--tag-color', tag.color);
          const remove = el('button', {
            type: 'button',
            class: 'tag-remove borderless danger-text',
            'aria-label': t('Tag entfernen') + ': ' + tag.name,
            title: t('Tag entfernen')
          });
          remove.append(icon('close'));
          remove.addEventListener('click', () => {
            node.tags = (node.tags || []).filter((id) => id !== tag.id);
            updateTags();
          });
          badge.append(remove);
          badges.append(badge);
        }
        picker.disabled = !allTags.some((tag) => !(node.tags || []).includes(tag.id));
        searchable_select_default.refresh(picker);
      }
      picker.addEventListener('change', () => {
        if (!allTags.some((tag) => tag.id === picker.value)) return;
        node.tags = [.../* @__PURE__ */ new Set([...(node.tags || []), picker.value])];
        updateTags();
      });
      paintTags();
      if (!allTags.length)
        list.append(
          el('p', { class: 'source-help' }, t('Globale Tags in den Einstellungen anlegen.'))
        );
      section.append(list);
      panel.append(section);
    }
    return { nodeBadgeRows, nodeBadgeHeight, renderNodeBadges, reviewControls };
  }
};
var tags_default2 = tags_default;

// static/app/logs.js
var logs_default = {
  name: 'logs',
  dependencies: ['$', 'api', 'el', 'save', 'show'],
  create({ workspaceState, logsState, $, api, el, save, show }) {
    let generation = 0;
    async function renderLogs(append = false) {
      if (!workspaceState.project) return;
      const current = ++generation;
      const response = await api(
        '/api/projects/' +
          workspaceState.project.id +
          '/logs?q=' +
          encodeURIComponent($('logsSearch').value) +
          '&offset=' +
          (append ? logsState.logRecords.length : 0)
      );
      if (current !== generation) return;
      logsState.logRecords = append ? [...logsState.logRecords, ...response.rows] : response.rows;
      $('logsCount').textContent = logsState.logRecords.length + ' ' + t('Zeilen');
      $('logsBody').replaceChildren(
        ...logsState.logRecords.map((row) => el('div', { class: 'log-line' }, row.text))
      );
      if (!logsState.logRecords.length)
        $('logsBody').append(
          el('p', { class: 'empty-state' }, t('Keine passenden Logeintr\xE4ge.'))
        );
      $('logsMore').hidden = !response.more;
    }
    async function openLogs() {
      await save();
      logsState.logRecords = [];
      show('logsView');
      await renderLogs();
    }
    function exportLogs() {
      const limit = Number($('logsLimit').value);
      if (!Number.isInteger(limit) || limit < 0) throw Error(t('Ung\xFCltige Zeilenzahl'));
      const link = el('a', {
        href:
          '/api/projects/' +
          workspaceState.project.id +
          '/logs-export?limit=' +
          limit +
          '&q=' +
          encodeURIComponent($('logsSearch').value),
        download: 'argus-logs.txt'
      });
      document.body.append(link);
      link.click();
      link.remove();
    }
    async function clearLogs() {
      await save();
      const result = await api('/api/projects/' + workspaceState.project.id + '/logs-clear', {
        revision: workspaceState.project.revision
      });
      workspaceState.project = result;
      workspaceState.lastServerSnapshot = structuredClone(result.document);
      await renderLogs();
    }
    return { renderLogs, openLogs, exportLogs, clearLogs };
  }
};
var logs_default2 = logs_default;

// static/app/bindings.js
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
var bindings_default2 = bindings_default;

// static/app/state.js
function createState() {
  return {
    workspaceState: {
      project: null,
      lastServerSnapshot: null,
      lastServerTitle: null,
      templates: {}
    },
    persistenceState: {
      dirty: false,
      busy: false,
      savePromise: null,
      changeVersion: 0,
      autosaveTimer: null,
      saveError: '',
      dirtyNodes: /* @__PURE__ */ new Set()
    },
    selectionState: {
      selected: /* @__PURE__ */ new Set(),
      selectedEdges: /* @__PURE__ */ new Set(),
      selectedGroup: null,
      selectedGroups: /* @__PURE__ */ new Set(),
      inspectorSelectionKey: '',
      lastPaletteSelection: ''
    },
    canvasState: {
      pan: {
        x: 60,
        y: 70,
        scale: 1
      },
      drag: null,
      keyboardNode: null,
      groupBoundsCache: null,
      connecting: null,
      touchSelection: false,
      spacePressed: false,
      touchPointers: /* @__PURE__ */ new Map(),
      pinchGesture: null,
      gestureBlocked: false,
      leftCollapsed: false,
      rightCollapsed: true
    },
    executionState: {
      preflighting: /* @__PURE__ */ new Set(),
      activeActors: /* @__PURE__ */ new Set(),
      actorQueue: [],
      queueRunning: false,
      currentActorJob: null
    },
    pluginsState: {
      pluginSettingsOpen: /* @__PURE__ */ new Set(),
      pendingPluginTimers: /* @__PURE__ */ new Map(),
      activePluginForms: /* @__PURE__ */ new Map(),
      pendingPluginDirty: /* @__PURE__ */ new Set(),
      pendingPluginSaves: /* @__PURE__ */ new Set(),
      providerCatalogue: [],
      providerIndex: /* @__PURE__ */ new Map(),
      dataPlugins: [],
      dataTypes: /* @__PURE__ */ new Map(),
      catalog: [],
      libraryItems: [],
      repositories: []
    },
    preferencesState: {
      appSettings: {
        language: 'de'
      },
      settingsPromise: null,
      settingsError: '',
      settingsDirty: false,
      pendingSettingsTimer: null
    },
    historyState: {
      undoStack: [],
      redoStack: [],
      lastSnapshot: null,
      lastHistoryScope: '',
      lastHistoryAt: 0,
      historyMuted: false,
      internalClipboard: '',
      pendingClipboardPaste: null
    },
    uploadsState: {
      pendingImagePosition: null,
      pendingUploadType: 'image'
    },
    libraryState: {
      homeMode: 'active',
      projectIndex: [],
      homeQueries: {
        active: '',
        archive: ''
      },
      paletteState: {
        node: {
          query: '',
          categories: [],
          sort: 'category_az'
        },
        actor: {
          query: '',
          categories: [],
          sort: 'category_az'
        }
      }
    },
    shellState: {
      backendOnline: null,
      backendCheckAt: null,
      dialogRequest: null
    },
    logsState: {
      logRecords: [],
      logTotal: 0
    }
  };
}

// static/number-field.js
var controls = /* @__PURE__ */ new WeakMap();
function enhance(input) {
  if (controls.has(input)) return;
  const wrapper = document.createElement('span');
  wrapper.className = 'number-field';
  const steps = document.createElement('span');
  steps.className = 'number-steps';
  input.before(wrapper);
  wrapper.append(input, steps);
  const buttons = [1, -1].map((direction) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'number-step borderless';
    button.dataset.direction = direction;
    button.append(icon(direction > 0 ? 'chevron-up' : 'chevron-down'));
    button.addEventListener('click', () => {
      if (input.disabled || input.readOnly) return;
      if (input.step === 'any') {
        const value = Number(input.value || 0) + direction;
        input.value = Math.max(
          input.min === '' ? -Infinity : Number(input.min),
          Math.min(input.max === '' ? Infinity : Number(input.max), value)
        );
      } else {
        input[direction > 0 ? 'stepUp' : 'stepDown']();
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      update();
    });
    steps.append(button);
    return button;
  });
  function update() {
    buttons.forEach((button, index) => {
      const bound = index === 0 ? input.max : input.min;
      const atBound =
        input.value !== '' &&
        bound !== '' &&
        (index === 0 ? Number(input.value) >= Number(bound) : Number(input.value) <= Number(bound));
      button.disabled = input.disabled || input.readOnly || atBound;
      const label = input.getAttribute('aria-label') || input.labels?.[0]?.textContent || '';
      button.setAttribute(
        'aria-label',
        t(index === 0 ? 'Zahl erh\xF6hen' : 'Zahl verringern') + (label ? ': ' + label.trim() : '')
      );
    });
  }
  controls.set(input, update);
  input.addEventListener('input', update);
  input.addEventListener('change', update);
  update();
}
function setupNumberFields() {
  const scan = (root) => {
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    if (root.matches('input[type="number"]')) enhance(root);
    root.querySelectorAll('input[type="number"]').forEach(enhance);
  };
  scan(document.body);
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') controls.get(record.target)?.();
      else record.addedNodes.forEach(scan);
    }
  }).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['min', 'max', 'step', 'disabled', 'readonly', 'aria-label']
  });
  document.addEventListener('argus:language', () => {
    document.querySelectorAll('input[type="number"]').forEach((input) => controls.get(input)?.());
  });
}

// static/main.js
function createApplication(state = createState()) {
  const {
    workspaceState,
    persistenceState,
    selectionState,
    canvasState,
    executionState,
    pluginsState,
    preferencesState,
    historyState,
    uploadsState,
    libraryState,
    shellState,
    logsState
  } = state;
  const configureUi = bindings_configure_ui_default2.create({
    decorateButton: (...args) => shell.decorateButton(...args),
    fieldName: (...args) => fields.fieldName(...args),
    toast: (...args) => shell.toast(...args),
    uid: (...args) => shell.uid(...args)
  });
  const bindNavigation = bindings_navigation_default2.create({
    libraryState,
    preferencesState,
    $: (...args) => shell.$(...args),
    api: (...args) => api.api(...args),
    bind: (...args) => shell.bind(...args),
    draggableDialog: (...args) => shell.draggableDialog(...args),
    home: (...args) => projects.home(...args),
    openLibrary: (...args) => pluginLibrary.openLibrary(...args),
    openProject: (...args) => projects.openProject(...args),
    openRepositories: (...args) => pluginLibrary.openRepositories(...args),
    persistLanguage: (...args) => settings.persistLanguage(...args),
    pluginsHome: (...args) => pluginSettings.pluginsHome(...args),
    refreshLibrary: (...args) => pluginLibrary.refreshLibrary(...args),
    renderInstalled: (...args) => pluginSettings.renderInstalled(...args),
    renderLibrary: (...args) => pluginLibrary.renderLibrary(...args),
    renderProjects: (...args) => projects.renderProjects(...args),
    renderRepositories: (...args) => pluginLibrary.renderRepositories(...args),
    settingsHome: (...args) => settings.settingsHome(...args),
    settingsState: (...args) => settings.settingsState(...args),
    toast: (...args) => shell.toast(...args)
  });
  const bindWorkspace = bindings_workspace_default2.create({
    parameterModal: (...args) => shell.parameterModal(...args),
    canvasState,
    selectionState,
    workspaceState,
    $: (...args) => shell.$(...args),
    applyHistory: (...args) => history2.applyHistory(...args),
    arrangeProject: (...args) => layout.arrangeProject(...args),
    bind: (...args) => shell.bind(...args),
    cancelConnection: (...args) => canvasInput.cancelConnection(...args),
    centerProject: (...args) => layout.centerProject(...args),
    change: (...args) => persistence.change(...args),
    createGroupFromSelection: (...args) => groups.createGroupFromSelection(...args),
    deleteSelection: (...args) => nodeCommands.deleteSelection(...args),
    deleteSelectionWithChildren: (...args) => nodeCommands.deleteSelectionWithChildren(...args),
    detachNodes: (...args) => groups.detachNodes(...args),
    dissolveSelectedGroups: (...args) => groups.dissolveSelectedGroups(...args),
    inspect: (...args) => inspector.inspect(...args),
    panelVisibility: (...args) => shell.panelVisibility(...args),
    render: (...args) => canvasRenderer.render(...args),
    save: (...args) => persistence.save(...args),
    setAllGroups: (...args) => groups.setAllGroups(...args),
    setupPaletteControls: (...args) => palette.setupPaletteControls(...args),
    show: (...args) => shell.show(...args),
    toast: (...args) => shell.toast(...args),
    zoomAt: (...args) => canvasInput.zoomAt(...args),
    zoomStep: (...args) => canvasInput.zoomStep(...args)
  });
  const bindCanvas = bindings_canvas_default2.create({
    canvasState,
    workspaceState,
    uploadsState,
    $: (...args) => shell.$(...args),
    cancelConnection: (...args) => canvasInput.cancelConnection(...args),
    canvasPointerDown: (...args) => canvasInput.canvasPointerDown(...args),
    canvasPointerUp: (...args) => canvasInput.canvasPointerUp(...args),
    dropPalette: (...args) => palette.dropPalette(...args),
    removeSelectionFrame: (...args) => canvasInput.removeSelectionFrame(...args),
    render: (...args) => canvasRenderer.render(...args),
    resizablePanel: (...args) => shell.resizablePanel(...args),
    textEditing: (...args) => clipboard.textEditing(...args),
    toast: (...args) => shell.toast(...args),
    touchGestureEvent: (...args) => canvasInput.touchGestureEvent(...args),
    updateDrag: (...args) => canvasInput.updateDrag(...args),
    uploadNodeFile: (...args) => uploads.uploadNodeFile(...args),
    zoomAt: (...args) => canvasInput.zoomAt(...args)
  });
  const bindShortcuts = bindings_shortcuts_default2.create({
    workspaceState,
    selectionState,
    historyState,
    persistenceState,
    $: (...args) => shell.$(...args),
    applyHistory: (...args) => history2.applyHistory(...args),
    copyGraph: (...args) => clipboard.copyGraph(...args),
    deleteSelection: (...args) => nodeCommands.deleteSelection(...args),
    graphClipboardText: (...args) => clipboard.graphClipboardText(...args),
    inspect: (...args) => inspector.inspect(...args),
    pasteGraph: (...args) => clipboard.pasteGraph(...args),
    render: (...args) => canvasRenderer.render(...args),
    textEditing: (...args) => clipboard.textEditing(...args)
  });
  const bindLifecycle = bindings_lifecycle_default2.create({
    persistenceState,
    preferencesState,
    pluginsState,
    executionState,
    $: (...args) => shell.$(...args),
    bind: (...args) => shell.bind(...args),
    bootstrap: (...args) => shell.bootstrap(...args),
    cancelCurrentActor: (...args) => actors.cancelCurrentActor(...args),
    clearLogs: (...args) => logs.clearLogs(...args),
    draggableDialog: (...args) => shell.draggableDialog(...args),
    exportLogs: (...args) => logs.exportLogs(...args),
    finishDialog: (...args) => shell.finishDialog(...args),
    openLogs: (...args) => logs.openLogs(...args),
    renderLogs: (...args) => logs.renderLogs(...args),
    resizePaletteSplit: (...args) => shell.resizePaletteSplit(...args),
    show: (...args) => shell.show(...args),
    toast: (...args) => shell.toast(...args)
  });
  const nodeRenderer = node_renderer_default2.create({
    selectionState,
    canvasState,
    persistenceState,
    $: (...args) => shell.$(...args),
    actorTitle: (...args) => catalogue.actorTitle(...args),
    change: (...args) => persistence.change(...args),
    dataLabel: (...args) => catalogue.dataLabel(...args),
    el: (...args) => shell.el(...args),
    fitNodeText: (...args) => canvasRenderer.fitNodeText(...args),
    inspect: (...args) => inspector.inspect(...args),
    nodeBadgeHeight: (...args) => tags.nodeBadgeHeight(...args),
    nodeExtras: (...args) => resources.nodeExtras(...args),
    nodeIcon: (...args) => canvasRenderer.nodeIcon(...args),
    nodePorts: (...args) => canvasInput.nodePorts(...args),
    nodeRect: (...args) => canvasRenderer.nodeRect(...args),
    nodeTitle: (...args) => catalogue.nodeTitle(...args),
    noteInk: (...args) => inspector.noteInk(...args),
    providerName: (...args) => providers.providerName(...args),
    render: (...args) => canvasRenderer.render(...args),
    renderLocationAddress: (...args) => locationFields.renderLocationAddress(...args),
    short: (...args) => canvasRenderer.short(...args),
    summary: (...args) => canvasRenderer.summary(...args),
    svg: (...args) => shell.svg(...args)
  });
  const edgeRenderer = edge_renderer_default2.create({
    askText: (...args) => shell.askText(...args),
    change: (...args) => persistence.change(...args),
    deleteEdges: (...args) => nodeCommands.deleteEdges(...args),
    edgeBundleIds: (...args) => canvasRenderer.edgeBundleIds(...args),
    measureEdgeText: (...args) => canvasRenderer.measureEdgeText(...args),
    nodeRect: (...args) => canvasRenderer.nodeRect(...args),
    render: (...args) => canvasRenderer.render(...args),
    routeConnection: (...args) => geometry.routeConnection(...args),
    selectEdge: (...args) => canvasRenderer.selectEdge(...args),
    svg: (...args) => shell.svg(...args),
    toast: (...args) => shell.toast(...args)
  });
  const groupRenderer = group_renderer_default2.create({
    selectionState,
    persistenceState,
    $: (...args) => shell.$(...args),
    change: (...args) => persistence.change(...args),
    groupBounds: (...args) => groups.groupBounds(...args),
    groupNodeIds: (...args) => groups.groupNodeIds(...args),
    groupTitle: (...args) => groups.groupTitle(...args),
    inspectGroup: (...args) => inspector.inspectGroup(...args),
    moveGroup: (...args) => groups.moveGroup(...args),
    render: (...args) => canvasRenderer.render(...args),
    short: (...args) => canvasRenderer.short(...args),
    startGroupDrag: (...args) => canvasInput.startGroupDrag(...args),
    svg: (...args) => shell.svg(...args),
    toggleGroup: (...args) => groups.toggleGroup(...args)
  });
  const shell = shell_default2.create({
    shellState,
    executionState,
    persistenceState,
    preferencesState,
    pluginsState,
    workspaceState,
    canvasState,
    selectionState,
    api: (...args) => api.api(...args),
    cancelConnection: (...args) => canvasInput.cancelConnection(...args),
    home: (...args) => projects.home(...args),
    refreshCatalog: (...args) => catalogue.refreshCatalog(...args),
    setupProviderDismissal: (...args) => providers.setupProviderDismissal(...args),
    startJobMonitor: (...args) => actors.startJobMonitor(...args)
  });
  const api = api_default2.create({
    shellState,
    updateStatus: (...args) => shell.updateStatus(...args)
  });
  const projects = projects_default2.create({
    libraryState,
    persistenceState,
    workspaceState,
    selectionState,
    canvasState,
    historyState,
    $: (...args) => shell.$(...args),
    api: (...args) => api.api(...args),
    askConfirm: (...args) => shell.askConfirm(...args),
    button: (...args) => shell.button(...args),
    el: (...args) => shell.el(...args),
    historyButtons: (...args) => history2.historyButtons(...args),
    inspect: (...args) => inspector.inspect(...args),
    panelVisibility: (...args) => shell.panelVisibility(...args),
    projectSnapshot: (...args) => history2.projectSnapshot(...args),
    parameterModal: (...args) => shell.parameterModal(...args),
    render: (...args) => canvasRenderer.render(...args),
    save: (...args) => persistence.save(...args),
    saveButtons: (...args) => persistence.saveButtons(...args),
    searchText: (...args) => shell.searchText(...args),
    show: (...args) => shell.show(...args),
    toast: (...args) => shell.toast(...args),
    updateStatus: (...args) => shell.updateStatus(...args)
  });
  const persistence = persistence_default2.create({
    persistenceState,
    workspaceState,
    canvasState,
    $: (...args) => shell.$(...args),
    api: (...args) => api.api(...args),
    recordHistory: (...args) => history2.recordHistory(...args),
    saveIndicator: (...args) => shell.saveIndicator(...args),
    toast: (...args) => shell.toast(...args),
    updateStatus: (...args) => shell.updateStatus(...args)
  });
  const nodeCommands = node_commands_default2.create({
    preferencesState,
    canvasState,
    pluginsState,
    workspaceState,
    selectionState,
    persistenceState,
    uploadsState,
    $: (...args) => shell.$(...args),
    actionAcceptsNode: (...args) => palette.actionAcceptsNode(...args),
    actorIncompatible: (...args) => palette.actorIncompatible(...args),
    change: (...args) => persistence.change(...args),
    freeNodeSpot: (...args) => layout.freeNodeSpot(...args),
    groupDescendantIds: (...args) => groups.groupDescendantIds(...args),
    groupNodeIds: (...args) => groups.groupNodeIds(...args),
    inspect: (...args) => inspector.inspect(...args),
    newNodeLabel: (...args) => catalogue.newNodeLabel(...args),
    nodeRect: (...args) => canvasRenderer.nodeRect(...args),
    pluginText: (...args) => catalogue.pluginText(...args),
    pruneGroups: (...args) => groups.pruneGroups(...args),
    render: (...args) => canvasRenderer.render(...args),
    uid: (...args) => shell.uid(...args)
  });
  const layout = layout_default2.create({
    workspaceState,
    persistenceState,
    canvasState,
    $: (...args) => shell.$(...args),
    change: (...args) => persistence.change(...args),
    groupAncestors: (...args) => groups.groupAncestors(...args),
    groupBounds: (...args) => groups.groupBounds(...args),
    groupDescendantIds: (...args) => groups.groupDescendantIds(...args),
    groupNodeIds: (...args) => groups.groupNodeIds(...args),
    hiddenGroupIds: (...args) => groups.hiddenGroupIds(...args),
    intersects: (...args) => geometry.intersects(...args),
    nodeRect: (...args) => canvasRenderer.nodeRect(...args),
    orderedGroups: (...args) => groups.orderedGroups(...args),
    render: (...args) => canvasRenderer.render(...args)
  });
  const groups = groups_default2.create({
    canvasState,
    workspaceState,
    persistenceState,
    selectionState,
    pluginsState,
    askText: (...args) => shell.askText(...args),
    change: (...args) => persistence.change(...args),
    freeNodeSpot: (...args) => layout.freeNodeSpot(...args),
    inspect: (...args) => inspector.inspect(...args),
    inspectGroup: (...args) => inspector.inspectGroup(...args),
    makeRoomForGroup: (...args) => layout.makeRoomForGroup(...args),
    nodeRect: (...args) => canvasRenderer.nodeRect(...args),
    pluginText: (...args) => catalogue.pluginText(...args),
    render: (...args) => canvasRenderer.render(...args),
    uid: (...args) => shell.uid(...args)
  });
  const canvasRenderer = canvas_renderer_default2.create({
    workspaceState,
    canvasState,
    pluginsState,
    executionState,
    selectionState,
    $: (...args) => shell.$(...args),
    formatLocation: (...args) => locationFields.formatLocation(...args),
    graphGroupModel: (...args) => groups.graphGroupModel(...args),
    groupNodeIds: (...args) => groups.groupNodeIds(...args),
    inspect: (...args) => inspector.inspect(...args),
    locationDisplayLines: (...args) => locationFields.locationDisplayLines(...args),
    nodeBadgeHeight: (...args) => tags.nodeBadgeHeight(...args),
    noteInk: (...args) => inspector.noteInk(...args),
    pluginText: (...args) => catalogue.pluginText(...args),
    renderEdges: (...args) => edgeRenderer.renderEdges(...args),
    renderGroups: (...args) => groupRenderer.renderGroups(...args),
    renderNodes: (...args) => nodeRenderer.renderNodes(...args),
    resourceActions: (...args) => resources.resourceActions(...args),
    svg: (...args) => shell.svg(...args),
    updateMapOverlays: (...args) => resources.updateMapOverlays(...args)
  });
  const canvasInput = canvas_input_default2.create({
    selectionState,
    persistenceState,
    canvasState,
    workspaceState,
    $: (...args) => shell.$(...args),
    change: (...args) => persistence.change(...args),
    groupBounds: (...args) => groups.groupBounds(...args),
    groupNodeIds: (...args) => groups.groupNodeIds(...args),
    inspect: (...args) => inspector.inspect(...args),
    inspectGroup: (...args) => inspector.inspectGroup(...args),
    nodeRect: (...args) => canvasRenderer.nodeRect(...args),
    portPosition: (...args) => geometry.portPosition(...args),
    render: (...args) => canvasRenderer.render(...args),
    svg: (...args) => shell.svg(...args),
    uid: (...args) => shell.uid(...args)
  });
  const geometry = geometry_default2.create({});
  const inspector = inspector_default2.create({
    selectionState,
    workspaceState,
    pluginsState,
    executionState,
    canvasState,
    $: (...args) => shell.$(...args),
    actorIncompatible: (...args) => palette.actorIncompatible(...args),
    applyFields: (...args) => fields.applyFields(...args),
    applyGraphHighlights: (...args) => canvasRenderer.applyGraphHighlights(...args),
    button: (...args) => shell.button(...args),
    change: (...args) => persistence.change(...args),
    dataLabel: (...args) => catalogue.dataLabel(...args),
    deleteEdges: (...args) => nodeCommands.deleteEdges(...args),
    deleteGroup: (...args) => nodeCommands.deleteGroup(...args),
    deleteNodes: (...args) => nodeCommands.deleteNodes(...args),
    detachNodes: (...args) => groups.detachNodes(...args),
    displayControls: (...args) => resources.displayControls(...args),
    dissolveGroup: (...args) => groups.dissolveGroup(...args),
    editFields: (...args) => fields.editFields(...args),
    editableNodeData: (...args) => nodeCommands.editableNodeData(...args),
    el: (...args) => shell.el(...args),
    facts: (...args) => fields.facts(...args),
    formatLocation: (...args) => locationFields.formatLocation(...args),
    groupNodeIds: (...args) => groups.groupNodeIds(...args),
    groupTitle: (...args) => groups.groupTitle(...args),
    iconActionButton: (...args) => shell.iconActionButton(...args),
    inputField: (...args) => fields.inputField(...args),
    inspectorAvailability: (...args) => shell.inspectorAvailability(...args),
    makeRoomForGroup: (...args) => layout.makeRoomForGroup(...args),
    nodePlugin: (...args) => catalogue.nodePlugin(...args),
    phoneControls: (...args) => locationFields.phoneControls(...args),
    pluginText: (...args) => catalogue.pluginText(...args),
    refreshDetailMap: (...args) => resources.refreshDetailMap(...args),
    render: (...args) => canvasRenderer.render(...args),
    renderPalette: (...args) => palette.renderPalette(...args),
    reviewControls: (...args) => tags.reviewControls(...args),
    run: (...args) => actors.run(...args),
    saveButtons: (...args) => persistence.saveButtons(...args),
    toast: (...args) => shell.toast(...args),
    toggleGroup: (...args) => groups.toggleGroup(...args)
  });
  const fields = fields_default2.create({
    countryRegionSelect: (...args) => locationFields.countryRegionSelect(...args),
    el: (...args) => shell.el(...args),
    providerField: (...args) => providers.providerField(...args),
    uid: (...args) => shell.uid(...args)
  });
  const palette = palette_default2.create({
    libraryState,
    workspaceState,
    pluginsState,
    persistenceState,
    selectionState,
    canvasState,
    $: (...args) => shell.$(...args),
    actorIcon: (...args) => canvasRenderer.actorIcon(...args),
    addActor: (...args) => nodeCommands.addActor(...args),
    addData: (...args) => nodeCommands.addData(...args),
    button: (...args) => shell.button(...args),
    dataIcon: (...args) => canvasRenderer.dataIcon(...args),
    dataLabel: (...args) => catalogue.dataLabel(...args),
    dropFiles: (...args) => uploads.dropFiles(...args),
    el: (...args) => shell.el(...args),
    pluginText: (...args) => catalogue.pluginText(...args),
    providerSearchKey: (...args) => providers.providerSearchKey(...args),
    render: (...args) => canvasRenderer.render(...args),
    searchText: (...args) => shell.searchText(...args),
    selectedData: (...args) => nodeCommands.selectedData(...args),
    toast: (...args) => shell.toast(...args),
    updateDeleteButtons: (...args) => nodeCommands.updateDeleteButtons(...args)
  });
  const actors = actors_default2.create({
    workspaceState,
    executionState,
    pluginsState,
    actorTitle: (...args) => catalogue.actorTitle(...args),
    api: (...args) => api.api(...args),
    change: (...args) => persistence.change(...args),
    inspect: (...args) => inspector.inspect(...args),
    reconcileWorkspace: (...args) => persistence.reconcileWorkspace(...args),
    modalChoice: (...args) => shell.modalChoice(...args),
    openPluginSettings: (...args) => pluginSettings.openPluginSettings(...args),
    parameterModal: (...args) => shell.parameterModal(...args),
    render: (...args) => canvasRenderer.render(...args),
    save: (...args) => persistence.save(...args),
    toast: (...args) => shell.toast(...args),
    updateStatus: (...args) => shell.updateStatus(...args)
  });
  const history2 = history_default2.create({
    workspaceState,
    persistenceState,
    historyState,
    selectionState,
    $: (...args) => shell.$(...args),
    change: (...args) => persistence.change(...args),
    inspect: (...args) => inspector.inspect(...args),
    render: (...args) => canvasRenderer.render(...args)
  });
  const clipboard = clipboard_default2.create({
    workspaceState,
    historyState,
    selectionState,
    persistenceState,
    canvasState,
    $: (...args) => shell.$(...args),
    api: (...args) => api.api(...args),
    change: (...args) => persistence.change(...args),
    groupNodeIds: (...args) => groups.groupNodeIds(...args),
    inspect: (...args) => inspector.inspect(...args),
    openProject: (...args) => projects.openProject(...args),
    render: (...args) => canvasRenderer.render(...args),
    toast: (...args) => shell.toast(...args),
    uid: (...args) => shell.uid(...args)
  });
  const catalogue = catalogue_default2.create({
    pluginsState,
    workspaceState,
    preferencesState,
    api: (...args) => api.api(...args),
    providerSearchKey: (...args) => providers.providerSearchKey(...args),
    renderPalette: (...args) => palette.renderPalette(...args)
  });
  const pluginSources = plugin_sources_default2.create({
    button: (...args) => shell.button(...args),
    editFields: (...args) => fields.editFields(...args),
    el: (...args) => shell.el(...args),
    pluginText: (...args) => catalogue.pluginText(...args),
    sourceLabel: (...args) => catalogue.sourceLabel(...args)
  });
  const pluginSettings = plugin_settings_default2.create({
    pluginsState,
    preferencesState,
    $: (...args) => shell.$(...args),
    api: (...args) => api.api(...args),
    applyFields: (...args) => fields.applyFields(...args),
    button: (...args) => shell.button(...args),
    dataPluginSettings: (...args) => pluginSources.dataPluginSettings(...args),
    editFields: (...args) => fields.editFields(...args),
    el: (...args) => shell.el(...args),
    iconActionButton: (...args) => shell.iconActionButton(...args),
    leaveWorkspace: (...args) => projects.leaveWorkspace(...args),
    parameterModal: (...args) => shell.parameterModal(...args),
    pluginDisplayName: (...args) => catalogue.pluginDisplayName(...args),
    pluginText: (...args) => catalogue.pluginText(...args),
    providerFieldKeys: (...args) => pluginSources.providerFieldKeys(...args),
    refreshCatalog: (...args) => catalogue.refreshCatalog(...args),
    saveIndicator: (...args) => shell.saveIndicator(...args),
    searchText: (...args) => shell.searchText(...args),
    show: (...args) => shell.show(...args),
    sourceOrderControl: (...args) => pluginSources.sourceOrderControl(...args),
    toast: (...args) => shell.toast(...args),
    updateStatus: (...args) => shell.updateStatus(...args)
  });
  const pluginLibrary = plugin_library_default2.create({
    pluginsState,
    $: (...args) => shell.$(...args),
    api: (...args) => api.api(...args),
    askConfirm: (...args) => shell.askConfirm(...args),
    button: (...args) => shell.button(...args),
    el: (...args) => shell.el(...args),
    pluginDisplayName: (...args) => catalogue.pluginDisplayName(...args),
    pluginText: (...args) => catalogue.pluginText(...args),
    refreshCatalog: (...args) => catalogue.refreshCatalog(...args),
    renderInstalled: (...args) => pluginSettings.renderInstalled(...args),
    searchText: (...args) => shell.searchText(...args)
  });
  const settings = settings_default2.create({
    preferencesState,
    $: (...args) => shell.$(...args),
    api: (...args) => api.api(...args),
    askText: (...args) => shell.askText(...args),
    el: (...args) => shell.el(...args),
    iconActionButton: (...args) => shell.iconActionButton(...args),
    leaveWorkspace: (...args) => projects.leaveWorkspace(...args),
    renderProjects: (...args) => projects.renderProjects(...args),
    saveIndicator: (...args) => shell.saveIndicator(...args),
    show: (...args) => shell.show(...args),
    toast: (...args) => shell.toast(...args),
    uid: (...args) => shell.uid(...args),
    updateStatus: (...args) => shell.updateStatus(...args)
  });
  const resources = resources_default2.create({
    api: (...args) => api.api(...args),
    pluginsState,
    canvasState,
    workspaceState,
    $: (...args) => shell.$(...args),
    button: (...args) => shell.button(...args),
    change: (...args) => persistence.change(...args),
    el: (...args) => shell.el(...args),
    locationDisplayLines: (...args) => locationFields.locationDisplayLines(...args),
    makeRoomForNode: (...args) => layout.makeRoomForNode(...args),
    nodeRect: (...args) => canvasRenderer.nodeRect(...args),
    render: (...args) => canvasRenderer.render(...args),
    renderNodeBadges: (...args) => tags.renderNodeBadges(...args),
    svg: (...args) => shell.svg(...args),
    toast: (...args) => shell.toast(...args)
  });
  const locationFields = location_fields_default2.create({
    el: (...args) => shell.el(...args),
    measureEdgeText: (...args) => canvasRenderer.measureEdgeText(...args),
    svg: (...args) => shell.svg(...args)
  });
  const uploads = uploads_default2.create({
    workspaceState,
    canvasState,
    $: (...args) => shell.$(...args),
    modalChoice: (...args) => shell.modalChoice(...args),
    newNode: (...args) => nodeCommands.newNode(...args)
  });
  const providers = providers_default2.create({
    pluginsState,
    button: (...args) => shell.button(...args),
    el: (...args) => shell.el(...args)
  });
  const tags = tags_default2.create({
    preferencesState,
    canvasState,
    change: (...args) => persistence.change(...args),
    el: (...args) => shell.el(...args),
    fitNodeText: (...args) => canvasRenderer.fitNodeText(...args),
    makeRoomForNode: (...args) => layout.makeRoomForNode(...args),
    measureEdgeText: (...args) => canvasRenderer.measureEdgeText(...args),
    render: (...args) => canvasRenderer.render(...args),
    resourceActions: (...args) => resources.resourceActions(...args),
    svg: (...args) => shell.svg(...args)
  });
  const logs = logs_default2.create({
    workspaceState,
    logsState,
    $: (...args) => shell.$(...args),
    api: (...args) => api.api(...args),
    el: (...args) => shell.el(...args),
    save: (...args) => persistence.save(...args),
    show: (...args) => shell.show(...args)
  });
  const bindings = bindings_default2.create({
    configureUi: (...args) => configureUi.configureUi(...args),
    bindNavigation: (...args) => bindNavigation.bindNavigation(...args),
    bindWorkspace: (...args) => bindWorkspace.bindWorkspace(...args),
    bindCanvas: (...args) => bindCanvas.bindCanvas(...args),
    bindShortcuts: (...args) => bindShortcuts.bindShortcuts(...args),
    bindLifecycle: (...args) => bindLifecycle.bindLifecycle(...args)
  });
  return {
    initialize: bindings.initialize,
    state,
    features: {
      configureUi,
      bindNavigation,
      bindWorkspace,
      bindCanvas,
      bindShortcuts,
      bindLifecycle,
      nodeRenderer,
      edgeRenderer,
      groupRenderer,
      shell,
      api,
      projects,
      persistence,
      nodeCommands,
      layout,
      groups,
      canvasRenderer,
      canvasInput,
      geometry,
      inspector,
      fields,
      palette,
      actors,
      history: history2,
      clipboard,
      catalogue,
      pluginSources,
      pluginSettings,
      pluginLibrary,
      settings,
      resources,
      locationFields,
      uploads,
      providers,
      tags,
      logs,
      bindings
    }
  };
}
if (
  typeof document !== 'undefined' &&
  !globalThis.ARGUS_TEST_MODE &&
  !globalThis.ARGUS_MOBILE_BLOCKED
) {
  setupNumberFields();
  createApplication().initialize();
}
export {
  actors_default2 as actorsFeature,
  api_default2 as apiFeature,
  bindings_canvas_default2 as bindCanvasFeature,
  bindings_lifecycle_default2 as bindLifecycleFeature,
  bindings_navigation_default2 as bindNavigationFeature,
  bindings_shortcuts_default2 as bindShortcutsFeature,
  bindings_workspace_default2 as bindWorkspaceFeature,
  bindings_default2 as bindingsFeature,
  canvas_input_default2 as canvasInputFeature,
  canvas_renderer_default2 as canvasRendererFeature,
  catalogue_default2 as catalogueFeature,
  clipboard_default2 as clipboardFeature,
  bindings_configure_ui_default2 as configureUiFeature,
  createApplication,
  createState,
  edge_renderer_default2 as edgeRendererFeature,
  fields_default2 as fieldsFeature,
  geometry_default2 as geometryFeature,
  group_renderer_default2 as groupRendererFeature,
  groups_default2 as groupsFeature,
  history_default2 as historyFeature,
  inspector_default2 as inspectorFeature,
  layout_default2 as layoutFeature,
  location_fields_default2 as locationFieldsFeature,
  logs_default2 as logsFeature,
  node_commands_default2 as nodeCommandsFeature,
  node_renderer_default2 as nodeRendererFeature,
  palette_default2 as paletteFeature,
  persistence_default2 as persistenceFeature,
  plugin_library_default2 as pluginLibraryFeature,
  plugin_settings_default2 as pluginSettingsFeature,
  plugin_sources_default2 as pluginSourcesFeature,
  projects_default2 as projectsFeature,
  providers_default2 as providersFeature,
  resources_default2 as resourcesFeature,
  graph_routing_default as routing,
  settings_default2 as settingsFeature,
  shell_default2 as shellFeature,
  tags_default2 as tagsFeature,
  uploads_default2 as uploadsFeature
};
