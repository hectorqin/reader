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
    expect(parseRoute('#/shelf')).toEqual({ name: 'shelf' });
    expect(parseRoute('#/book/3f2a')).toEqual({ name: 'book', bookId: '3f2a' });
    expect(parseRoute('#/library/科幻/刘慈欣')).toEqual({ name: 'library', path: '科幻/刘慈欣' });
  });

  it('answers the shelf for every shape it does not recognise', () => {
    // A URL is user input: a bookmark, a chat message, a fragment from an older
    // build. The failure mode of a strict parser is a blank screen with no way
    // out of it, so every unknown shape lands somewhere usable.
    expect(parseRoute('')).toEqual({ name: 'shelf' });
    expect(parseRoute('#')).toEqual({ name: 'shelf' });
    expect(parseRoute('#/')).toEqual({ name: 'shelf' });
    expect(parseRoute('#/nope')).toEqual({ name: 'shelf' });
    expect(parseRoute('#/book')).toEqual({ name: 'shelf' });
    expect(parseRoute('#/book/')).toEqual({ name: 'shelf' });
  });

  it('keeps the book of a link that is one segment too long', () => {
    // The reader has no sub-route, so `/book/<id>/chapter/3` is a hand-edited
    // link. Opening the book beats dropping the reader on the shelf.
    expect(parseRoute('#/book/3f2a/chapter/3')).toEqual({ name: 'book', bookId: '3f2a' });
  });

  it('round-trips a folder name that needs escaping', () => {
    const route: Route = { name: 'library', path: '科幻 #1/100% 全集' };
    const hash = routeHash(route);
    expect(hash).toBe('#/library/%E7%A7%91%E5%B9%BB%20%231/100%25%20%E5%85%A8%E9%9B%86');
    expect(parseRoute(hash)).toEqual(route);
  });

  it('survives a truncated percent escape instead of throwing', () => {
    // A half-copied link: `decodeURIComponent` throws on this, and an exception
    // here is a screen that never paints.
    const route = parseRoute('#/library/%E4%B');
    expect(route.name).toBe('library');
    expect(route).toEqual({ name: 'library', path: '%E4%B' });
  });

  it('ignores a query, so a shared link can carry tracking', () => {
    expect(parseRoute('#/book/3f2a?from=share')).toEqual({ name: 'book', bookId: '3f2a' });
  });

  it('knows which routes are the same place', () => {
    expect(sameRoute({ name: 'shelf' }, { name: 'shelf' })).toBe(true);
    expect(sameRoute({ name: 'book', bookId: 'a' }, { name: 'book', bookId: 'a' })).toBe(true);
    expect(sameRoute({ name: 'book', bookId: 'a' }, { name: 'book', bookId: 'b' })).toBe(false);
    expect(sameRoute({ name: 'library', path: 'a' }, { name: 'library', path: 'a/b' })).toBe(false);
  });

  it('puts every screen under the shelf', () => {
    expect(parentOf({ name: 'shelf' })).toEqual({ name: 'shelf' });
    expect(parentOf({ name: 'book', bookId: 'a' })).toEqual({ name: 'shelf' });
    expect(parentOf({ name: 'library', path: '科幻' })).toEqual({ name: 'shelf' });
  });
});

describe('router navigation', () => {
  it('writes the fallback when the app is opened without a fragment', () => {
    const win = new FakeWindow();
    const { seen } = makeRouter(win, 'https://appassets.androidplatform.net/#/shelf');
    // The fallback is a full URL on Android, because the base there is not the
    // origin — it is the asset loader's virtual host.
    expect(win.hash).toBe('#/shelf');
    expect(seen.route).toEqual({ name: 'shelf' });
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
    router.navigate({ name: 'shelf' });
    router.navigate({ name: 'shelf' });
    // A duplicate history entry makes Back appear to do nothing at all, which
    // reads as a broken button rather than as a no-op.
    expect(win.pushed).toEqual(['#/shelf']);
  });

  it('replaces instead of pushing when a screen renames itself', () => {
    const win = new FakeWindow();
    const { router, seen } = makeRouter(win);
    router.navigate({ name: 'library', path: '' }, { replace: true });
    router.navigate({ name: 'library', path: '科幻' }, { replace: true });
    router.navigate({ name: 'library', path: '科幻/刘慈欣' }, { replace: true });
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
    router.navigate({ name: 'library', path: '' });
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
    router.navigate({ name: 'library', path: '' });
    router.navigate({ name: 'book', bookId: 'a' });
    // What the Android back gesture looks like from here: the fragment changes
    // underneath the app, with no call to `navigate` at all.
    win.hash = '#/library';
    win.fire();
    expect(seen.route).toEqual({ name: 'library', path: '' });
    expect(seen.locations).toHaveLength(4);
  });

  it('re-aligns its trail when the browser goes forward to a route it has seen', () => {
    const win = new FakeWindow();
    const { router, seen } = makeRouter(win);
    router.navigate({ name: 'library', path: '' });
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
