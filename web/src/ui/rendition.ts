/**
 * The reference a section is fetched under.
 *
 * Kept out of the screen on purpose: it is a *mapping between two namespaces* — the
 * server's `href`, which is also the section id and therefore the identity a saved
 * position and an offline cache entry are keyed on, and the `ref` this client asks
 * the asset endpoint for. Getting it wrong is not a rendering bug; it is a chapter
 * that comes back as the wrong bytes, or an offline reader whose cache never hits.
 *
 * The reason it exists at all: for a TXT the server names *two* renditions under one
 * `href` — a capped streaming window (`chapter:<n>`) and the whole chapter
 * (`chapter-full:<n>`) — and the client has to choose. Baking the choice into the
 * server's `href` would change the id, and every existing reader's saved position
 * with it; deciding it here keeps old positions resolving and new chapters whole.
 *
 * `chapter-full:` used to be `chapter-html:`, back when this reference also meant
 * "server-rendered markup". That half is gone (the client typesets, see
 * `formats/segments.ts`) and only the name still claimed otherwise. The old spelling
 * is still answered by the server, so a client and a server on opposite sides of the
 * rename both work; this client asks under the new one.
 *
 * Because the reference is also the offline cache key, the new name gets a new cache
 * entry. That is intended: a body cached under the old name was fetched when the old
 * name could have meant markup, and reusing it would be trusting a response's
 * *label* over its content. One re-fetch per chapter, once.
 */

/**
 * The reference to fetch for an item's rendition.
 *
 * `chapter-full:` is `chapter:` without the streaming cap — one whole chapter for a
 * reader who is about to read it in one piece. An item that does not declare `html`
 * is fetched exactly as the server named it, which is the behaviour every other
 * format already relies on.
 */
export function renditionRef(item: { href: string; format?: string; resourceRef?: string }): string {
  if (item.resourceRef) return item.resourceRef;
  if (item.format !== 'html') return item.href;
  if (item.href.startsWith('chapter:')) return `chapter-full:${item.href.slice('chapter:'.length)}`;
  return item.href;
}

/**
 * Whether a cached chapter predates its stylesheets being embedded.
 *
 * A chapter read through the server applies only its `<style>` blocks; a `<link>`
 * in its head is never loaded. Until the server embedded each chapter's linked
 * stylesheets, an EPUB read online rendered without its publisher's styles — and a
 * chapter cached on the device then still does, because the reader prefers its
 * cache. Such a chapter is recognisable by the link the server used to leave: a
 * stylesheet (not an alternate one) pointing at the book's own resources. The
 * reader re-fetches it once when it can, and keeps the cached copy when it cannot.
 */
export function cachedChapterLacksStyles(bytes: Uint8Array, mediaType: string): boolean {
  if (!/html|xml/i.test(mediaType) || bytes.byteLength > 4 * 1024 * 1024) return false;
  const head = new TextDecoder().decode(bytes.subarray(0, 64 * 1024));
  for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
    const rel = /\brel\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]?.toLowerCase() ?? '';
    if (
      rel.split(/\s+/).includes('stylesheet') &&
      !rel.includes('alternate') &&
      tag.includes('__reader-book-resource__')
    )
      return true;
  }
  return false;
}
