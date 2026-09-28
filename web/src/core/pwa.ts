import '../styles/pwa.css';

/** Native shells and development builds keep their existing loading lifecycle. */
export function registerPwa(): void {
  if (!import.meta.env.PROD || window.ReaderAndroid || !window.isSecureContext
    || !['http:', 'https:'].includes(location.protocol) || !('serviceWorker' in navigator)) return;

  const register = () => {
    const base = new URL(import.meta.env.BASE_URL, document.baseURI);
    void navigator.serviceWorker.register(new URL('sw.js', base), {
      scope: base.pathname,
      updateViaCache: 'none',
    }).then((registration) => watchPwaUpdates(registration)).catch((error: unknown) => {
      // PWA availability must not prevent ordinary online reading.
      console.warn('离线应用缓存注册失败', error);
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

/** Keep activation opt-in, including when another tab activates the new worker. */
export function watchPwaUpdates(
  registration: ServiceWorkerRegistration,
  save: () => Promise<void> = async () => { await window.readerApp?.saveBeforeUpdate(); },
  reload: () => void = () => location.reload(),
): () => void {
  const banner = document.createElement('aside');
  banner.className = 'pwa-update';
  banner.setAttribute('aria-label', '应用更新');
  const message = document.createElement('span');
  message.setAttribute('role', 'status');
  message.textContent = '新版本已准备好';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '立即更新';
  banner.append(message, button);
  let updating = false;
  let changed = false;
  let reloaded = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let installing: ServiceWorker | null = null;
  const show = () => {
    if (registration.waiting && navigator.serviceWorker.controller && !banner.isConnected) document.body.append(banner);
  };
  const finish = () => {
    if (reloaded) return;
    reloaded = true;
    clearTimeout(timeout);
    reload();
  };
  const failed = () => {
    clearTimeout(timeout);
    updating = false;
    button.disabled = false;
    button.textContent = '重试更新';
    message.textContent = '更新未完成，请重试';
  };
  const onControllerChange = () => {
    // First installation only claims the page; it is not an update.
    changed = true;
    if (updating) finish();
    else if (banner.isConnected) message.textContent = '新版本已启用，刷新后使用';
  };
  button.addEventListener('click', () => {
    if (updating) return;
    button.disabled = true;
    message.textContent = '正在保存阅读进度…';
    void (async () => {
      try {
        await save();
        updating = true;
        message.textContent = '正在更新…';
        if (changed || !registration.waiting) { finish(); return; }
        timeout = setTimeout(failed, 15_000);
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      } catch {
        failed();
      }
    })();
  });
  const onStateChange = () => show();
  const onUpdateFound = () => {
    installing?.removeEventListener('statechange', onStateChange);
    installing = registration.installing;
    installing?.addEventListener('statechange', onStateChange);
    show();
  };
  const check = () => {
    if (document.visibilityState !== 'visible') return;
    show();
    void registration.update().catch(() => { /* Offline: try again on return. */ });
  };
  // Only changes after initial control represent upgrades of an existing page.
  let controlled = !!navigator.serviceWorker.controller;
  const controllerChange = () => {
    if (controlled) onControllerChange();
    controlled = true;
  };
  navigator.serviceWorker.addEventListener('controllerchange', controllerChange);
  registration.addEventListener('updatefound', onUpdateFound);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('online', check);
  const interval = setInterval(check, 60 * 60 * 1000);
  onUpdateFound();
  return () => {
    clearTimeout(timeout);
    clearInterval(interval);
    banner.remove();
    installing?.removeEventListener('statechange', onStateChange);
    registration.removeEventListener('updatefound', onUpdateFound);
    navigator.serviceWorker.removeEventListener('controllerchange', controllerChange);
    document.removeEventListener('visibilitychange', check);
    window.removeEventListener('online', check);
  };
}
