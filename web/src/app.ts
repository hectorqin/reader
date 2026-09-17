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
import { ShelfScreen } from './ui/shelf-screen.ts';
import { ReaderScreen } from './ui/reader-screen.ts';
import { LoginScreen } from './ui/login-screen.ts';
import { ManagerScreen } from './ui/manager-screen.ts';
import { el } from './ui/dom.ts';

/**
 * Application shell: routing, lifecycle and the wiring between the layers.
 *
 * Intentionally tiny. Everything with a decision in it lives in a module with a
 * single responsibility — the formats know how to unpack a book, the view knows
 * how to lay it out, the sync engine knows when to talk to the server — and this
 * file only connects them and manages what is on screen.
 */

const SCREEN_SHELF = 'shelf';
const SCREEN_READER = 'reader';
const SCREEN_MANAGER = 'manager';

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
   * The library file manager, opened from the shelf.
   *
   * A screen rather than a panel because it navigates: it has its own path, its
   * own back action and its own selection state, and a panel over the shelf would
   * have to reimplement all three badly.
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
  private screen: string | null = null;
  private pendingBook: Book | null = null;

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
      // Verify before showing the shelf: a token that the server has since
      // revoked would otherwise flash an empty library and then sign out.
      try {
        await this.api.me();
        this.showShelf();
        this.sync.start();
      } catch (err) {
        if (err instanceof ApiError && err.isConnectivity) {
          // Offline with a stored session is a legitimate state, not a failure.
          this.showShelf();
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

  private async createPlatform(): Promise<Platform> {
    const bridge = detectAndroidBridge();
    if (!bridge) return createWebPlatform(this.options.defaultServerUrl ?? '');
    // The native page renderer is resolved here, once, alongside the bridge that
    // provides it, so no screen has to ask whether it is running on Android.
    this.pageHost = androidPageHost(bridge);
    this.speechBridge = androidSpeechBridge(bridge);
    return createAndroidPlatform(this.options.defaultServerUrl ?? '', bridge);
  }

  // ---- screens ----

  private setScreen(screen: string): void {
    if (this.screen === screen) return;
    this.reader?.dispose();
    this.reader = null;
    this.shelf?.dispose();
    this.shelf = null;
    this.manager?.dispose();
    this.manager = null;
    this.root.replaceChildren();
    this.screen = screen;
  }

  private showLogin(message?: string): void {
    this.setScreen('login');
    const login = new LoginScreen({
      api: this.api,
      defaultServerUrl: this.api.baseUrl || inferDefaultUrl(),
      onAuthenticated: () => {
        this.showShelf();
        this.sync.start();
      },
      onServerUrlChange: (url) => this.settingsStore.setServerUrl(url),
    });
    this.root.append(login.element);
    if (message) login.reset(message);
  }

  private showShelf(): void {
    this.setScreen(SCREEN_SHELF);
    const shelf = new ShelfScreen({
      api: this.api,
      offline: this.offline,
      platform: this.platform,
      // The shelf's own preferences ride in the same per-device settings store as
      // the reader's, so the two cannot disagree about where a preference lives.
      settings: this.settings,
      onOpenBook: (book) => void this.openBook(book),
      onOpenManager: () => void this.showManager(),
      onSignedOut: () => this.handleSignedOut(),
      onSettingsChange: (patch) => {
        void this.settingsStore.update(patch);
        this.settings = { ...this.settings, ...patch };
      },
    });
    this.shelf = shelf;
    this.root.append(shelf.element);
    void shelf.show();
    this.pendingBook = null;
  }

  private async showManager(): Promise<void> {
    this.setScreen(SCREEN_MANAGER);
    const manager = new ManagerScreen({
      api: this.api,
      onClose: () => this.showShelf(),
      onSignedOut: () => this.handleSignedOut(),
    });
    this.manager = manager;
    this.root.append(manager.element);
    await manager.open();
  }

  private async openBook(book: Book): Promise<void> {
    this.setScreen(SCREEN_READER);
    const reader = new ReaderScreen({
      api: this.api,
      offline: this.offline,
      sync: this.sync,
      platform: this.platform,
      settings: this.settings,
      ...(this.pageHost ? { pageHost: this.pageHost } : {}),
      ...(this.speechBridge ? { speechBridge: this.speechBridge } : {}),
      onBack: () => this.showShelf(),
      onSettingsChange: (patch) => {
        void this.settingsStore.update(patch);
        this.settings = { ...this.settings, ...patch };
      },
      onSignedOut: () => this.handleSignedOut(),
    });
    this.reader = reader;
    this.pendingBook = book;
    this.root.append(reader.element);
    await reader.open(book);
  }

  private handleSignedOut(): void {
    this.sync.stop();
    void this.sessions.clear();
    void this.offline.clear();
    this.showLogin('登录已失效，请重新登录');
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
    return this.pendingBook;
  }

  settingsSnapshot(): Promise<AppSettings> {
    return this.settingsStore.load();
  }
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
