import './styles/reader.css';
import { App } from './app.ts';
import { registerPwa } from './core/pwa.ts';

/**
 * Entry point.
 *
 * The shell exposes the app on `window` for two reasons: the Android bridge
 * needs to reach in for lifecycle and diagnostics, and browser devtools are the
 * primary debugging surface for a self-hosted product, where asking a user to
 * attach a remote debugger is not realistic.
 */
const root = document.getElementById('app');
if (!root) throw new Error('missing #app root element');

const app = new App({
  root,
  defaultServerUrl: import.meta.env.VITE_SERVER_URL ?? '',
});

declare global {
  interface Window {
    readerApp?: App;
    /**
     * Flush hook called by the Android shell from `Activity.onPause`.
     *
     * The shell cannot know when a reading position changed, and the reader's own
     * debounce will never fire if the app is frozen first. Exposing one function
     * is the whole contract: "the app is going away, write what you have".
     */
    __readerFlush?: () => void;
  }
}
window.readerApp = app;
registerPwa();
window.__readerFlush = () => {
  void app.flush();
};

void app.start().catch((err: unknown) => {
  root.textContent = `客户端启动失败：${err instanceof Error ? err.message : String(err)}`;
});
