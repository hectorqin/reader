import { ReaderApi, type SessionStore } from './api/client.ts';
import { ApiError } from './api/errors.ts';
import type { Book, Session } from './api/types.ts';
import { createWebPlatform } from './core/web-platform.ts';
import {
  androidPageHost,
  androidSpeechBridge,
  createAndroidPlatform,
  detectAndroidBridge,
} from './core/android-platform.ts';
import type { SpeechBridge } from './android-bridge.ts';
import type { NativePageHost } from './ui/native-page.ts';
import type { Platform } from './core/platform.ts';
import { SyncEngine, type SyncStatus } from './core/sync.ts';
import { OfflineStore } from './store/offline.ts';
import { SettingsStore, DEFAULT_APP_SETTINGS, type AppSettings } from './store/settings.ts';
import { ShelfScreen } from './ui/shelf-screen.tsx';
import { ReaderScreen } from './ui/reader-screen.tsx';
import { LoginScreen } from './ui/login-screen.tsx';
import { ManagerScreen } from './ui/manager-screen.tsx';
import { el } from './ui/dom.ts';
import { Router, type Route, type RouteLocation } from './ui/router.ts';

/**
 * Application shell: routing, lifecycle and the wiring between the layers.
 *
 * Intentionally tiny. Everything with a decision in it lives in a module with a
 * single responsibility — the formats know how to unpack a book, the view knows
 * how to lay it out, the sync engine knows when to talk to the server — and this
 * file only connects them and manages what is on screen.
 *
 * ## What the routes changed here
 *
 * Every screen now has an address, and this class is what turns a route into a
 * screen and back (`render` / `Router`). The shift is not cosmetic — three things
 * that used to be separate pieces of code are now consequences of the same fact:
 *
 *  - **Back.** The Android shell's back gesture and the browser's Back button both
 *    work, because each screen has a URL and a parent, and neither screen has to
 *    implement a back stack of its own.
 *  - **Reload.** A book, and a folder in the library, survive a reload. Before
 *    this, a reload always landed on the shelf and the reader lost their place.
 *  - **Deep links.** A link into a book with no session is *held* across the
 *    sign-in screen instead of being dropped, so a shared link works for the
 *    second reader as well as the first.
 *
 * The screens are still classes with an `element` and a `dispose()`; the router
 * knows nothing about Preact and the screens know nothing about the hash. The one
 * thing they do share is `RouteLocation`, through which a screen asks to leave.
 */

export interface AppOptions {
  /** Baked-in server URL, used when nothing is stored yet. */
  defaultServerUrl?: string;
  root: HTMLElement;
}

export class App {
  private readonly root: HTMLElement;
  private readonly sessions: SessionStore;
  private api!: ReaderApi;
  private platform!: Platform;
  private offline!: OfflineStore;
  private settingsStore!: SettingsStore;
  private sync!: SyncEngine;
  private settings: AppSettings = { ...DEFAULT_APP_SETTINGS };

  private shelf: ShelfScreen | null = null;
  private reader: ReaderScreen | null = null;
  /**
   * The library file manager.
   *
   * A screen rather than a panel because it navigates: it has its own path, its
   * own back action and its own selection state, and a panel over the shelf would
   * have to reimplement all three badly. The path is a route now, so "its own
   * path" is literal — `#/library/科幻/刘慈欣`.
   */
  private manager: ManagerScreen | null = null;
  /**
   * Native fixed-layout renderer, present only in the Android shell.
   *
   * Held here rather than inside ReaderScreen so that the desktop of it — the
   * bridge object — is touched in one place, and so that a reader screen can be
   * constructed with or without one without either path special-casing.
   */
  private pageHost: NativePageHost | null = null;
  /**
   * The shell's native speech engine, present only on Android shell 3+.
   *
   * Held alongside the page host because both are the same kind of thing: a
   * capability the *shell* has that the shared layer uses when it is there and
   * does without when it is not.
   */
  private speechBridge: SpeechBridge | null = null;
  /**
   * The route the app is *trying* to show.
   *
   * Kept separately from the one on screen because of authentication: a reader who
   * follows a link to a book while signed out must land on that book after signing
   * in, not on the shelf. The router is not even constructed until there is a
   * session — there is no route to have while the sign-in form is up — so this is
   * where the link waits.
   */
  private pending: Route | null = null;
  /** The route currently rendered. `null` while the login screen is up. */
  private route: Route | null = null;
  /**
   * The location that came with `route`, kept so a deferred paint can reuse it.
   *
   * A route that has to fetch before it can be painted (`showBook`) finishes after
   * the router's callback has returned, and it needs the *same* `back()` the
   * callback was given — not a re-derived one, which would be a second
   * implementation of "where does back go" and would drift.
   */
  private location: RouteLocation | null = null;
  private router: Router | null = null;
  /** The book the shell last resolved, reported by `currentBook()`. */
  private book: Book | null = null;
  /**
   * True while a route is being rendered because the app is starting.
   *
   * `ReaderScreen.open()` is asynchronous and the shelf's first load is too, so a
   * route that needs to *fetch* cannot be rendered synchronously inside the
   * router's callback. This flag is what lets the callback hand work to a promise
   * without the deep-link path and the click path diverging.
   */
  private rendering = false;

  constructor(private readonly options: AppOptions) {
    this.root = options.root;
    this.sessions = createSessionStore();
  }

  async start(): Promise<void> {
    this.platform = await this.createPlatform();
    this.api = new ReaderApi(this.platform, this.sessions);
    this.offline = new OfflineStore(this.platform.kv);
    this.settingsStore = new SettingsStore(this.platform.kv);
    this.settings = await this.settingsStore.load();
    this.sync = new SyncEngine(this.api, this.offline, this.platform);

    await this.offline.load();
    const storedUrl = await this.settingsStore.serverUrl();
    const session = await this.api.restore();
    const baseUrl = storedUrl || this.options.defaultServerUrl || inferDefaultUrl();
    if (baseUrl) {
      this.api.setBaseUrl(baseUrl);
      // A session restored from storage is only usable if the URL it was minted
      // against is the one that came back.
      session?.user && void this.settingsStore.setServerUrl(baseUrl);
    }

    document.documentElement.dataset['theme'] = this.settings.theme;

    if (session) {
      // Verify before entering the app: a token that the server has since
      // revoked would otherwise flash an empty library and then sign out. This is
      // also the one place the session is checked, so a deep link into a book
      // cannot get in ahead of it.
      try {
        await this.api.me();
        this.enterApp();
        this.sync.start();
      } catch (err) {
        if (err instanceof ApiError && err.isConnectivity) {
          // Offline with a stored session is a legitimate state, not a failure.
          this.enterApp();
          this.sync.start();
        } else {
          await this.sessions.clear();
          this.showLogin();
        }
      }
    } else {
      this.showLogin();
    }

    this.installLifecycleHooks();
  }

  // ---- routing ----

  /**
   * Starts the router, which paints the first route.
   *
   * Called exactly once per session. Signing out disposes it, because the login
   * form is not a screen in the app's trail: it is the door, and a reader who
   * signs back in should not find a stack of routes from the previous session
   * waiting behind the shelf.
   */
  private enterApp(): void {
    if (this.router) return;
    this.router = new Router({
      fallback: fallbackHash(),
      onChange: (route, location) => this.render(route, location),
    });
  }

  /**
   * Paints a route.
   *
   * The one place that decides which screen is on `#app`. Everything else asks for
   * a route and lets this run: a click on a book, the Android back gesture, and a
   * reload all arrive here identically, which is why none of them can disagree
   * about what is on screen. A route that needs a `Book` the app does not have yet
   * (a deep link, a reload) fetches it here and then paints; the flag is only to
   * keep that fetch out of the synchronous callback.
   */
  private render(route: Route, location: RouteLocation): void {
    this.pending = route;
    this.location = location;
    if (this.rendering) return;
    if (sameScreen(this.route, route)) return;
    switch (route.name) {
      case 'shelf':
        this.showShelf();
        return;
      case 'library':
        this.showManager(route, location);
        return;
      case 'book':
        void this.showBook(route, location);
    }
  }

  private clearScreens(): void {
    this.reader?.dispose();
    this.reader = null;
    this.shelf?.dispose();
    this.shelf = null;
    this.manager?.dispose();
    this.manager = null;
    this.root.replaceChildren();
  }

  // ---- screens ----

  /**
   * The sign-in screen, and the first-run experience.
   *
   * Not a route, deliberately. A URL for "the login form" would be a URL for a
   * *transient* state, and the one thing that must survive it is the route the
   * reader was trying to reach — which is what `pending` holds. So the form is the
   * absence of a router, and after `onAuthenticated` the router starts and paints
   * the pending route.
   */
  private showLogin(message?: string): void {
    this.router?.dispose();
    this.router = null;
    this.route = null;
    this.clearScreens();
    const login = new LoginScreen({
      api: this.api,
      defaultServerUrl: this.api.baseUrl || inferDefaultUrl(),
      onAuthenticated: () => {
        // The deep link wins over the shelf: this is the whole point of holding
        // it. `#/book/<id>` pasted by a friend lands on the book, not on a shelf
        // the reader has never seen.
        this.enterApp();
        this.sync.start();
      },
      onServerUrlChange: (url) => this.settingsStore.setServerUrl(url),
    });
    this.root.append(login.element);
    if (message) login.reset(message);
  }

  private showShelf(): void {
    this.route = { name: 'shelf' };
    this.clearScreens();
    const shelf = new ShelfScreen({
      api: this.api,
      offline: this.offline,
      platform: this.platform,
      // The shelf's own preferences ride in the same per-device settings store as
      // the reader's, so the two cannot disagree about where a preference lives.
      settings: this.settings,
      onOpenBook: (book) => this.openBook(book),
      onOpenManager: (path) => this.router?.navigate({ name: 'library', path }),
      onSignedOut: () => this.handleSignedOut(),
      onSettingsChange: (patch) => {
        void this.settingsStore.update(patch);
        this.settings = { ...this.settings, ...patch };
      },
    });
    this.shelf = shelf;
    this.root.append(shelf.element);
    void shelf.show();
  }

  /**
   * A folder in the library.
   *
   * The path comes from the route, and walking into a folder *replaces* it rather
   * than pushing: the manager is one screen with a breadcrumb, so a reader who
   * walked four folders deep expects Back to leave the screen, not to walk out of
   * it one folder at a time. The breadcrumb is what undoes a walk.
   */
  private showManager(route: { name: 'library'; path: string }, location: RouteLocation): void {
    const same = this.route?.name === 'library';
    this.route = route;
    if (same && this.manager) {
      // Already here: tell the existing screen to walk, rather than rebuilding it
      // and losing the selection the reader had in the folder they came from.
      void this.manager.open(route.path);
      return;
    }
    this.clearScreens();
    const manager = new ManagerScreen({
      api: this.api,
      onClose: () => location.back(),
      onSignedOut: () => this.handleSignedOut(),
      onNavigate: (path) => this.router?.navigate({ name: 'library', path }, { replace: true }),
    });
    this.manager = manager;
    this.root.append(manager.element);
    void manager.open(route.path);
  }

  /**
   * A book, by route.
   *
   * The book object is not in the URL — only its id — so this is the one screen
   * that may need to fetch before it can be painted. It fetches through the same
   * `ReaderApi` the shelf used, so a reload of a book link works offline: the
   * offline mirror answers, and the book opens on the page the reader left it on.
   */
  private async showBook(route: { name: 'book'; bookId: string }, location: RouteLocation): Promise<void> {
    this.route = route;
    this.rendering = true;
    try {
      const book = await this.resolveBook(route.bookId);
      if (book === null) {
        // A link to a book that is gone (rescan, deleted, another account). The
        // shelf is the only honest answer, and the route follows it so Back does
        // not return to the same dead link.
        // A snackbar rather than a line on the shelf: the shelf may not be the
        // screen the reader ends up on, and a silent redirect is how a dead link
        // becomes "the app is broken".
        showToast('这本书不在书架上了');
        this.router?.navigate({ name: 'shelf' }, { replace: true });
        return;
      }
      this.clearScreens();
      const reader = new ReaderScreen({
        api: this.api,
        offline: this.offline,
        sync: this.sync,
        platform: this.platform,
        settings: this.settings,
        ...(this.pageHost ? { pageHost: this.pageHost } : {}),
        ...(this.speechBridge ? { speechBridge: this.speechBridge } : {}),
        onBack: () => location.back(),
        onSettingsChange: (patch) => {
          void this.settingsStore.update(patch);
          this.settings = { ...this.settings, ...patch };
        },
        onSignedOut: () => this.handleSignedOut(),
      });
      this.reader = reader;
      this.book = book;
      this.root.append(reader.element);
      await reader.open(book);
    } finally {
      this.rendering = false;
      // A route that arrived *while this one was resolving* — a fast double Back,
      // a link opened while the previous book was still loading — was recorded but
      // not painted, because the flag above was set. Dropping it would leave the
      // wrong screen up with the right URL; this re-runs the paint against
      // whatever the router last reported, using the location it reported with.
      const pending = this.pending;
      const location = this.location;
      if (pending && location && !sameScreen(this.route, pending)) this.render(pending, location);
    }
  }

  /**
   * Finds a book by id, locally first.
   *
   * The local mirror is the first source because it is instant and works offline,
   * and because it is the *same* data the shelf drew: a reader who taps a cover and
   * a reader who reloads a link must not get two different books with the same id.
   * The server is consulted only when the mirror has never seen it.
   */
  private async resolveBook(bookId: string): Promise<Book | null> {
    const cached = this.offline.books().find((candidate) => candidate.id === bookId);
    if (cached) return cached;
    try {
      return (await this.api.getBook(bookId)).book;
    } catch (err) {
      if (err instanceof ApiError && err.isAuthFailure) this.handleSignedOut();
      return null;
    }
  }

  private openBook(book: Book): void {
    // The click path and the deep-link path converge here: one writes the URL and
    // lets `render` build the screen, so both produce the same history and the same
    // screen. A click used to construct the screen directly, which is exactly how
    // the two paths drifted apart.
    this.router?.navigate({ name: 'book', bookId: book.id });
  }

  private handleSignedOut(): void {
    this.sync.stop();
    void this.sessions.clear();
    void this.offline.clear();
    this.showLogin('登录已失效，请重新登录');
  }

  private async createPlatform(): Promise<Platform> {
    const bridge = detectAndroidBridge();
    if (!bridge) return createWebPlatform(this.options.defaultServerUrl ?? '');
    // The native page renderer is resolved here, once, alongside the bridge that
    // provides it, so no screen has to ask whether it is running on Android.
    this.pageHost = androidPageHost(bridge);
    this.speechBridge = androidSpeechBridge(bridge);
    return createAndroidPlatform(this.options.defaultServerUrl ?? '', bridge);
  }

  /**
   * Reports progress when the page is hidden or the app is backgrounded.
   *
   * This is the hook that makes "close the app right after reading" not lose the
   * last few pages: the debounce in the reader would otherwise never fire.
   */
  private installLifecycleHooks(): void {
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.sync.flush();
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => void this.sync.flush());
    }
  }

  /**
   * Writes everything pending to disk and to the server, best effort.
   *
   * Called when the app is backgrounded. Deliberately not awaited by the caller
   * (the Android shell cannot await it either), so it must not throw: a failure
   * here leaves the outbox intact for the next attempt rather than surfacing as
   * an unhandled rejection.
   */
  async flush(): Promise<void> {
    try {
      await this.offline.flush();
      await this.sync.flush();
    } catch {
      // The outbox is durable; the next cycle retries.
    }
  }

  // ---- diagnostics for the shell ----

  syncStatus(): SyncStatus {
    return this.sync.status();
  }

  currentBook(): Book | null {
    return this.book;
  }

  settingsSnapshot(): Promise<AppSettings> {
    return this.settingsStore.load();
  }
}

/**
 * Whether a repaint is needed, and whether the *screen* changes.
 *
 * Two routes that render the same screen but differ in their argument — two books,
 * two folders — are different URLs, but repainting from scratch for them would
 * throw away a reading position or a folder selection. The router decides whether
 * the URL changed; this decides whether the screen did.
 */
function sameScreen(a: Route | null, b: Route): boolean {
  if (a === null) return false;
  if (a.name !== b.name) return false;
  if (a.name === 'book' && b.name === 'book') return a.bookId === b.bookId;
  if (a.name === 'library' && b.name === 'library') return a.path === b.path;
  return true;
}

/**
 * The URL to write when the app is opened without a fragment.
 *
 * Built from the document's own base so the hash is relative to wherever the
 * bundle happens to live — `https://appassets.androidplatform.net/` on Android,
 * the server root in the H5 build, `http://localhost:5174/` in dev. A hard-coded
 * `#/shelf` happens to work in all three, but it also *looks* like it works by
 * accident, and the next route (a fragment that carries state) would not.
 */
function fallbackHash(): string {
  if (typeof location === 'undefined') return '#/shelf';
  if (location.protocol === 'file:') return '#/shelf';
  return `${location.origin}${location.pathname}#/shelf`;
}

/**
 * A message that appears over whatever is on screen and leaves by itself.
 *
 * Built by hand rather than as a screen component because it outlives screens: it
 * is appended to `document.body`, so a route change does not take it with it —
 * which is the one case it exists for, a dead link that redirects to the shelf
 * while the explanation is still being read. Purely presentational: it is
 * `aria-live` so a screen reader announces it, and it takes no pointer events so
 * it cannot eat a tap it is covering.
 */
function showToast(message: string): void {
  if (typeof document === 'undefined') return;
  const node = document.createElement('div');
  node.className = 'app-toast';
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  node.textContent = message;
  document.body.append(node);
  // Two frames, so the entry transition actually runs: a class added in the same
  // frame the node is created is coalesced and the toast appears without moving.
  requestAnimationFrame(() => node.dataset['shown'] = 'true');
  setTimeout(() => {
    node.dataset['shown'] = 'false';
    setTimeout(() => node.remove(), 250);
  }, 3600);
}

/**
 * Session persistence.
 *
 * Tokens live in the same key/value store as everything else. That means they
 * are in IndexedDB (`localStorage` is the classic choice and is worse: it is
 * synchronous, capped at a few MB, and shared across every script on the
 * origin). On Android they end up in the WebView's storage inside the app's
 * private data directory, which is the platform's own boundary for app secrets.
 */
function createSessionStore(): SessionStore {
  const KEY = 'reader.session.v1';
  return {
    async load(): Promise<Session | null> {
      const store = await sharedKv();
      const raw = await store.get(KEY);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as Session;
        if (!parsed?.accessToken || !parsed?.refreshToken) return null;
        return parsed;
      } catch {
        return null;
      }
    },
    async save(session: Session): Promise<void> {
      const store = await sharedKv();
      await store.set(KEY, JSON.stringify(session));
    },
    async clear(): Promise<void> {
      const store = await sharedKv();
      await store.remove(KEY);
    },
  };
}

interface KeyValueStoreLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

let sharedKvPromise: Promise<KeyValueStoreLike> | null = null;

/**
 * One shared store instance.
 *
 * Two separate IndexedDB connections to the same database in the same tab is
 * legal but wasteful, and on a cold start it doubles the open cost.
 */
async function sharedKv(): Promise<KeyValueStoreLike> {
  if (!sharedKvPromise) sharedKvPromise = createStoresLazy();
  return sharedKvPromise;
}

async function createStoresLazy(): Promise<KeyValueStoreLike> {
  const { createStores } = await import('./store/idb.ts');
  const stores = await createStores();
  return stores.kv;
}

/** Best-effort default so a fresh install does not start with an empty field. */
function inferDefaultUrl(): string {
  if (typeof location === 'undefined') return '';
  if (location.protocol === 'file:') return '';
  // Same-origin when the H5 bundle is served by the reader server itself.
  return `${location.origin}`;
}

export { el };
