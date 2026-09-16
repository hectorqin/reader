/**
 * H5 client entry point.
 *
 * The same bundle runs in two hosts, and the only thing that differs is how it
 * finds its server:
 *
 *  - **Served by the reader server** (the H5 deployment): same origin, so the
 *    API base is empty and there is nothing to configure. The server hosts this
 *    build itself, which is what makes 「纯 H5 就是一个完整客户端」 true — no app
 *    store, no build step for the user, no second deployment to keep in sync.
 *  - **Inside the Android shell**: the assets are loaded from `file://`, so there
 *    is no origin and the API base has to come from the shell. The shell injects
 *    it as `window.readerBridge` before this script runs; the settings screen
 *    lets the user type an address when it did not.
 *
 * The `platform` flag is what routes comic and PDF rendering to native code on
 * Android. It comes from the bridge rather than from a user-agent sniff, because
 * a UA string is a guess and the bridge is a fact.
 */

import { ApiClient, type BookDto } from './net/api.ts';
import { ShelfView } from './ui/shelf-view.ts';
import { AuthView } from './ui/auth-view.ts';
import { ReaderView } from './ui/reader-view.ts';
import { installBridge, type ReaderBridge } from './bridge.ts';
import './ui/styles.css';

const app = document.getElementById('app');
if (!app) throw new Error('missing #app');

const bridge: ReaderBridge | undefined = installBridge();
const baseUrl = bridge?.serverUrl ?? '';

const api = new ApiClient({
  baseUrl,
  onAuthLost: () => showAuth(),
});

const shelf = new ShelfView(app, api, {
  onOpenBook: (book) => void openBook(book),
  onSignOut: () => {
    api.signOut();
    showAuth();
  },
});

function showAuth(): void {
  const view = new AuthView(app!, api, { onSignedIn: () => void showShelf() });
  void view.render();
}

async function showShelf(): Promise<void> {
  shelf.mount();
  await shelf.load(true);
}

async function openBook(book: BookDto): Promise<void> {
  const view = new ReaderView(app!, api, book, {
    platform: bridge?.platform ?? 'web',
    ...(bridge?.deviceName !== undefined ? { device: bridge.deviceName } : {}),
    onExit: () => void showShelf(),
  });
  await view.open();
  // The shell expects a signal that a book is open, so it can hand gestures and
  // hardware keys to the reader instead of the shelf.
  bridge?.onBookOpened?.(book.id);
  bridge?.onTurnPage?.((pages) => void view.turn(pages));
}

if (api.currentSession) void showShelf();
else void showAuth();
