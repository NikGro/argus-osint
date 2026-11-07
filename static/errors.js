import messages from './errors.json';

/** English text for a stable error code; parameters fill {name} placeholders. */
export function errorText(code, params = {}) {
  let text = messages[code] ?? messages[code?.replace(/^errors\./, '')] ?? messages.internal_error;
  for (const [name, value] of Object.entries(params))
    text = text.replaceAll('{' + name + '}', String(value ?? ''));
  return text;
}
