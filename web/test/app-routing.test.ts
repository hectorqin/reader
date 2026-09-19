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
    // The library's browsing half is the default, so the link carries no `files`
    // segment — which is what makes `#/library/<path>` the page a *reader* is handed
    // and `#/library/files/<path>` the one an administrator navigates to.
    expect(route).toEqual({
      name: 'library', path: '科幻/刘慈欣 作品', page: 1, view: 'browse', fromShelf: false, search: '',
    });
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

/*
 * The library's two halves, as the *URL vocabulary* a reader is handed.
 *
 * The split matters here rather than in the router's own suite because it is a fact
 * about the product rather than about the parser: `#/library/科幻` is the page a
 * reader shares and `#/library/files/科幻` is the page an administrator navigates to,
 * and the first must never resolve to the second. The role check that makes the
 * second unreachable for a member lives in `App.render` (it is a URL guard, not a
 * button guard), and this is the vocabulary that check is written against.
 */
describe('the library’s two halves', () => {
  it('opens the browsing page from a shared folder link', () => {
    expect(parseRoute('#/library/科幻')).toMatchObject({ view: 'browse', path: '科幻' });
    // …and the file manager only from a URL that says so, so a link a member is sent
    // cannot land them on a page whose every control writes to the server's disk.
    expect(parseRoute('#/library/files/科幻')).toMatchObject({ view: 'files', path: '科幻' });
  });

  it('round-trips a filtered view, so a search is shareable', () => {
    const route: Route = {
      name: 'library', path: '科幻', page: 1, view: 'browse', fromShelf: false, search: '刘慈欣',
    };
    expect(routeHash(route)).toBe('#/library/%E7%A7%91%E5%B9%BB?q=%E5%88%98%E6%85%88%E6%AC%A3');
    expect(parseRoute(routeHash(route))).toMatchObject({ path: '科幻', search: '刘慈欣' });
  });
});

// jsdom is present so a `location` exists for the router module's imports to be
// usable at all; nothing here touches the DOM.
beforeEach(() => {
  document.body.replaceChildren();
});
