import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './styles/reader.css';
import './app/app.css';
import './media/media.css';
import './media/presentation.css';
import './media/v2.css';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AppProviders } from './app/providers/AppProviders.tsx';
import { createAppRuntime, inferDefaultUrl } from './app/runtime.ts';
import { router } from './app/router/router.tsx';
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
const appRoot: HTMLElement = root;

declare global {
  interface Window {
    readerApp?: Awaited<ReturnType<typeof createAppRuntime>>;
    /**
     * Flush hook called by the Android shell from `Activity.onPause`.
     *
     * The shell cannot know when a reading position changed, and the reader's own
     * debounce will never fire if the app is frozen first. Exposing one function
     * is the whole contract: "the app is going away, write what you have".
     */
    __readerFlush?: () => Promise<void>;
  }
}
async function start(): Promise<void> {
  const runtime = await createAppRuntime(import.meta.env.VITE_SERVER_URL ?? inferDefaultUrl());
  window.readerApp = runtime;
  window.__readerFlush = () => runtime.flush();
  createRoot(appRoot).render(<AppProviders runtime={runtime}><RouterProvider router={router} /></AppProviders>);
  registerPwa();
  document.getElementById('app-startup')?.remove();
}

void start().catch((err: unknown) => {
  root.textContent = `客户端启动失败：${err instanceof Error ? err.message : String(err)}`;
  document.getElementById('app-startup')?.remove();
});
