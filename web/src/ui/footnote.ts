/**
 * Footnotes, read where the reader already is.
 *
 * A note reference in a book is a link to a place — `#note3` in the same chapter,
 * or `notes.xhtml#n12` at the back of the book — and following it literally takes
 * the reader away from the sentence they were in the middle of, to a place they
 * then have to find their way back from. What they asked was "what does this note
 * say", so the note is shown beside the reference and the jump stays available as
 * a button.
 *
 * A book does not have to say which of its links are notes. EPUB 3 can
 * (`epub:type="noteref"`, `role="doc-noteref"`), most books in the wild do not,
 * and the same `<a href="#x">` is also how a note links *back* to the text and how
 * a chapter links to a heading. So two questions are asked, and a preview is shown
 * only when both answer yes; every other link is a jump, as it was:
 *
 *  1. Does the link look like a reference mark (`isNoteReference`)?
 *  2. Does what it points at look like a note (`noteAt`)?
 *
 * Everything here reads the DOM and nothing else, so it works the same on the
 * chapter on screen and on a parsed, never-attached copy of another chapter.
 */

/** A note longer than this is a section, not a note; it is read by going there. */
const MAX_NOTE_CHARS = 1500;
/** Text allowed before a target inside its block for the block to still be "the note". */
const MAX_LEAD_CHARS = 6;

const INLINE = new Set(['A', 'SUP', 'SUB', 'SPAN', 'B', 'I', 'EM', 'STRONG', 'SMALL', 'FONT', 'CITE']);
const BLOCK = 'p, li, aside, dd, td, div, section, blockquote';
const LEAF = 'p, li, dd, blockquote';

/** `epub:type` and `role`, the two places a book declares what an element is. */
function declared(element: Element): string {
  return `${element.getAttribute('epub:type') ?? ''} ${element.getAttribute('role') ?? ''}`.toLowerCase();
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** `[1]`, `(12)`, `①`, `*`, `注3`, `a` — a mark, as opposed to words. */
const MARK = /^[[(（【〔]?\s*(?:\d{1,4}|[*†‡§¶#]{1,3}|[①-⑳㉑-㉟㊱-㊿]|注\s*\d{0,4}|[a-z])\s*[\])）】〕]?$/i;
const BACK = /[↩↑⏎]|返回/;

/**
 * Whether a link reads as a note reference rather than as a cross-reference.
 *
 * The book's own declaration wins in both directions. Without one, a reference is
 * recognised by what it looks like on the page: superscript, a bare mark, or the
 * picture-only anchor some publishers use for a note icon.
 */
export function isNoteReference(anchor: Element): boolean {
  const type = declared(anchor);
  if (/backlink|referrer/.test(type)) return false;
  if (/noteref/.test(type)) return true;
  const text = squash(anchor.textContent ?? '');
  if (BACK.test(text)) return false;
  if (/footnote|noteref/i.test(anchor.getAttribute('class') ?? '')) return true;
  if (anchor.closest('sup') || anchor.querySelector('sup')) return true;
  if (!text) return anchor.querySelector('img, svg') !== null;
  return MARK.test(text);
}

/** The element a fragment names, by `id` and then by the older `name`. */
export function fragmentTarget(root: ParentNode, fragment: string): Element | null {
  let id = fragment;
  try { id = decodeURIComponent(fragment); } catch { /* a literal id that merely contains a % */ }
  if (!id) return null;
  for (const element of root.querySelectorAll('[id], [name]')) {
    if (element.getAttribute('id') === id || element.getAttribute('name') === id) return element;
  }
  return null;
}

/**
 * The note a fragment points at, as paragraphs of text — or null when the target
 * is not a note and the link should simply be followed.
 *
 * The target is very often not the note itself but a small anchor at its start
 * (`<p><a id="n3" href="#r3">[3]</a> The note.</p>`), so an inline target stands
 * for the block around it. That is also how a note's *back* link is told apart: it
 * points at a mark in the middle of a paragraph of body text, and a target with a
 * sentence in front of it is a place in the text, not a note.
 *
 * Text only. A note is shown in the app's own sheet, outside the book's shadow
 * root and its stylesheet, so markup carried over would be the book's HTML
 * rendered without the book's rules — and nothing a book contains is injected
 * into the app's own tree.
 */
export function noteAt(root: ParentNode, fragment: string): string[] | null {
  const target = fragmentTarget(root, fragment);
  if (!target) return null;
  let block: Element = target;
  if (!/footnote|endnote|rearnote/.test(declared(target)) && (INLINE.has(target.tagName.toUpperCase()) || !squash(target.textContent ?? ''))) {
    const outer = target.closest(BLOCK);
    if (!outer || outer === target) return null;
    const lead = outer.ownerDocument.createRange();
    lead.setStart(outer, 0);
    lead.setEndBefore(target);
    if (squash(lead.toString()).length > MAX_LEAD_CHARS) return null;
    block = outer;
  }
  if (/^H[1-6]$/i.test(block.tagName)) return null;

  const copy = block.cloneNode(true) as Element;
  for (const element of copy.querySelectorAll('script, style')) element.remove();
  for (const link of copy.querySelectorAll('a')) {
    if (/backlink|referrer/.test(declared(link)) || BACK.test(link.textContent ?? '')) link.remove();
  }
  const leaves = [...copy.querySelectorAll(LEAF)].filter(element => !element.querySelector(LEAF));
  const paragraphs = (leaves.length ? leaves : [copy]).map(element => squash(element.textContent ?? '')).filter(Boolean);
  const length = paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0);
  if (!length || length > MAX_NOTE_CHARS) return null;
  return paragraphs;
}

/** The same question asked of a chapter that is not on screen, from its markup. */
export function noteInMarkup(html: string, fragment: string): string[] | null {
  // `DOMParser` builds an inert document: no script runs, nothing is fetched, and
  // only its text leaves this function.
  return noteAt(new DOMParser().parseFromString(html, 'text/html'), fragment);
}
