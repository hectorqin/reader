// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { parseRoute, routeHash, type Route } from '../src/ui/router.ts';

/**
 * The parts of the shell's routing contract that do not need the whole app.
 *
 * The full round trip — a URL becoming a screen, a book link surviving a load
 * with no session — is exercised in a real browser, because jsdom has no history
 * and no layout to speak of. What is pinned here is the part that would break the
 * *link* rather than the screen: that a URL a reader can be handed resolves to
 * the screen it promises, and that the canonical hash of that screen is stable.
 *
 * It is a small file on purpose. The router has its own tests; this one exists so
 * that a change to the app's *vocabulary* (`shelf` / `library` / `book`) fails
 * here, next to the routes, rather than in a browser smoke test nobody runs.
 */

describe('shareable links', () => {
  it('resolves a book link to a book route, and back to the same link', () => {
    const route = parseRoute('#/book/9f3c1a');
    expect(route).toEqual({ name: 'book', bookId: '9f3c1a' });
    // The round trip is the contract: a link the sender can build is one the
    // receiver can open, and the app always writes the canonical form.
    expect(routeHash(route)).toBe('#/book/9f3c1a');
  });

  it('resolves a library folder link, including Chinese names and spaces', () => {
    const route = parseRoute('#/library/%E7%A7%91%E5%B9%BB/%E5%88%98%E6%85%88%E6%AC%A3%20%E4%BD%9C%E5%93%81');
    expect(route).toEqual({ name: 'library', path: '科幻/刘慈欣 作品', page: 1, fromShelf: false });
    expect(routeHash(route)).toBe('#/library/%E7%A7%91%E5%B9%BB/%E5%88%98%E6%85%88%E6%AC%A3%20%E4%BD%9C%E5%93%81');
  });

  it('treats the bare origin and an unknown fragment as the shelf', () => {
    // A reader who bookmarks the app, or follows a link from an older build.
    const shelf: Route = { name: 'shelf', page: 1, libraryPath: '', libraryPage: 1 };
    expect(parseRoute('')).toEqual(shelf);
    expect(parseRoute('#/bookshelf')).toEqual(shelf);
    expect(routeHash(shelf)).toBe('#/shelf');
  });

  it('keeps a book link working when its id needs escaping', () => {
    // Not the current id format, but the one a future server might mint.
    const route = { name: 'book', bookId: 'a/b c' } as const;
    expect(routeHash(route)).toBe('#/book/a%2Fb%20c');
    expect(parseRoute(routeHash(route))).toEqual(route);
  });
});

// jsdom is present so a `location` exists for the router module's imports to be
// usable at all; nothing here touches the DOM.
beforeEach(() => {
  document.body.replaceChildren();
});
