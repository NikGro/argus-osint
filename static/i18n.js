export let language = 'de',
  messages = {},
  fallbackMessages = {};
export function t(key, params = {}) {
  if (key === undefined || key === null) return '';
  let value = messages[key] ?? fallbackMessages[key];
  if (value === undefined) {
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
export function diagnostic(value) {
  let text = String(value ?? '');
  for (const source of Object.keys(messages).sort((a, b) => b.length - a.length)) {
    if (source.length >= 10 && source !== messages[source])
      text = text.replaceAll(source, messages[source]);
  }
  return text;
}
export async function setLanguage(code) {
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
