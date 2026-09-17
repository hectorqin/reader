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

/** A parsed location. */
export type Route =
  | { name: 'shelf' }
  | { name: 'library'; path: string }
  | { name: 'book'; bookId: string };

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

const SHELF: Route = { name: 'shelf' };

/**
 * Parses a fragment into a route.
 *
 * Never throws and never answers "not found": an unrecognised fragment is the
 * shelf. A URL is user input — it arrives from a bookmark, from a chat message,
 * from an older version of the app — and the failure mode of a strict parser is a
 * blank screen with no way out of it. The shelf is always a valid place to stand.
 */
export function parseRoute(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const question = raw.indexOf('?');
  const path = question === -1 ? raw : raw.slice(0, question);
  const parts = path.split('/').filter((part) => part.length > 0);
  if (parts.length === 0) return SHELF;
  const [head, ...rest] = parts;
  if (head === 'shelf') return SHELF;
  if (head === 'book') {
    // Tolerates `#/book/<id>` and `#/book/<id>/<anything>`: the reader has no
    // sub-route of its own, so a link one segment too long still opens the book
    // rather than dropping the reader back on the shelf.
    const raw = rest[0] ?? '';
    if (raw === '') return SHELF;
    return { name: 'book', bookId: safeDecode(raw) };
  }
  if (head === 'library') {
    return { name: 'library', path: rest.map(safeDecode).join('/') };
  }
  return SHELF;
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
    case 'shelf':
      return '#/shelf';
    case 'book':
      return `#/book/${safeEncode(route.bookId)}`;
    case 'library': {
      const segments = route.path.split('/').filter((segment) => segment.length > 0);
      if (segments.length === 0) return '#/library';
      return `#/library/${segments.map(safeEncode).join('/')}`;
    }
  }
}

/** Whether two routes point at the same place. Used to skip a redundant repaint. */
export function sameRoute(a: Route, b: Route): boolean {
  if (a.name !== b.name) return false;
  if (a.name === 'book' && b.name === 'book') return a.bookId === b.bookId;
  if (a.name === 'library' && b.name === 'library') return a.path === b.path;
  return true;
}

/** Where a "back" from this route lands when the app has no trail of its own. */
export function parentOf(route: Route): Route {
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
    return this.last ?? parseRoute(this.win.location.hash);
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
    const route = parseRoute(location.hash);
    this.track(route);
    this.options.onChange(route, this.locationFor(route));
  }

  private dispatch(): void {
    if (this.disposed) return;
    const route = parseRoute(this.win.location.hash);
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
