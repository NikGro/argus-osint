import { icon } from './icons.js';
import { t } from './i18n.js';

// Preserve native number validation and keyboard handling; only replace the spinner UI.
const controls = new WeakMap();
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
        t(index === 0 ? 'Zahl erhöhen' : 'Zahl verringern') + (label ? ': ' + label.trim() : '')
      );
    });
  }
  controls.set(input, update);
  input.addEventListener('input', update);
  input.addEventListener('change', update);
  update();
}
export function setupNumberFields() {
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
