export let language = 'de',
  messages = {},
  fallbackMessages = {};
let orderedSources = [];
let translatedMessages = null;
function sources() {
  if (translatedMessages !== messages) {
    orderedSources = Object.keys(messages).sort((a, b) => b.length - a.length);
    translatedMessages = messages;
  }
  return orderedSources;
}
export function t(key, params = {}) {
  if (key === undefined || key === null) return '';
  let value = messages[key] ?? fallbackMessages[key];
  if (value === undefined) {
    value = String(key);
    for (const source of sources()) {
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
  for (const source of sources()) {
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
  messages = { ...pack.messages };
  // Historical generated labels may contain an English display value instead
  // of the stable translation key. Resolve only unambiguous exact aliases.
  const english = code === 'en' ? pack : await (await fetch('/locales/en.json')).json();
  const aliases = new Map();
  for (const [key, value] of Object.entries(english.messages)) {
    if (typeof value !== 'string' || !value || value === key) continue;
    const translated = messages[key] ?? fallbackMessages[key];
    if (translated === undefined) continue;
    if (aliases.has(value) && aliases.get(value) !== translated) aliases.set(value, null);
    else if (!aliases.has(value)) aliases.set(value, translated);
  }
  for (const [key, value] of aliases)
    if (value !== null && messages[key] === undefined) messages[key] = value;
  document.documentElement.lang = code;
  localStorage.setItem('argus.language', code);
  for (const element of document.querySelectorAll('[data-i18n]'))
    element.textContent = t(element.dataset.i18n);
  for (const attr of ['placeholder', 'aria-label', 'title'])
    for (const element of document.querySelectorAll('[data-i18n-' + attr + ']'))
      element.setAttribute(attr, t(element.getAttribute('data-i18n-' + attr)));
  document.dispatchEvent(new Event('argus:language'));
}
