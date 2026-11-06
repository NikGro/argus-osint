// Presentation guard only. Requesting a desktop site intentionally bypasses it.
(() => {
  const mobile = /Android|iPhone|iPad|iPod|IEMobile|Windows Phone|Opera Mini|Mobi/i.test(
    navigator.userAgent
  );
  globalThis.ARGUS_MOBILE_BLOCKED = mobile;
  document.documentElement.classList.toggle('mobile-blocked', mobile);
})();
