import ArgusUI from './ui.js';
// Plugin-defined section toggles and numeric limits, shared by actor and settings forms.
const ArgusForms = (() => {
  function sections(parent, data, definitions = [], translate = (value) => value, help = '') {
    const readers = [],
      keys = new Set();
    if (!definitions.length) return { readers, keys };
    if (help) parent.append(ArgusUI.el('p', { class: 'source-help' }, translate(help)));
    for (const definition of definitions) {
      const key = definition.toggle;
      if (!(key in data)) continue;
      const section = ArgusUI.el('div', { class: 'parameter-section' });
      const toggle = ArgusUI.checkbox(
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
      const fields = ArgusUI.el('div', { class: 'parameter-limits' });
      for (const name of definition.limits || []) {
        if (!(name in data)) continue;
        const label = ArgusUI.el('label', {}, translate(name));
        const input = ArgusUI.el('input', {
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
              throw Error(translate('Limits müssen ganze Zahlen ab 0 sein.'));
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

export default ArgusForms;
