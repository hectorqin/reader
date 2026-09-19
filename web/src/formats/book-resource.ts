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
