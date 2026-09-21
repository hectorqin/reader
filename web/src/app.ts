import { PluginPageScreen } from './ui/plugin-page-screen.tsx';
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
import { publicationScope } from './store/publications.ts';
import { SettingsStore, DEFAULT_APP_SETTINGS, type AppSettings } from './store/settings.ts';
import { ShelfScreen } from './ui/shelf-screen.tsx';
import { SourcesScreen } from './ui/sources-screen.tsx';
import { ReaderScreen } from './ui/reader-screen.tsx';
import { LoginScreen } from './ui/login-screen.tsx';
import { LibraryBrowseScreen, LibraryFilesScreen } from './ui/library-screen.tsx';
import { el } from './ui/dom.ts';
import { Router, type LibraryView, type Route, type RouteLocation } from './ui/router.ts';

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
  /**
   * The signed-in account's role, which decides one thing: whether the library's
   * *file manager* is reachable at all.
   *
   * `null` until the server has answered — and every write page is treated as
   * admin-only while it is unknown, because "we have not asked yet" must not be a
   * moment during which a member can open the page that deletes files. `member` is
   * the honest default for the same reason: it is the role with fewer powers.
   *
   * A boolean rather than the `User` because the role is the only field any screen
   * branches on, and a field that holds a whole session object is a field that
   * eventually holds a token where a component can see it.
   */
  private isAdmin = false;

  private shelf: ShelfScreen | null = null;
  private sources: SourcesScreen | null = null;
  private pluginPage: PluginPageScreen | null = null;
  private reader: ReaderScreen | null = null;
  /**
   * The library, as two screens: the browsing page and the file manager.
   *
   * They are deliberately *not* one screen with two tabs. The browsing page answers
   * "what is in here" for a reader — a grid of covers, a search field, one action per
   * card — and the file manager answers "where is my book and let me move it" for an
   * administrator, where every control writes to the disk. Their lists, their
   * toolbars, their page sizes and their audiences have nothing in common, so sharing
   * a header made both worse (#40: 「两者列表显示逻辑不一样」).
   *
   * Each is a route of its own (`#/library/科幻` and `#/library/files/科幻`), so a
   * link a reader is handed opens the page a reader can use, and the file manager is
   * somewhere an administrator navigates to on purpose.
   */
  private browse: LibraryBrowseScreen | null = null;
  private files: LibraryFilesScreen | null = null;
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

    const storedUrl = await this.settingsStore.serverUrl();
    const session = await this.api.restore();
    const baseUrl = storedUrl || this.options.defaultServerUrl || inferDefaultUrl();
    if (baseUrl) {
      this.api.setBaseUrl(baseUrl);
      // A session restored from storage is only usable if the URL it was minted
      // against is the one that came back.
      session?.user && void this.settingsStore.setServerUrl(baseUrl);
    }
    if (session) await this.loadAccountCache(true);

    document.documentElement.dataset['theme'] = this.settings.theme;

    if (session) {
      // Verify before entering the app: a token that the server has since
      // revoked would otherwise flash an empty library and then sign out. This is
      // also the one place the session is checked, so a deep link into a book
      // cannot get in ahead of it.
      try {
        this.isAdmin = (await this.api.me()).role === 'admin';
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
    /*
     * Every screen decides for itself whether the route is a repaint or a no-op.
     *
     * There used to be one `sameScreen` guard here that skipped the call entirely,
     * and it was wrong in a way that only a *two-page* screen can be wrong: a library
     * route that differs from the current one only in its `view` (a tab switch) or its
     * `page` (a page turn) is the *same screen* with a different argument, so the
     * screen that is already up is exactly the one that has to be told — and skipping
     * the call left the URL changed and the screen not. The guard's job is now split:
     * `showShelf`/`showLibrary`/`showBook` compare what *they* need, and nothing
     * downstream has to guess whether "same" means "nothing to do".
     */
    /*
     * The file manager is admin-only, and the guard is *here* rather than on the
     * button that leads to it.
     *
     * A route is a URL and a URL is user input: it arrives from a bookmark, from a
     * chat message, from a link built by hand — and the page behind it can delete
     * files from the server's disk. Hiding the button is a *hint* to the reader that
     * the page is not theirs; this is the check. A member who follows such a link
     * lands on the browsing half of the same folder rather than on an error page,
     * because the library is a place they are allowed to be and the folder is the
     * part of it the link was actually about.
     */
    if (route.name === 'library' && route.view === 'files' && !this.isAdmin) {
      this.showLibrary({ ...route, view: 'browse' }, location);
      return;
    }
    switch (route.name) {
      case 'plugin-page':
        this.clearScreens(); this.route = route;
        this.pluginPage = new PluginPageScreen({ api: this.api, pluginId: route.pluginId, pageId: route.pageId,
          onBack: () => location.back(), onSignedOut: () => this.handleSignedOut() });
        this.root.append(this.pluginPage.element); void this.pluginPage.show(); return;
      case 'sources':
        this.clearScreens();
        this.route = route;
        this.sources = new SourcesScreen({ api: this.api, admin: this.isAdmin, onBack: () => location.back(),
          onOpen: (book) => this.openBook(book), onSignedOut: () => this.handleSignedOut() });
        this.root.append(this.sources.element);
        void this.sources.show();
        return;
      case 'shelf':
        this.showShelf(route);
        return;
      case 'library':
        this.showLibrary(route, location);
        return;
      case 'book':
        void this.showBook(route, location);
    }
  }

  private clearScreens(): void {
    this.pluginPage?.dispose(); this.pluginPage = null;
    this.sources?.dispose();
    this.sources = null;
    this.reader?.dispose();
    this.reader = null;
    this.shelf?.dispose();
    this.shelf = null;
    this.browse?.dispose();
    this.browse = null;
    this.files?.dispose();
    this.files = null;
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
      onAuthenticated: async () => {
        // The deep link wins over the shelf: this is the whole point of holding
        // it. `#/book/<id>` pasted by a friend lands on the book, not on a shelf
        // the reader has never seen.
        await this.loadAccountCache();
        this.isAdmin = this.api.currentSession()?.user.role === 'admin';
        this.enterApp();
        this.sync.start();
      },
      onServerUrlChange: (url) => this.settingsStore.setServerUrl(url),
    });
    this.root.append(login.element);
    if (message) login.reset(message);
  }

  /**
   * The two list screens' shared wiring.
   *
   * The shelf and the library are separate routes with separate screens, and every
   * arrow between them is a navigation rather than a method call. That is what makes
   * Back mean "the list I was looking at" instead of "some other list", and it is
   * what lets a reader hand someone `#/library/科幻` and have them land in the folder
   * with the shelf one tap away.
   */
  private showShelf(route: { name: 'shelf'; page: number; libraryPath: string; libraryPage: number }): void {
    const same = this.route?.name === 'shelf';
    this.route = route;
    if (same && this.shelf) {
      // Already here: tell the existing screen which page to show rather than
      // rebuilding it, so the reader's search term and their scroll position in the
      // list survive a page turn.
      void this.shelf.showPage(route.page);
      return;
    }
    this.clearScreens();
    const shelf = new ShelfScreen({
      onOpenSources: () => this.router?.navigate({ name: 'sources' }),
      api: this.api,
      offline: this.offline,
      platform: this.platform,
      // The shelf's own preferences ride in the same per-device settings store as
      // the reader's, so the two cannot disagree about where a preference lives.
      settings: this.settings,
      page: route.page,
      libraryPath: route.libraryPath,
      libraryPage: route.libraryPage,
      onOpenBook: (book) => this.openBook(book),
      onOpenLibrary: (path, page) =>
        this.router?.navigate({ name: 'library', path, page, view: 'browse', fromShelf: true, search: '' }),
      // Only offered to an admin, and only ever a *hint*: the route itself is
      // guarded in `render` below, because a URL is user input and a hidden button
      // is not a permission check.
      ...(this.isAdmin
        ? {
            onOpenLibraryManager: (path: string) =>
              this.router?.navigate({
                name: 'library',
                path,
                page: 1,
                view: 'files',
                fromShelf: true,
                search: '',
              }),
          }
        : {}),
      onPageChange: (page) =>
        this.router?.navigate(
          { name: 'shelf', page, libraryPath: route.libraryPath, libraryPage: route.libraryPage },
          { replace: true },
        ),
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
   * The library: which half, which folder, which page, which query.
   *
   * One entry point for two screens, because the *route* is one route with a `view`
   * on it, and because both halves ask the shell the same question — "where am I" —
   * through the same accessor. See `browse` / `files` on the class for why the two
   * halves are two screens rather than two tabs.
   *
   * Walking into a folder and turning a page *replace* the entry rather than pushing:
   * each is one screen changing its own argument, so a reader who walked four folders
   * deep expects Back to leave the library. Moving *between* the two halves pushes,
   * because that is a step from one screen to another and Back should return to the
   * one they were on.
   */
  private showLibrary(
    route: {
      name: 'library';
      path: string;
      page: number;
      view: LibraryView;
      fromShelf: boolean;
      search: string;
    },
    location: RouteLocation,
  ): void {
    /*
     * The screen asks the *shell* where it is, rather than closing over the route it
     * was built with.
     *
     * This is not a style choice. A screen is built once and then walks through
     * folders by `replace`-navigating, so a callback that captured `route` would keep
     * answering with the folder the reader *arrived* in — and the failure is silent
     * and specific: turning to page two of `#/library/科幻` produces `#/library/2`,
     * i.e. page two of the root, because `route.path` was still `''`. One accessor
     * that reads `this.route` is the same fix for the folder, the page, the query and
     * the shelf's carried location, and it cannot drift from the screen's own state.
     */
    const here = (): {
      path: string;
      page: number;
      view: LibraryView;
      fromShelf: boolean;
      search: string;
    } => {
      const current = this.route;
      if (current?.name === 'library') return current;
      return { path: route.path, page: route.page, view: route.view, fromShelf: route.fromShelf, search: route.search };
    };

    /*
     * Leaving the library goes back to the shelf when the reader *came* from it, and
     * out of the app otherwise.
     *
     * That is what `fromShelf` is for: a link to `#/library/科幻` pasted into a fresh
     * tab has no shelf behind it, and `location.back()` would push a shelf the reader
     * has never seen into their history — so Back would then return them to a screen
     * they did not ask for. The router's own trail answers the same question where it
     * can, and this is the fallback.
     */
    const close = (): void => location.back();

    const common = {
      api: this.api,
      offline: this.offline,
      settings: this.settings,
      onSettingsChange: (patch: Partial<AppSettings>): void => {
        void this.settingsStore.update(patch);
        this.settings = { ...this.settings, ...patch };
      },
      onOpenBook: (book: Book) => this.openBook(book),
      onClose: close,
      onSignedOut: () => this.handleSignedOut(),
    };

    if (route.view === 'files') {
      const same = this.route?.name === 'library' && this.files !== null;
      this.route = route;
      if (same && this.files) {
        void this.files.open(route.path, route.page);
        return;
      }
      this.clearScreens();
      const files = new LibraryFilesScreen({
        ...common,
        path: route.path,
        page: route.page,
        fromShelf: route.fromShelf,
        // A *push*, so Back returns to the page the reader was reading. The other
        // direction is pushed from the browsing screen for the same reason.
        onOpenBrowse: (path) =>
          this.router?.navigate(
            { name: 'library', path, page: 1, view: 'browse', fromShelf: here().fromShelf, search: '' },
          ),
        onOpenLibrary: (path, page, replace) =>
          this.router?.navigate(
            { name: 'library', path, page, view: 'files', fromShelf: here().fromShelf, search: '' },
            { replace },
          ),
      });
      this.files = files;
      this.root.append(files.element);
      void files.open(route.path, route.page);
      return;
    }

    const same = this.route?.name === 'library' && this.browse !== null;
    this.route = route;
    if (same && this.browse) {
      void this.browse.open(route.path, route.page, route.search);
      return;
    }
    this.clearScreens();
    const browse = new LibraryBrowseScreen({
      ...common,
      path: route.path,
      page: route.page,
      search: route.search,
      fromShelf: route.fromShelf,
      onOpenFiles: () =>
        this.router?.navigate({
          name: 'library',
          path: here().path,
          page: 1,
          view: 'files',
          fromShelf: here().fromShelf,
          search: '',
        }),
      onOpenBrowse: (path, page, search, replace) =>
        this.router?.navigate(
          { name: 'library', path, page, view: 'browse', fromShelf: here().fromShelf, search },
          { replace },
        ),
    });
    this.browse = browse;
    this.root.append(browse.element);
    void browse.open(route.path, route.page, route.search);
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
    // A route that names the book already open is the same screen: the router
    // re-reports on every change, and rebuilding the reader here would throw away the
    // reading position and the scroll offset on a no-op.
    if (this.route?.name === 'book' && this.route.bookId === route.bookId && this.reader) return;
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
        this.router?.navigate({ name: 'shelf', page: 1, libraryPath: '', libraryPage: 1 }, { replace: true });
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
      if (pending && location) this.render(pending, location);
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
    //
    // The route carries nothing about *where* the click came from, on purpose: the
    // router's own trail knows, and `back()` reads it. Encoding the origin here
    // would be a second, hand-maintained answer to "where does back go".
    this.router?.navigate({ name: 'book', bookId: book.id });
  }

  private handleSignedOut(): void {
    this.sync.stop();
    void this.sessions.clear();
    void this.offline.clear();
    this.showLogin('登录已失效，请重新登录');
  }

  private async loadAccountCache(claimLegacy = false): Promise<void> {
    const session = this.api.currentSession();
    if (!session) return;
    await this.offline.setScope(publicationScope(
      this.api.baseUrl || (typeof location !== 'undefined' ? location.origin : ''),
      session.user.id,
    ), { claimLegacy });
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
