/** Native shells and development builds keep their existing loading lifecycle. */
export function registerPwa(): void {
  if (!import.meta.env.PROD || window.ReaderAndroid || !window.isSecureContext
    || !['http:', 'https:'].includes(location.protocol) || !('serviceWorker' in navigator)) return;

  const register = () => {
    const base = new URL(import.meta.env.BASE_URL, document.baseURI);
    void navigator.serviceWorker.register(new URL('sw.js', base), {
      scope: base.pathname,
      updateViaCache: 'none',
    }).catch((error: unknown) => {
      // PWA availability must not prevent ordinary online reading.
      console.warn('离线应用缓存注册失败', error);
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
