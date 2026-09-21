/**
 * The app's routes, as data.
 *
 * ## Why this file exists
 *
 * The shell used to navigate by calling `showShelf()` / `openBook()` /
 * `showManager()` and by remembering a `pendingBook` field, which meant the URL
 * never changed. On a phone that is nearly invisible — until the reader presses
 * Back. Android's back gesture is handled by the Activity, which sees an
 * unchanged history and so leaves the app, from a shelf the reader was about to
 * read from. On the web it is worse than invisible: the address bar is the share
 * affordance and the bookmark affordance of a self-hosted library, and neither
 * worked. A book could not be linked to, and a reload always landed on the shelf.
 *
 * So a route is a *value* here, not a call. The shell renders the route the
 * router reports; navigation writes a URL and the resulting change re-renders.
 * That is the whole contract, and it buys three things that would otherwise each
 * need their own code:
 *
 *  - Back and Forward work, because the browser owns them.
 *  - A book is addressable (`#/book/<id>`), and so is a folder in the library
 *    (`#/library/<path>`) — the two screens a reader actually wants to hand to
 *    someone else.
 *  - A deep link with no session is not an error: the route is *kept* across the
 *    sign-in screen, so the link the reader followed is where they land.
 *
 * ## Why the hash, and not `history.pushState` with a path
 *
 * The same bundle is loaded by two hosts, and neither can serve an arbitrary
 * path: the Android shell loads it from `https://appassets.androidplatform.net/`
 * (no server at all — any path but the document's own is a 404), and the H5 build
 * is served by the reader server, which has no fallback-to-`index.html` rule for
 * client routes. A path-based route would therefore work in `vite dev` and 404 in
 * both production hosts. The fragment is the one part of a URL that is guaranteed
 * to belong to the client, so it is the only scheme that works in all three — and
 * the cost is one `#`.
 */

/**
 * Which half of the library is showing.
 *
 * `browse` is the *reader's* half: a grid of the books in a folder, with a search
 * field over it, laid out like a shop — this is the page a reader browses and the
 * page a link to `#/library/科幻` opens. `files` is the *administrator's* half: the
 * file manager, which is where books are uploaded, renamed, moved and deleted.
 *
 * ## Why these are two routes and not two pages of one
 *
 * They were one route with a `view` segment for one round of the review (#40), and
 * the report that split them is the right one: *「两者列表显示逻辑不一样」*. The two
 * halves do not share a list, a query, an ordering or an audience —
 *
 *  - the browse half asks `/books?path=…&search=…` and renders covers of *books*,
 *    which is the same shape the shelf renders, so it belongs on a page a reader
 *    can link to and land on;
 *  - the files half asks `/library/browse?path=…` and renders *rows of files*, and
 *    every control on it writes to the server's disk.
 *
 * A `view` segment made the second one reachable by URL from a link meant for the
 * first, and made "which half am I on" a property of a tab rather than of the place
 * the reader is. As two routes, `#/library/科幻` is unambiguously the browsing page,
 * `#/library/files/科幻` is unambiguously the file manager, and Back from either is
 * the place the reader came from rather than the other half of the same screen.
 *
 * The cost is that switching between them is a *navigation* rather than a tab
 * switch — Back returns to the half you were on. That is the correct reading of two
 * screens with different audiences, and it is what the report asked for.
 */
export type LibraryView = 'browse' | 'files';

/** A parsed location. */
export type Route =
  | { name: 'sources' }
  | { name: 'source-page'; sourceId: string; pageId: string }
  | { name: 'plugin-page'; pluginId: string; pageId: string }
  | {
      name: 'shelf';
      /**
       * Which folder the library was showing when the reader switched to the shelf.
       *
       * The library's own path lives in the library's URL, so switching to the
       * shelf *loses* it — and the reader who switches back expects the folder they
       * were in, not the library root. This is that path.
       */
      libraryPath: string;
      /** The library page that folder was on, for the same reason. */
      libraryPage: number;
      /** The library screen's own page, so the shelf can turn pages at all. */
      page: number;
    }
  | {
      name: 'library';
      path: string;
      page: number;
      /** Which half — see `LibraryView`. `files` is the administrator's. */
      view: LibraryView;
      /** The reader came here from the shelf, so leaving goes back there. */
      fromShelf: boolean;
      /**
       * What is typed in the browsing half's search field.
       *
       * Carried in the route rather than in the screen because a search *is* a
       * place: "科幻 books matching 刘慈欣" is a URL a reader can send, and a query
       * that lives only in a component is one Back, Forward and a reload all drop.
       */
      search: string;
    }
  | { name: 'book'; bookId: string };

/**
 * Where a screen page sits.
 *
 * `shelf` and `library` are siblings in the UI — two entries, two screens — but
 * `book` is not: it is reached *from* the shelf, and "back" from a book has to
 * land on the list that reader was actually looking at.
 */
export interface RouteContext {
  /** Which screen a pageful of books belongs to when the URL cannot say. */
  fromShelf: boolean;
  /** The library path/page the shelf was last showing. */
  libraryPath: string;
  libraryPage: number;
}

/** What the router hands the shell in addition to the route itself. */
export interface RouteLocation {
  /** Canonical fragment for this route, e.g. `#/book/3f2a`. */
  hash: string;
  /**
   * Leaves the current screen.
   *
   * The screens call this instead of `history.back()`, because "back" in an app
   * means "the previous screen" and the browser's history may contain a login
   * form or a page from another site. It is also the *only* correct behaviour for
   * a deep link: a reader who pasted a book URL and presses Back should leave the
   * app, not land on a shelf they have never seen.
   */
  back(): void;
}

export interface RouterOptions {
  /**
   * The URL to write when the app is opened without a fragment.
   *
   * A parameter rather than a constant because the entry point knows where the
   * bundle is hosted — on Android the fragment is relative to
   * `appassets.androidplatform.net` — and this module deliberately does not.
   */
  fallback: string;
  /** Called with the route to paint. Fires once at construction. */
  onChange(route: Route, location: RouteLocation): void;
  /** `window` in the app, a double in tests. */
  window?: RouterWindow;
}

/** The slice of `window` the router uses, so a test can supply its own. */
export interface RouterWindow {
  readonly location: { readonly hash: string };
  readonly history: {
    pushState(state: unknown, title: string, url?: string): void;
    replaceState(state: unknown, title: string, url?: string): void;
  };
  addEventListener(type: 'hashchange', listener: () => void): void;
  removeEventListener(type: 'hashchange', listener: () => void): void;
}

const SHELF: Route = { name: 'shelf', page: 1, libraryPath: '', libraryPage: 1 };

/**
 * Parses a fragment into a route.
 *
 * Never throws and never answers "not found": an unrecognised fragment is the
 * shelf. A URL is user input — it arrives from a bookmark, from a chat message,
 * from an older version of the app — and the failure mode of a strict parser is a
 * blank screen with no way out of it. The shelf is always a valid place to stand.
 */
export function parseRoute(hash: string, context?: RouteContext): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const parts = pathOf(raw).split('/').filter((part) => part.length > 0);
  if (parts.length === 0) return shelfRoute(context);
  const [head, ...rest] = parts;
  if (head === 'plugins' && rest.length === 2) {
    try { return { name: 'plugin-page', pluginId: decodeURIComponent(rest[0]!), pageId: decodeURIComponent(rest[1]!) }; } catch { return shelfRoute(context); }
  }
  if (head === 'sources' && rest.length === 2) {
    try { return { name: 'source-page', sourceId: decodeURIComponent(rest[0]!), pageId: decodeURIComponent(rest[1]!) }; } catch { return shelfRoute(context); }
  }
  if (head === 'sources') return { name: 'sources' };
  if (head === 'shelf') {
    /*
     * A shelf page is the second segment: `#/shelf/2`.
     *
     * The shelf is a screenful of covers plus a row of "继续阅读", and the second
     * block of covers is page two. It needs an address for the same reason the
     * library does — so that Back out of a book lands on the page the reader was
     * on, not on the first sixty books of a two-thousand book library.
     */
    const raw = rest[0] ?? '';
    const page = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : 1;
    return shelfRoute(context, page > 0 ? page : 1);
  }
  if (head === 'book') {
    // Tolerates `#/book/<id>` and `#/book/<id>/<anything>`: the reader has no
    // sub-route of its own, so a link one segment too long still opens the book
    // rather than dropping the reader back on the shelf.
    const raw = rest[0] ?? '';
    if (raw === '') return SHELF;
    return { name: 'book', bookId: safeDecode(raw) };
  }
  if (head === 'library') {
    /*
     * A library URL is
     *   `#/library[/files][/<folder>…][/<page>][?q=<search>]`.
     *
     * Three optional parts and one query. The path parts are read from the *tail*
     * for the same reason as before: a page is a number and `files` is one known
     * word, so both are recognisable, and everything left is a folder. That is what
     * makes a folder genuinely named `files` reachable as `#/library/files/files` —
     * the view segment is only consumed when it is the *first* thing after the
     * route, which is the position `routeHash` writes it in.
     *
     * The search is a real query string (`?q=…`) rather than another path segment,
     * and this is the one place where a query *is* the right answer: it is free
     * text, it is optional, it sits *outside* the folder path so a folder can still
     * contain a slash-free name that looks like a search term, and it is what a
     * browser's own form of the same page would use. `parseRoute` already strips a
     * query before splitting the path (see the top of this function), so a shared
     * link carrying someone else's tracking parameter still resolves to the
     * folder — only `q` is read, and everything else is ignored.
     */
    const tail = rest.at(-1) ?? '';
    const isPage = rest.length > 1 && /^\d+$/.test(tail);
    const withoutPage = isPage ? rest.slice(0, -1) : rest;
    const head2 = withoutPage[0] ?? '';
    const isFiles = head2 === 'files';
    const segments = (isFiles ? withoutPage.slice(1) : withoutPage).map(safeDecode);
    const page = isPage ? Number.parseInt(tail, 10) : 1;
    return {
      name: 'library',
      path: segments.join('/'),
      page: page > 0 ? page : 1,
      // The browsing half is the default, and it is the default *of the URL* rather
      // than of the screen: a reader following a library link almost always means
      // "show me the books in here", and the file manager is where an administrator
      // arrives deliberately. So `#/library/科幻` opens covers and
      // `#/library/files/科幻` opens rows, with no second segment needed for the
      // common case.
      view: isFiles ? 'files' : 'browse',
      fromShelf: context?.fromShelf ?? false,
      search: safeDecode(searchParam(raw)),
    };
  }
  return shelfRoute(context);
}

/**
 * The part of a fragment before its query.
 *
 * A URL is user input and arrives with whatever the sender's client appended to it —
 * `?from=share`, a utm campaign, a tracking parameter nobody asked for. Those are
 * *ignored* rather than rejected (an unknown query is not an error), which is why the
 * path is split off once here instead of at every use: the only query parameter this
 * app reads is `q` on the library, and everything else has to be unable to change
 * where a link lands.
 */
function pathOf(raw: string): string {
  const question = raw.indexOf('?');
  return question === -1 ? raw : raw.slice(0, question);
}

/** One query parameter of a fragment, or '' when it is absent. */
function searchParam(raw: string, name = 'q'): string {
  const question = raw.indexOf('?');
  if (question === -1) return '';
  // `URLSearchParams` on the raw tail rather than a regex: `+` means space, `%xx` is
  // decoded, and a `?`/`&` inside the value is handled by the parser rather than by a
  // pattern that will be wrong for one of them.
  return new URLSearchParams(raw.slice(question + 1)).get(name) ?? '';
}

/**
 * A shelf route, with whatever the URL could not say read from the context.
 *
 * `#/shelf` is one URL for every folder, so a browser Back into it lands on the
 * root unless the context supplies what the reader was actually looking at — and
 * the reader got to the shelf *from* a folder, so their trail is the only place
 * that fact exists.
 */
function shelfRoute(context?: RouteContext, page = 1): Route {
  return {
    name: 'shelf',
    page,
    libraryPath: context?.libraryPath ?? '',
    libraryPage: context?.libraryPage ?? 1,
  };
}

/**
 * The inverse, and the only place a URL is built.
 *
 * Book ids are hex and folder names are Chinese, so escaping is not optional
 * here — and a URL assembled by concatenation is how a `#` or a `%` in a name
 * becomes an unreachable folder later. Every segment is escaped where the URL is
 * built rather than trusted where it is used.
 */
export function routeHash(route: Route): string {
  switch (route.name) {
    case 'source-page': return '#/sources/' + encodeURIComponent(route.sourceId) + '/' + encodeURIComponent(route.pageId);
    case 'plugin-page': return '#/plugins/' + encodeURIComponent(route.pluginId) + '/' + encodeURIComponent(route.pageId);
    case 'sources': return '#/sources';
    case 'shelf':
      // `/1` is the absence of a page: one screen, two URLs, is the thing the
      // router's equality check exists to prevent, and emitting both here is how
      // it would happen.
      return route.page > 1 ? `#/shelf/${route.page}` : '#/shelf';
    case 'book':
      return `#/book/${safeEncode(route.bookId)}`;
    case 'library': {
      const segments = route.path.split('/').filter((segment) => segment.length > 0);
      /*
       * `files` is written only for the file manager, so `#/library` and
       * `#/library/browse` cannot both exist and make the router's equality check
       * see a difference where there is none — the same rule the page segment has
       * always followed.
       */
      const parts = [...(route.view === 'files' ? ['files'] : []), ...segments];
      const head = parts.length === 0 ? '#/library' : `#/library/${parts.map(safeEncode).join('/')}`;
      const paged = route.page > 1 ? `${head}/${route.page}` : head;
      // The query is written last and only when it is not empty: an empty `?q=` is a
      // different URL that means the same thing, and a screen with two URLs is a Back
      // that appears to have done nothing.
      return route.search === '' ? paged : `${paged}?q=${safeEncode(route.search)}`;
    }
  }
}

/** Whether two routes point at the same place. Used to skip a redundant repaint. */
export function sameRoute(a: Route, b: Route): boolean {
  if (a.name !== b.name) return false;
  if (a.name === 'source-page' && b.name === 'source-page') return a.sourceId === b.sourceId && a.pageId === b.pageId;
  if (a.name === 'plugin-page' && b.name === 'plugin-page') return a.pluginId === b.pluginId && a.pageId === b.pageId;
  if (a.name === 'book' && b.name === 'book') return a.bookId === b.bookId;
  if (a.name === 'library' && b.name === 'library') {
    /*
     * The folder, the page and the search are where the reader *is*; the two halves
     * are two routes rather than two pages now, so they never meet here. The search
     * belongs in the list for the reason the page does: a query changes which books
     * are on screen, so treating it as "the same place" would leave the URL changed
     * and the grid not.
     */
    return a.path === b.path && a.page === b.page && a.search === b.search;
  }
  // The shelf's carried library location is *not* part of its identity: it is what
  // the switch-back control will show, and treating it as a difference would make
  // the router repaint (and reset the scroll position of) the same list.
  if (a.name === 'shelf' && b.name === 'shelf') return true;
  return true;
}

/** Where a "back" from this route lands when the app has no trail of its own. */
export function parentOf(route: Route): Route {
  if (route.name === 'plugin-page' || route.name === 'source-page') return { name: 'sources' };
  return route.name === 'shelf' ? SHELF : SHELF;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A truncated percent escape — `decodeURIComponent('%E4%B`) throws, and a
    // half-copied link is exactly how that happens. The raw text is a better
    // answer than an exception the reader cannot act on.
    return value;
  }
}

function safeEncode(value: string): string {
  try {
    return encodeURIComponent(value);
  } catch {
    return value;
  }
}

export class Router {
  private readonly win: RouterWindow;
  private readonly listener: () => void;
  private disposed = false;
  private last: Route | null = null;
  /**
   * The screens the app itself has been through, in order.
   *
   * It exists to answer one question the browser's history cannot: was the entry
   * we are about to leave written by us? If it was not — a deep link pasted into
   * a fresh tab — then "back" has nothing of ours to return to, and pushing the
   * parent screen would give the reader a history they can never empty. In that
   * case the parent *replaces* the entry, so the pasted link stays in the
   * browser's forward history where a reader can still find it.
   */
  private readonly stack: Route[] = [];

  constructor(private readonly options: RouterOptions) {
    const win = options.window ?? (globalThis.window as unknown as RouterWindow);
    this.win = win;
    this.listener = () => this.dispatch();
    win.addEventListener('hashchange', this.listener);
    this.install();
  }

  /** The route currently on screen. */
  current(): Route {
    return this.last ?? this.readHash();
  }

  /**
   * Parses the current fragment, carrying forward what the URL cannot say.
   *
   * Two facts a hash may not encode are read from the last route instead:
   *
   *  - **which screen a library page belongs to** (`fromShelf`), because the same
   *    URL is reachable from both lists and only the trail knows which one the
   *    reader came through; and
   *  - **the shelf's own path**, which the old hash carried and the new one does
   *    not — so a Back into a shelf URL keeps the folder the reader was in rather
   *    than resetting to the library root.
   */
  private readHash(): Route {
    const previous = this.last;
    const context: RouteContext = {
      fromShelf: previous?.name === 'library' && previous.fromShelf,
      libraryPath: previous?.name === 'library' ? previous.path : '',
      libraryPage: previous?.name === 'library' ? previous.page : 1,
    };
    return this.substitute(parseRoute(this.win.location.hash, context), previous);
  }

  /**
   * Carries the parts of the current route that a hash cannot carry.
   *
   * `#/shelf` is one URL for every folder, so a browser Back into it would land on
   * the root. The reader got there from inside a folder, so that is where the URL
   * should mean — otherwise Back out of a book throws away the folder *and* the
   * page they were browsing, which is the whole point of keeping the two screens
   * separable in the first place.
   */
  private substitute(route: Route, previous: Route | null): Route {
    if (route.name === 'shelf') {
      // A Back into `#/shelf` means the shelf the reader was last on, folder and
      // page included: the hash has nowhere to put either, and a shelf that resets
      // to the library root on every Back is a switch that loses the reader's place.
      if (previous?.name === 'shelf') return { ...previous, page: route.page };
      return {
        name: 'shelf',
        page: route.page,
        libraryPath: previous?.name === 'library' ? previous.path : '',
        libraryPage: previous?.name === 'library' ? previous.page : 1,
      };
    }
    if (route.name === 'library') {
      /*
       * Two facts about a library route that the hash cannot always say, filled in
       * from the trail that the URL left behind.
       *
       * **`fromShelf`.** A Back into `#/library` from the shelf says "a library page"
       * and nothing about how the reader got there, and it matters because it decides
       * whether leaving the library goes *back* to the shelf or *out* of the app. A
       * route already marked `fromShelf` is left alone rather than overwritten: the
       * flag is on the URL's own meaning as far as the router is concerned, and this
       * branch only fills in what the hash omitted.
       *
       * **The search.** `#/library/科幻` carries no query, so a Back that lands on it
       * after the reader cleared the field would silently re-run the *previous*
       * search. The hash is the URL and the URL is the truth, so an empty query in the
       * hash means an empty query — there is deliberately nothing to carry here. The
       * note is kept because this is the line somebody will want to add it to, and it
       * would be wrong.
       */
      if (previous?.name === 'shelf' && !route.fromShelf) return { ...route, fromShelf: true };
    }
    return route;
  }

  /**
   * Reads the URL once at start-up, normalising a fragment-less load.
   *
   * `pushState` rather than a `location.hash` assignment: the app may arrive from
   * a link that already carries a fragment (`#/book/<id>` shared between two
   * readers of the same library), and that tail has to survive the first render.
   */
  private install(): void {
    const { location, history } = this.win;
    if (location.hash === '') {
      history.pushState(null, '', this.options.fallback);
      this.track(parseRoute(this.options.fallback));
      this.options.onChange(this.last!, this.locationFor(this.last!));
      return;
    }
    const route = this.readHash();
    this.track(route);
    this.options.onChange(route, this.locationFor(route));
  }

  private dispatch(): void {
    if (this.disposed) return;
    const route = this.readHash();
    this.track(route);
    this.options.onChange(route, this.locationFor(route));
  }

  /**
   * Reconciles the app's stack with where the browser just went.
   *
   * A browser-driven change (Back, Forward, or a link) arrives without telling us
   * whether it moved one step back or ten steps forward, so the stack is aligned
   * to the route instead of appended to: a route we have already been to
   * truncates the trail to that point, and a new one extends it.
   */
  private track(route: Route): void {
    const index = this.stack.findIndex((entry) => sameRoute(entry, route));
    if (index === -1) this.stack.push(route);
    else this.stack.length = index + 1;
    this.last = route;
  }

  private locationFor(route: Route): RouteLocation {
    return { hash: routeHash(route), back: () => this.backFrom(route) };
  }

  /**
   * Leaves the current screen.
   *
   * Deliberately not `history.back()`: the entry behind this one may be the login
   * form, a `vite dev` page, or another site entirely, and none of those are what
   * a reader means by "back". The app's own trail is the truth of where they were,
   * and when it is empty the parent screen is.
   */
  private backFrom(route: Route): void {
    const index = this.stack.findIndex((entry) => sameRoute(entry, route));
    if (index > 0) {
      const previous = this.stack[index - 1]!;
      this.stack.length = index;
      this.replace(previous);
      return;
    }
    this.replace(parentOf(route));
  }

  /**
   * Shows a route and writes its URL.
   *
   * `{ replace: false }` by default, and the flag is not decoration. A *step* into
   * another screen pushes (the reader can go back to where they started); a change
   * that renames the current screen — the library walking into a folder — replaces,
   * because those are steps through one screen and Back should leave the screen
   * rather than retrace the walk. A route equal to the one already on screen is
   * never pushed: a duplicate entry makes Back look broken.
   */
  navigate(route: Route, options: { replace?: boolean } = {}): void {
    const hash = routeHash(route);
    if (options.replace) {
      this.replace(route);
      return;
    }
    const index = this.stack.findIndex((entry) => sameRoute(entry, route));
    if (index !== -1) {
      this.stack.length = index + 1;
    } else {
      this.stack.push(route);
    }
    if (this.win.location.hash === hash) {
      this.last = route;
      this.options.onChange(route, this.locationFor(route));
      return;
    }
    // `pushState` does not fire `hashchange` — that event is only for a real
    // fragment change made by the browser — so the paint is driven from here.
    this.win.history.pushState(null, '', hash);
    this.last = route;
    this.options.onChange(route, this.locationFor(route));
  }

  /**
   * Shows a route by *overwriting* the current entry rather than adding one.
   *
   * Two callers, one reason. A screen that renames itself — the library walking
   * into a folder — must not leave a trail through it, or Back would retrace the
   * walk instead of leaving the screen. And a "back" that has nothing of ours to
   * return to (a deep link, the first load) must overwrite too, so that the
   * pasted URL does not stay behind a shelf the reader has never seen, ready to
   * pull them back into the app on the next Back press.
   *
   * `history.replaceState` is therefore the *only* correct platform call the
   * router needs beyond `pushState` — without it, Back loops.
   */
  private replace(route: Route): void {
    const hash = routeHash(route);
    /*
     * Rewrite the top of the trail rather than extend it.
     *
     * This is the difference between "the library walked into a folder" and "the
     * reader opened a folder": a walk is one screen changing its own argument, so
     * the entry it replaces is the same entry. Appending here would grow the trail
     * with every folder the reader passed through — and Back would then walk them
     * out one at a time, which is the behaviour the breadcrumb exists to replace.
     *
     * Unless the route is already *below* the top, which is what a Back looks like
     * from here: then the trail is truncated to that point, because everything
     * after it is a place the reader has already left.
     */
    const index = this.stack.findIndex((entry) => sameRoute(entry, route));
    if (index !== -1 && index < this.stack.length - 1) this.stack.length = index + 1;
    else this.stack[this.stack.length - 1] = route;
    this.last = route;
    if (this.win.location.hash !== hash) this.win.history.replaceState(null, '', hash);
    this.options.onChange(route, this.locationFor(route));
  }

  dispose(): void {
    this.disposed = true;
    this.win.removeEventListener('hashchange', this.listener);
  }
}
