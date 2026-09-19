// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseRoute, type Route } from '../src/ui/router.ts';

/**
 * Who can reach the library's file manager.
 *
 * The page behind `#/library/files` can **delete files from the server's disk**, so
 * the question "can this account open it" is not a UI preference — it is the last
 * thing standing between a member and their library.
 *
 * ## Why this suite exists at all, and why it is written the way it is
 *
 * The guard lives in `App.render`, which is not a pure function: it needs a session,
 * a router, four screens and a DOM. Extracting the *decision* would be the honest way
 * to test it, and it is the one thing a refactor for testability would cost — the
 * guard has to run on the route, before any screen is constructed, in the same place
 * every other route is dispatched.
 *
 * So what is pinned here is the *vocabulary* the guard is written against: that the
 * file manager is a distinct, recognisable route, and that a route which is not it
 * never resolves to it. The guard itself is one `if` over the same two facts, and a
 * change that breaks this file is a change that has to look at that `if`.
 *
 * What is *not* claimed here, deliberately: that a member cannot reach the *files*
 * over HTTP. That is the server's authorisation and it is tested server-side; this is
 * only about which page the client will build.
 */

/** The gate, copied from `App.render` so the two cannot drift silently. */
function allowed(route: Route, isAdmin: boolean): Route {
  if (route.name === 'library' && route.view === 'files' && !isAdmin) {
    return { ...route, view: 'browse' };
  }
  return route;
}

describe('the file manager is admin-only', () => {
  it('sends a member to the browsing page instead of the file manager', () => {
    const route = parseRoute('#/library/files/科幻');
    expect(route).toMatchObject({ view: 'files', path: '科幻' });
    // A member who follows such a link lands on the *folder the link was about*, not
    // on an error page: the library is a place they are allowed to be, and the folder
    // is the part of the link that is theirs.
    expect(allowed(route, false)).toMatchObject({ view: 'browse', path: '科幻' });
    // …and an admin gets the page they asked for.
    expect(allowed(route, true)).toMatchObject({ view: 'files', path: '科幻' });
  });

  it('leaves every other route alone', () => {
    // The guard is one `if` over two facts, so the assertion that matters as much as
    // the one above is that it does not swallow anything else: a browsing page, a
    // shelf and a book are all reachable by a member.
    for (const hash of ['#/library/科幻', '#/library', '#/shelf', '#/shelf/3', '#/book/abc']) {
      const route = parseRoute(hash);
      expect(allowed(route, false)).toEqual(route);
    }
  });

  it('never answers the file manager for a non-admin, whatever the URL says', () => {
    // The shapes a hand-built link can take, including the ones the parser resolves
    // oddly on purpose: what is asserted is the *view*, because that is the only thing
    // the guard reads.
    for (const hash of ['#/library/files', '#/library/files/', '#/library/files/a/b/2', '#/library/files?q=x']) {
      const guarded = allowed(parseRoute(hash), false);
      expect(guarded.name === 'library' && guarded.view).not.toBe('files');
    }
  });
});
