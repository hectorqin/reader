/**
 * The `chapter-full:<n>` rendition: one chapter, whole, and nothing else.
 *
 * This file used to be a typesetting pass — it inferred paragraph boundaries,
 * promoted a heading and emitted `<p>` elements. It is not one any more, and the
 * change is deliberate: the reader's paragraph boundaries, its indent, its
 * paragraph spacing and the removal of a scraper's leading spaces are all
 * *reading* decisions. A server that baked them into a response made every one of
 * them a round trip, and it meant the same file could be typeset two different
 * ways depending on which transport happened to deliver it (the windowed
 * `chapter-full:` path got markup; the streamed `chapter:` path got characters and
 * no paragraphs at all).
 *
 * So the server's job has shrunk to the one thing only it can do: hand over the
 * characters of a chapter, complete. The client typesets them — see
 * `web/src/formats/segments.ts`, which is the single definition of what a paragraph
 * is for a TXT and is shared by every path a text can reach the reader through.
 *
 * The reference itself is what this file is named after, and it has two spellings
 * while they migrate: `chapter-full:` is the name, and `chapter-html:` is the old
 * one, still answered. The name matters because a reference is opaque and
 * format-specific by design — a client that understands neither falls back to
 * `chapter:` and keeps working, and a client that was shipped asking for
 * `chapter-html:` keeps getting the same bytes while it is replaced.
 */

/** Escapes the five characters that would otherwise let a file rewrite the page. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
