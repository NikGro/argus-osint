// Presentation guard only. Requesting a desktop site intentionally bypasses it.
(() => {
  const mobile = /Android|iPhone|iPad|iPod|IEMobile|Windows Phone|Opera Mini|Mobi/i.test(
    navigator.userAgent
  );
  globalThis.ARGUS_MOBILE_BLOCKED = mobile;
  document.documentElement.classList.toggle('mobile-blocked', mobile);
  if (mobile)
    document.addEventListener('DOMContentLoaded', async () => {
      const { setLanguage } = await import('/i18n.js');
      let code =
        localStorage.getItem('argus.language') ||
        (navigator.language.startsWith('de') ? 'de' : 'en');
      try {
        const { authorizedFetch } = await import('/auth.js');
        const response = await authorizedFetch('/api/settings');
        if (response.ok) code = (await response.json()).settings.language || code;
      } catch {
        /* Cached language remains available while offline. */
      }
      await setLanguage(code);
    });
})();
