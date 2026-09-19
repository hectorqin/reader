/**
 * Asset URLs that a browser can fetch on its own.
 *
 * A chapter document is rendered by the browser, which then requests its
 * `<img src>`, `<link href>` and `@font-face` resources itself. Those requests
 * cannot carry an `Authorization` header — there is no API to attach one to an
 * element's URL.
 *
 * The two available answers are both bad in different ways:
 *
 *  1. **Fetch everything in JavaScript and hand out Blob URLs.** This works, and
 *     it means the client downloads and buffers every image in a chapter before
 *     the book can render, defeats the browser's own caching, and makes an
 *     `iframe`'s range requests for a large plate image impossible. For a chapter
 *     with twelve illustrations it is several megabytes of JavaScript-side work on
 *     every turn.
 *  2. **Put the token in the URL.** The browser's own caching, range requests and
 *     parallel image loading all keep working, and the exposure is bounded by the
 *     server only accepting a query token on read endpoints for immutable content.
 *
 * The second is what this module does, and the server's `queryTokenAllowed` is
 * the other half of the arrangement — it is an allowlist, not a blanket rule, so
 * a leaked URL cannot trigger a scan or write metadata.
 *
 * Tokens in URLs do leak: into browser history, into a proxy's access log, into a
 * `Referer` header. Three things keep that acceptable here. Asset URLs are only
 * ever built for a document that is being displayed in the reading frame, never
 * for an outbound link. They are scoped to a single book and expire with the
 * access token. And the endpoint they reach serves immutable content addressed by
 * content hash — the worst a leaked URL gives away is a page of a book whose
 * reader already had it.
 */

import type { ApiClient } from './api.ts';

/**
 * What signing one address needs: where the API is, and the token to sign with.
 *
 * Passed as two values rather than as a client object on purpose. There are two API
 * clients in this codebase — `net/api.ts` and `api/client.ts` — and they disagree
 * about how to read the session (a getter in one, a method in the other, to say
 * nothing of the reader's being behind an interface). Naming either one would make
 * the signer unusable from the other, and neither is actually what the operation
 * needs: an address is signed by knowing the *base URL* and the *token*, and
 * nothing else in a client can change the answer.
 */
export interface AssetSigning {
  /** The API's base, so a root-relative URL can be told from a foreign one. */
  baseUrl: string;
  /** The access token, read at the moment the signer is built. */
  accessToken: string;
}

/**
 * Rewrite the asset URLs inside a chapter document to carry the token.
 *
 * The server has already made every relative reference absolute, so this only has
 * to append a parameter to the URLs that point back at the asset endpoint. URLs
 * that already carry `access_token` are left alone, which makes the function
 * idempotent — it runs on every chapter, including one served from the prefetch
 * cache.
 *
 * `DOMParser` rather than a regex: the document is XHTML and its markup is the
 * publisher's, so entity handling and attribute quoting are the parser's job, not
 * a pattern's. The parse is done once per chapter and the serialization is what
 * the frame receives anyway.
 */
/**
 * The signer the *reader* uses, for the requests the browser makes itself.
 *
 * The same arrangement as `withAssetToken`, exposed as a function over one URL
 * rather than over a document. The reader's chapter path takes the document from
 * the *server's* asset endpoint, so the resources inside it are already absolute
 * URLs pointing back at that endpoint — and the browser fetches those itself, with
 * no header it could attach a credential to. A token in the query is the only way
 * such a request can be authorised, and the server's `queryTokenAllowed` is the
 * other half of the arrangement: it accepts a query token on read endpoints for
 * immutable content and nowhere else.
 *
 * The distinction from `withAssetToken` is which pass over the document does the
 * work, and it is not cosmetic. That function parses the markup, which means it
 * only ever sees URLs the *document* contains, and the reader's own sanitising pass
 * runs on the live DOM afterwards — so a URL the sanitising pass *kept* would still
 * come out unsigned. Signing has to be the last thing that happens to an address,
 * after the decision that it may be fetched at all, or the two passes disagree
 * about which URLs are real.
 */
export function makeAssetSigner(api: AssetSigning): ((url: string) => string | null) | null {
  const token = api.accessToken;
  if (!token) return null;
  return (url) => {
    if (!isApiAsset(url, api.baseUrl) || hasToken(url)) return null;
    return appendToken(url, token);
  };
}

export function withAssetToken(html: string, api: ApiClient): string {
  const token = api.currentSession?.accessToken;
  if (!token) return html;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'application/xhtml+xml');

  // A parse error means the chapter is not well-formed XML. The container reports
  // that to the reader with the HTML fallback; here it just means no rewriting,
  // because rewriting a document we could not parse risks making it worse.
  if (doc.querySelector('parsererror')) return html;

  let touched = false;
  const attributes = ['src', 'href', 'poster'] as const;
  for (const attribute of attributes) {
    for (const element of Array.from(doc.querySelectorAll(`[${attribute}]`))) {
      const value = element.getAttribute(attribute);
      if (!value || !isApiAsset(value, api.baseUrl)) continue;
      if (hasToken(value)) continue;
      element.setAttribute(attribute, appendToken(value, token));
      touched = true;
    }
  }
  // `style` attributes and `<style>` blocks can carry `url(...)` too, which is
  // how a publisher ships a background image.
  for (const element of Array.from(doc.querySelectorAll('[style]'))) {
    const value = element.getAttribute('style');
    if (!value) continue;
    const rewritten = rewriteCssUrls(value, api.baseUrl, token);
    if (rewritten !== value) {
      element.setAttribute('style', rewritten);
      touched = true;
    }
  }
  for (const style of Array.from(doc.querySelectorAll('style'))) {
    const value = style.textContent;
    if (!value) continue;
    const rewritten = rewriteCssUrls(value, api.baseUrl, token);
    if (rewritten !== value) {
      style.textContent = rewritten;
      touched = true;
    }
  }

  if (!touched) return html;
  return `<?xml version="1.0" encoding="utf-8"?>\n${new XMLSerializer().serializeToString(doc.documentElement)}`;
}

/**
 * Whether a URL points at this instance's asset endpoint.
 *
 * Takes the base URL rather than a client, so the two callers (the document
 * rewriter, which has a client, and the signer, which has only a base and a token)
 * can share one definition of "our address". Two copies of this test is how the
 * client came to compare a page's origin against an API's.
 */
function isApiAsset(value: string, base: string): boolean {
  if (value.startsWith('/api/')) return true;
  return base.length > 0 && value.startsWith(`${base}/api/`);
}

function hasToken(value: string): boolean {
  return value.includes('access_token=');
}

function appendToken(value: string, token: string): string {
  const [path, fragment] = splitFragment(value);
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}access_token=${encodeURIComponent(token)}${fragment}`;
}

/** Rewrite `url(...)` inside a CSS string, leaving anything else untouched. */
function rewriteCssUrls(css: string, base: string, token: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, quote: string, value: string) => {
    if (!isApiAsset(value, base) || hasToken(value)) return full;
    return `url(${quote}${appendToken(value, token)}${quote})`;
  });
}

function splitFragment(value: string): [string, string] {
  const index = value.indexOf('#');
  if (index < 0) return [value, ''];
  return [value.slice(0, index), value.slice(index)];
}
