import { t } from './i18n.js';
let csrf = null;
let authentication = null;

async function login() {
  if (location.hash.startsWith('#pair='))
    history.replaceState(null, '', location.pathname + location.search);
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Argus-Client': 'web' },
    body: '{}'
  });
  if (!response.ok) throw Error(t('ui.could_not_connect_to_argus'));
  csrf = (await response.json()).csrf_token;
}

export async function ensureAccess() {
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

export async function authorizedFetch(path, options = {}) {
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
