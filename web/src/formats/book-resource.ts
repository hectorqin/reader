/**
 * The marker that says "this URL is one of the book's own resources".
 *
 * The server rewrites a chapter's relative references to *absolute* URLs, because
 * a chapter is fetched from the asset endpoint rather than from inside the
 * archive, and `images/pic.png` resolves to nothing from there. The client then
 * has to tell such a URL apart from an address the book is pointing at on the
 * internet, because the two are treated oppositely: its own resources are drawn,
 * and a third-party URL is dropped (a book must not be able to leak a reading
 * session or phone home).
 *
 * The distinction used to be inferred from the *string* — "does this look like
 * one of our origins" — and that is what broke every illustrated EPUB: the client
 * compared against the page's origin while the server had written the API's, so
 * every `src` was dropped and the reader got broken-image placeholders. So the
 * marker is a name, declared once here and used by the writer and the reader of
 * the rule, rather than a property of a URL that both sides have to agree on.
 *
 * A query parameter rather than a scheme because the URL has to keep working as
 * one: the browser still fetches it, and the marker only ever has to survive a
 * string comparison.
 */
export const BOOK_RESOURCE_MARKER = '__reader-book-resource__';

/**
 * The chapter reference a link inside a book points at, or null.
 *
 * A chapter's own cross-references are the one place the reader has to read the
 * *server's* rewrite backwards. The server turns `<a href="ch2.xhtml">` into
 * `/api/v1/books/<id>/assets?__reader-book-resource__=1&ref=ch2.xhtml` (see
 * `server/src/indexer/formats/epub.ts`), because a relative href resolves to
 * nothing once the document is served from outside the archive. Left alone, that
 * URL is an *asset* request: the reader would download chapter two as a file and
 * the WebView would try to render it as an image, which is how a tap on an EPUB's
 * own table of contents produced a broken page instead of chapter two.
 *
 * The `ref` this reads is exactly the string the manifest publishes as a content
 * item's `href` (`xhtml:<path>`), so the answer composes with `indexOfSection`
 * and with the windowed jump path unchanged — a link is a chapter change like any
 * other, and it must go through the same code so that a chapter outside the
 * loaded window still fetches its window.
 *
 * `null` covers everything that is *not* a chapter: an image the book linked to, a
 * footnote fragment in the same document, a third-party address (which the
 * sanitiser has already dropped by the time this is called).
 */
export function chapterRefFromLink(href: string, baseURI?: string): string | null {
  const trimmed = href.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;
  let url: URL;
  try {
    url = new URL(trimmed, baseURI ?? document.baseURI);
  } catch {
    return null;
  }
  // The marker is a query parameter of the server's own rewrite. A URL without it
  // is either the book's own relative reference (resolved against the document,
  // which is not something this client can address as a chapter) or an address the
  // sanitiser already decided may not be fetched.
  if (!url.searchParams.has(BOOK_RESOURCE_MARKER)) return null;
  const ref = url.searchParams.get('ref');
  if (!ref) return null;
  // A fragment means "a position inside a document", which for an EPUB is a
  // chapter and would for a footnote be the same chapter. Either way the chapter
  // is what the reader asked to go to, and the fragment is left to the anchor
  // resolver.
  if (!/\.x?html?$/i.test(ref) && !/\.xml$/i.test(ref)) return null;
  return `xhtml:${ref}`;
}
