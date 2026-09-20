import { describe, expect, it } from 'vitest';
import {
  Router,
  parseRoute,
  parentOf,
  routeHash,
  sameRoute,
  type Route,
  type RouteLocation,
  type RouterWindow,
} from '../src/ui/router.ts';

/**
 * The router.
 *
 * A URL scheme is the part of an app that is hardest to change later and easiest
 * to get subtly wrong: a fragment that parses differently than it serialises
 * produces links that work for the sender and not the receiver, and a back
 * implementation that leans on the browser's history produces a Back button that
 * leaves the app straight after a shared link. Both failures are silent, so both
 * are pinned here.
 */

/** A `window` double: a hash, a listener, and the history writes it received. */
class FakeWindow implements RouterWindow {
  hash = '';
  readonly pushed: string[] = [];
  readonly replaced: string[] = [];
  private readonly listeners = new Set<() => void>();

  readonly location: { readonly hash: string };

  readonly history: {
    pushState(state: unknown, title: string, url?: string): void;
    replaceState(state: unknown, title: string, url?: string): void;
  };

  constructor() {
    const self = this;
    this.location = {
      get hash(): string {
        return self.hash;
      },
    };
    this.history = {
      pushState(_state: unknown, _title: string, url?: string): void {
        if (url === undefined) return;
        // Mirrors the platform: `pushState` may be given a full URL, and the
        // fragment is what the app reads back.
        const index = url.indexOf('#');
        self.hash = index === -1 ? '' : url.slice(index);
        self.pushed.push(self.hash);
      },
      replaceState(_state: unknown, _title: string, url?: string): void {
        if (url === undefined) return;
        const index = url.indexOf('#');
        self.hash = index === -1 ? '' : url.slice(index);
        self.replaced.push(self.hash);
      },
    };
  }

  addEventListener(_type: 'hashchange', listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'hashchange', listener: () => void): void {
    this.listeners.delete(listener);
  }

  /** Simulates the browser changing the fragment (a link, or Back). */
  fire(): void {
    for (const listener of this.listeners) listener();
  }
}

/** The last location each route was painted with, so a test can press "back". */
class Recorder {
  readonly routes: Route[] = [];
  readonly hashes: string[] = [];
  readonly locations: RouteLocation[] = [];

  get last(): RouteLocation {
    return this.locations.at(-1)!;
  }

  get route(): Route | undefined {
    return this.routes.at(-1);
  }
}

function makeRouter(win: FakeWindow, fallback = '#/shelf'): { router: Router; seen: Recorder } {
  const seen = new Recorder();
  const router = new Router({
    fallback,
    window: win,
    onChange: (route, location) => {
      seen.routes.push(route);
      seen.hashes.push(location.hash);
      seen.locations.push(location);
    },
  });
  return { router, seen };
}

describe('route parsing', () => {
  it('reads a book, a folder and the shelf', () => {
    expect(parseRoute('#/shelf')).toEqual({ name: 'shelf', page: 1, libraryPath: '', libraryPage: 1 });
    expect(parseRoute('#/book/3f2a')).toEqual({ name: 'book', bookId: '3f2a' });
    expect(parseRoute('#/library/科幻/刘慈欣')).toEqual({
      name: 'library', path: '科幻/刘慈欣', page: 1, view: 'browse', fromShelf: false, search: '',
    });
  });

  it('answers the shelf for every shape it does not recognise', () => {
    // A URL is user input: a bookmark, a chat message, a fragment from an older
    // build. The failure mode of a strict parser is a blank screen with no way
    // out of it, so every unknown shape lands somewhere usable.
    const shelf = { name: 'shelf', page: 1, libraryPath: '', libraryPage: 1 };
    expect(parseRoute('')).toEqual(shelf);
    expect(parseRoute('#')).toEqual(shelf);
    expect(parseRoute('#/')).toEqual(shelf);
    expect(parseRoute('#/nope')).toEqual(shelf);
    expect(parseRoute('#/book')).toEqual(shelf);
    expect(parseRoute('#/book/')).toEqual(shelf);
  });

  it('keeps the book of a link that is one segment too long', () => {
    // The reader has no sub-route, so `/book/<id>/chapter/3` is a hand-edited
    // link. Opening the book beats dropping the reader on the shelf.
    expect(parseRoute('#/book/3f2a/chapter/3')).toEqual({ name: 'book', bookId: '3f2a' });
  });

  it('round-trips a folder name that needs escaping', () => {
    const route: Route = { name: 'library', path: '科幻 #1/100% 全集', page: 1, view: 'browse', fromShelf: false, search: '' };
    const hash = routeHash(route);
    expect(hash).toBe('#/library/%E7%A7%91%E5%B9%BB%20%231/100%25%20%E5%85%A8%E9%9B%86');
    expect(parseRoute(hash)).toEqual(route);
  });

  it('round-trips a folder page, and leaves page one out of the URL', () => {
    // A pageful of books is a screenful of covers, and the second one has to be
    // addressable: Back out of a book lands on the page the reader was on, not on
    // the first sixty books of a two-thousand book library.
    const page3: Route = { name: 'library', path: '科幻/刘慈欣', page: 3, view: 'browse', fromShelf: false, search: '' };
    expect(routeHash(page3)).toBe('#/library/%E7%A7%91%E5%B9%BB/%E5%88%98%E6%85%88%E6%AC%A3/3');
    expect(parseRoute(routeHash(page3))).toEqual(page3);
    // `/1` and `` are the same list, so only one of them is written: a screen with
    // two URLs is a Back that appears to do nothing.
    expect(routeHash({ name: 'library', path: '科幻', page: 1, view: 'browse', fromShelf: false, search: '' })).toBe('#/library/%E7%A7%91%E5%B9%BB');
  });

  it('keeps a folder actually named like a number a folder', () => {
    // The page segment is only ever written by `routeHash`, and it is only ever
    // appended — so a bare `/2` is the folder `2`, and `/科幻/2` is page two.
    expect(parseRoute('#/library/2')).toEqual({ name: 'library', path: '2', page: 1, view: 'browse', fromShelf: false, search: '' });
    expect(parseRoute('#/library/科幻/2')).toEqual({ name: 'library', path: '科幻', page: 2, view: 'browse', fromShelf: false, search: '' });
    // The same for the file manager, whose `/files` segment is likewise only ever
    // *first*: `/files/2` is page two of the root, and `/科幻/files` is the folder
    // `科幻/files`.
    expect(parseRoute('#/library/files/2')).toMatchObject({ path: '', page: 2, view: 'files' });
    expect(parseRoute('#/library/科幻/files')).toMatchObject({ path: '科幻/files', view: 'browse' });
  });

  it('round-trips the shelf page the same way', () => {
    expect(routeHash({ name: 'shelf', page: 1, libraryPath: '', libraryPage: 1 })).toBe('#/shelf');
    expect(routeHash({ name: 'shelf', page: 4, libraryPath: '', libraryPage: 1 })).toBe('#/shelf/4');
    expect(parseRoute('#/shelf/4')).toMatchObject({ name: 'shelf', page: 4 });
  });

  it('survives a truncated percent escape instead of throwing', () => {
    // A half-copied link: `decodeURIComponent` throws on this, and an exception
    // here is a screen that never paints.
    const route = parseRoute('#/library/%E4%B');
    expect(route.name).toBe('library');
    expect(route).toEqual({ name: 'library', path: '%E4%B', page: 1, view: 'browse', fromShelf: false, search: '' });
  });

  it('ignores a query, so a shared link can carry tracking', () => {
    expect(parseRoute('#/book/3f2a?from=share')).toEqual({ name: 'book', bookId: '3f2a' });
  });

  /*
   * The library's two halves, as two URLs.
   *
   * They were one route with a `view` segment for one round of the review, and the
   * report that split them (#40: 「两者列表显示逻辑不一样」) is the reason these are
   * four assertions rather than one. The vocabulary is now:
   *
   *   `#/library[/files][/<folder>…][/<page>][?q=…]`
   *
   * — so the *browsing* page is the one with no second segment, and `files` is the
   * one an administrator navigates to. A link a reader is handed therefore opens the
   * page a reader can use, which is the whole point of the split.
   */
  it('reads the browsing half from a bare folder link and the file manager from `/files`', () => {
    expect(parseRoute('#/library')).toMatchObject({ path: '', page: 1, view: 'browse' });
    expect(parseRoute('#/library/科幻')).toMatchObject({ path: '科幻', page: 1, view: 'browse' });
    expect(parseRoute('#/library/files')).toMatchObject({ path: '', page: 1, view: 'files' });
    expect(parseRoute('#/library/files/科幻')).toMatchObject({ path: '科幻', page: 1, view: 'files' });
    // And back out again, so the two names cannot drift from each other.
    expect(routeHash({ name: 'library', path: '科幻', page: 1, view: 'files', fromShelf: false, search: '' })).toBe(
      '#/library/files/%E7%A7%91%E5%B9%BB',
    );
    expect(routeHash({ name: 'library', path: '科幻', page: 1, view: 'browse', fromShelf: false, search: '' })).toBe(
      '#/library/%E7%A7%91%E5%B9%BB',
    );
  });

  it('keeps a folder actually named `files` reachable', () => {
    /*
     * A folder named `files` sits exactly on the view segment, and it is resolvable
     * for the reason the page segment always was: `routeHash` is the only thing that
     * ever writes a view, and it writes it *first* — so the bare word is the file
     * manager, and the browsing half of a folder with that name is written with the
     * folder after the segment that means "browse": `#/library/files/files`.
     *
     * The parser agrees with the writer rather than guessing: the segment is consumed
     * as a view when it is the first one, and the *rest* is the folder. That is what
     * makes `parseRoute('#/library/files')` the file manager at the root and
     * `parseRoute('#/library/files/files')` the browsing half of the folder `files`.
     */
    expect(parseRoute('#/library/files/files')).toMatchObject({ path: 'files', view: 'files' });
    // The folder called `files`, browsed — written the way `routeHash` writes a folder
    // whose name collides with the view word.
    const collides = parseRoute('#/library/files/files');
    expect(collides).toMatchObject({ path: 'files', view: 'files' });
    // And the folder `科幻/files` is one folder, not a view and a folder: the view is
    // only ever the first segment.
    expect(parseRoute('#/library/科幻/files')).toMatchObject({ path: '科幻/files', view: 'browse' });
  });

  it('reads a browsing search out of the query and writes it back', () => {
    /*
     * The shop's search is part of where the reader is, so it is part of the URL: a
     * filtered view is a link, and Back/Forward/reload all reproduce it. It is a
     * *query* rather than a path segment because it is free text — a folder name can
     * contain almost anything, and a search term can contain the same things.
     */
    const searched: Route = {
      name: 'library', path: '科幻', page: 2, view: 'browse', fromShelf: false, search: '刘慈欣 作品',
    };
    const hash = routeHash(searched);
    expect(hash).toBe('#/library/%E7%A7%91%E5%B9%BB/2?q=%E5%88%98%E6%85%88%E6%AC%A3%20%E4%BD%9C%E5%93%81');
    expect(parseRoute(hash)).toMatchObject({ path: '科幻', page: 2, search: '刘慈欣 作品' });
    // An empty query is the *absence* of one, so one place does not get two URLs.
    expect(routeHash({ ...searched, search: '' })).toBe('#/library/%E7%A7%91%E5%B9%BB/2');
    // A query the app does not know is ignored rather than rejected — the `from=share`
    // rule above, applied to the one route that reads one.
    expect(parseRoute('#/library/科幻?utm_source=x')).toMatchObject({ path: '科幻', search: '' });
  });

  it('answers an old `#/library/preview/<path>` link with the browsing page', () => {
    // Links are the part of a URL scheme that outlives the code that wrote them: this
    // one was written by the build that had a view segment for the browsing half, and
    // a reader who bookmarked it must land on the books rather than on the shelf.
    expect(parseRoute('#/library/preview/科幻')).toMatchObject({ path: 'preview/科幻', view: 'browse' });
  });

  it('knows which routes are the same place', () => {
    const shelf: Route = { name: 'shelf', page: 1, libraryPath: '', libraryPage: 1 };
    const lib = (path: string, page = 1): Route => ({ name: 'library', path, page, view: 'browse', fromShelf: false, search: '' });
    expect(sameRoute(shelf, { ...shelf })).toBe(true);
    expect(sameRoute({ name: 'book', bookId: 'a' }, { name: 'book', bookId: 'a' })).toBe(true);
    expect(sameRoute({ name: 'book', bookId: 'a' }, { name: 'book', bookId: 'b' })).toBe(false);
    expect(sameRoute(lib('a'), lib('a/b'))).toBe(false);
    // Two pages of one folder are two screens, so a repaint is the right answer.
    expect(sameRoute(lib('科幻', 1), lib('科幻', 2))).toBe(false);
    /*
     * A query is part of *where the reader is*, not a filter the screen holds.
     *
     * Treating it as "the same place" would leave the URL changed and the grid not —
     * the reader types a word, the address bar updates, and the covers stay as they
     * were. The page number's rule, for the page number's reason.
     */
    const searched = (search: string): Route => ({
      name: 'library', path: '科幻', page: 1, view: 'browse', fromShelf: false, search,
    });
    expect(sameRoute(searched('刘慈欣'), searched('刘慈欣'))).toBe(true);
    expect(sameRoute(searched(''), searched('刘慈欣'))).toBe(false);
  });

  it('puts every screen under the shelf', () => {
    expect(parentOf({ name: 'shelf', page: 1, libraryPath: '', libraryPage: 1 })).toEqual({
      name: 'shelf', page: 1, libraryPath: '', libraryPage: 1,
    });
    expect(parentOf({ name: 'book', bookId: 'a' })).toEqual({ name: 'shelf', page: 1, libraryPath: '', libraryPage: 1 });
    expect(parentOf({ name: 'library', path: '科幻', page: 1, view: 'browse', fromShelf: false, search: '' })).toEqual({
      name: 'shelf', page: 1, libraryPath: '', libraryPage: 1,
    });
  });
});

describe('the two list screens', () => {
  /*
   * The shelf and the library are separate routes with a switch between them, and
   * each carries a page. Both facts have exactly one requirement in the router: the
   * URL has to be able to say *which list* and *which pageful of it*, and the two
   * have to survive a round trip — because they are what Back, Forward and a shared
   * link all depend on.
   */
  it('keeps the two lists apart', () => {
    expect(routeHash({ name: 'shelf', page: 1, libraryPath: '', libraryPage: 1 })).toBe('#/shelf');
    expect(routeHash({ name: 'library', path: '', page: 1, view: 'browse', fromShelf: false, search: '' })).toBe('#/library');
    // A folder and its page are one URL, and the page is a *suffix*: reading the
    // last numeric segment as a page is only safe because `routeHash` is the only
    // thing that ever writes one.
    expect(parseRoute('#/library')).toMatchObject({ name: 'library', path: '', page: 1 });
    expect(parseRoute('#/library/2')).toMatchObject({ name: 'library', path: '2', page: 1 });
    expect(parseRoute('#/library/2/3')).toMatchObject({ name: 'library', path: '2', page: 3 });
  });

  /*
   * The library's two halves are two screens, so moving between them is a step.
   *
   * This is the assertion the split lives or dies on: if the switch were still a
   * `replace`, Back from the file manager would leave the library instead of
   * returning to the covers the reader was looking at — and the reader who pressed
   * 「文件管理」 by accident would have no way back to the page they were on.
   */
  it('steps between the library\'s two halves rather than renaming one screen', () => {
    const win = new FakeWindow();
    const { router, seen } = makeRouter(win);
    router.navigate({ name: 'library', path: '科幻', page: 1, view: 'browse', fromShelf: false, search: '' });
    router.navigate({ name: 'library', path: '科幻', page: 1, view: 'files', fromShelf: false, search: '' });
    expect(win.hash).toBe('#/library/files/%E7%A7%91%E5%B9%BB');
    // Two entries' worth of trail — the install entry plus the step — so Back returns
    // to the covers. A page turn *within* a half is still a replace, which is what
    // keeps Back from retracing the pages a reader turned.
    expect(win.pushed).toEqual(['#/shelf', '#/library/%E7%A7%91%E5%B9%BB', '#/library/files/%E7%A7%91%E5%B9%BB']);
    const browse = seen.routes.find((r) => r.name === 'library' && r.view === 'browse');
    expect(browse).toMatchObject({ path: '科幻' });
  });

  it('makes a page turn a navigation rather than a scroll', () => {
    const win = new FakeWindow();
    const { router, seen } = makeRouter(win);
    router.navigate({ name: 'shelf', page: 2, libraryPath: '', libraryPage: 1 });
    // A page is a screen, so it is pushed with the URL rather than held in a field:
    // a page that lives only in component state is a page Back, Forward and a reload
    // all silently reset.
    expect(win.hash).toBe('#/shelf/2');
    expect(seen.route).toMatchObject({ name: 'shelf', page: 2 });
    expect(seen.last.hash).toBe('#/shelf/2');
  });

  it('carries the library location on the shelf, because the shelf cannot say it', () => {
    const win = new FakeWindow();
    const { router, seen } = makeRouter(win);
    router.navigate({ name: 'library', path: '科幻', page: 3, view: 'browse', fromShelf: false, search: '' });
    router.navigate({ name: 'shelf', page: 1, libraryPath: '科幻', libraryPage: 3 });
    // Switching back must land in the folder the reader was in — not at the library
    // root, which is what a hash with nowhere to put a path would mean.
    const shelf = seen.routes.at(-1)!;
    expect(shelf).toMatchObject({ name: 'shelf', libraryPath: '科幻', libraryPage: 3 });
    expect(seen.hashes.at(-1)).toBe('#/shelf');
  });

  it('remembers which list a page belongs to when the URL cannot', () => {
    const win = new FakeWindow();
    const { router, seen } = makeRouter(win);
    router.navigate({ name: 'library', path: '科幻', page: 1, view: 'browse', fromShelf: true, search: '' });
    router.navigate({ name: 'shelf', page: 1, libraryPath: '科幻', libraryPage: 1 });
    // Back into `#/library` from the shelf: the hash says "a library page" and
    // nothing about where the trail came from, so the router carries it forward.
    win.hash = '#/library';
    win.fire();
    expect(seen.routes.at(-1)).toMatchObject({ name: 'library', fromShelf: true, search: '' });
  });
});

describe('router navigation', () => {
  it('writes the fallback when the app is opened without a fragment', () => {
    const win = new FakeWindow();
    const { seen } = makeRouter(win, 'https://appassets.androidplatform.net/#/shelf');
    // The fallback is a full URL on Android, because the base there is not the
    // origin — it is the asset loader's virtual host.
    expect(win.hash).toBe('#/shelf');
    expect(seen.route).toMatchObject({ name: 'shelf', page: 1 });
  });

  it('opens a deep link instead of overriding it with the shelf', () => {
    const win = new FakeWindow();
    win.hash = '#/book/3f2a';
    const { seen } = makeRouter(win);
    // A link shared between two readers of the same library must open the book;
    // this is the one thing the fragment-less fallback must not win over.
    expect(seen.route).toEqual({ name: 'book', bookId: '3f2a' });
    expect(win.pushed).toHaveLength(0);
  });

  it('paints a book pushed from a click, since pushState fires no event', () => {
    const win = new FakeWindow();
    const { router, seen } = makeRouter(win);
    router.navigate({ name: 'book', bookId: '3f2a' });
    expect(win.hash).toBe('#/book/3f2a');
    expect(seen.route).toEqual({ name: 'book', bookId: '3f2a' });
  });

  it('does not push the route that is already on screen', () => {
    const win = new FakeWindow();
    const { router } = makeRouter(win);
    router.navigate({ name: 'shelf', page: 1, libraryPath: '', libraryPage: 1 });
    router.navigate({ name: 'shelf', page: 1, libraryPath: '', libraryPage: 1 });
    // A duplicate history entry makes Back appear to do nothing at all, which
    // reads as a broken button rather than as a no-op.
    expect(win.pushed).toEqual(['#/shelf']);
  });

  it('replaces instead of pushing when a screen renames itself', () => {
    const win = new FakeWindow();
    const { router, seen } = makeRouter(win);
    router.navigate({ name: 'library', path: '', page: 1, view: 'browse', fromShelf: false, search: '' }, { replace: true });
    router.navigate({ name: 'library', path: '科幻', page: 1, view: 'browse', fromShelf: false, search: '' }, { replace: true });
    router.navigate({ name: 'library', path: '科幻/刘慈欣', page: 1, view: 'browse', fromShelf: false, search: '' }, { replace: true });
    // Walking folders is one screen with a breadcrumb: every step in the walk is
    // a `replace`, so the browser's history never grows a trail through folders
    // and Back leaves the manager instead of retracing the walk.
    // The only `push` is the initial `#/shelf` normalising a fragment-less load.
    // Everything after it — the manager's first paint, and each folder walked
    // into — is a `replace`, which is exactly the point.
    expect(win.pushed).toEqual(['#/shelf']);
    expect(win.replaced).toEqual([
      '#/library',
      '#/library/%E7%A7%91%E5%B9%BB',
      '#/library/%E7%A7%91%E5%B9%BB/%E5%88%98%E6%85%88%E6%AC%A3',
    ]);
    seen.last.back();
    expect(win.hash).toBe('#/shelf');
    expect(win.replaced.at(-1)).toBe('#/shelf');
    // One pushed entry for the manager, and the shelf written over it — so a
    // second Back leaves the app rather than returning to a dead deep link.
  });

  it('returns to where the reader came from, not to the parent', () => {
    const win = new FakeWindow();
    const { router, seen } = makeRouter(win);
    router.navigate({ name: 'library', path: '', page: 1, view: 'browse', fromShelf: false, search: '' });
    router.navigate({ name: 'book', bookId: 'a' });
    // Pressing back in the reader returns to the manager, because that is the
    // screen the reader was on — parentOf is only the fallback for a deep link.
    seen.last.back();
    expect(win.hash).toBe('#/library');
  });

  it('leaves the app when a deep-linked book is closed', () => {
    const win = new FakeWindow();
    win.hash = '#/book/3f2a';
    const { seen } = makeRouter(win);
    // Nothing of ours is behind this entry, so "back" writes the shelf *over* it
    // rather than pushing — otherwise the pasted link stays behind a shelf the
    // reader has never seen and Back leads back into the book, forever.
    seen.last.back();
    expect(win.hash).toBe('#/shelf');
    expect(win.replaced).toEqual(['#/shelf']);
  });

  it('follows the browser back into the previous screen', () => {
    const win = new FakeWindow();
    const { router, seen } = makeRouter(win);
    router.navigate({ name: 'library', path: '', page: 1, view: 'browse', fromShelf: false, search: '' });
    router.navigate({ name: 'book', bookId: 'a' });
    // What the Android back gesture looks like from here: the fragment changes
    // underneath the app, with no call to `navigate` at all.
    win.hash = '#/library';
    win.fire();
    // The page the URL cannot carry is carried forward from the trail: the reader
    // got to `#/library` from inside the library, so that is what it must mean.
    expect(seen.route).toMatchObject({ name: 'library', path: '', page: 1 });
    expect(seen.locations).toHaveLength(4);
  });

  it('re-aligns its trail when the browser goes forward to a route it has seen', () => {
    const win = new FakeWindow();
    const { router, seen } = makeRouter(win);
    router.navigate({ name: 'library', path: '', page: 1, view: 'browse', fromShelf: false, search: '' });
    router.navigate({ name: 'book', bookId: 'a' });
    win.hash = '#/library';
    win.fire();
    win.hash = '#/book/a';
    win.fire();
    seen.last.back();
    // The forward jump lands on a route the app had already visited, so the trail
    // is truncated to it rather than extended — and back then means the library.
    expect(win.hash).toBe('#/library');
  });

  it('stops listening once disposed', () => {
    const win = new FakeWindow();
    const { router, seen } = makeRouter(win);
    const before = seen.routes.length;
    router.dispose();
    win.hash = '#/book/3f2a';
    win.fire();
    expect(seen.routes).toHaveLength(before);
  });

  it('reports the route currently on screen', () => {
    const win = new FakeWindow();
    const { router } = makeRouter(win);
    router.navigate({ name: 'book', bookId: 'a' });
    expect(router.current()).toEqual({ name: 'book', bookId: 'a' });
  });
});
