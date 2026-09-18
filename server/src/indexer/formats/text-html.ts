/**
 * The `chapter-html:<n>` rendition: one chapter, whole, as a document.
 *
 * This is a *transport* for a chapter's characters, not a typesetting pass. The
 * server's only two jobs are to hand over the entire chapter (nothing truncated)
 * and to say where its paragraphs are (a blank line, a line ending, a
 * sentence-final newline) — the boundaries are a property of the file, so they
 * are inferred once, here, against the undecoded text.
 *
 * The indentation, the paragraph spacing and the removal of the leading spaces a
 * scraper wrote are *not* the server's business, and that is a deliberate change.
 * They are reading preferences: a phone and a tablet want different indents, and
 * a reader changes them while looking at the page. A server that baked them into
 * a response made every one of those changes a round trip, and it made a book
 * read windowed (`chapter:<n>`, no markup to carry the decision) look different
 * from the same book read whole. The client typesets the text it is given (see
 * `web/src/formats/segments.ts`), so the two transports agree by construction and
 * the setting costs no request.
 *
 * What is left here is the shape the client's shadow root expects: a *fragment*
 * wrapped the same way an EPUB chapter is (`<div class="txt-body">…`). Nothing is
 * sanitised away by `sanitiseInjectedContent`: no scripts, no absolute URLs, and
 * every character escaped.
 */

/** Paragraphs are separated by a blank line; a single newline is a soft wrap. */
const PARAGRAPH_BREAK = /\n{2,}/;

/**
 * A lone carriage return is a line break too.
 *
 * Old conversions and files off a serial console use `CR` on its own, and a
 * newline-only split leaves the whole file as one paragraph — the exact failure
 * this file exists to prevent, arriving through the one encoding path nobody
 * tests. Normalised first so every rule below sees `\n`.
 */
const LINE_ENDINGS = /\r\n?/g;

/**
 * A paragraph that ends a sentence is a paragraph even without a blank line.
 *
 * This is the one heuristic worth having for Chinese web novels: tools that scrape
 * them routinely emit every paragraph on its own line with no blank line between,
 * and treating each line as its own paragraph is the only way such a file gets
 * any indentation at all. The lookahead requires the *next* line to start a new
 * sentence (not a continuation), so a paragraph wrapped across two lines is still
 * joined rather than split down the middle.
 */
const SENTENCE_BREAK = /(?<=[。！？…”』】])\n(?=\s*[^\s，。！？、；：”』】）])/;

/**
 * Characters that begin a *continuation* rather than a sentence.
 *
 * A line starting with one of these is finishing the sentence above it: a closing
 * quote, bracket or dash carried over, or a clause opening with punctuation. The
 * lookahead in `SENTENCE_BREAK` already excludes the ones that are unambiguous;
 * this list is the same exclusions plus the closing brackets that only *look* like
 * they could start a sentence.
 */
const CONTINUATION_START = /^[\s，。！？、；：”』】）\u3001-\u303f\uff01-\uff5e]/;

/**
 * A leading heading line, promoted out of the body.
 *
 * A chapter's own slice *includes* its heading line — `splitChapters` records the
 * heading as the chapter's first line, which is what makes a locator land on the
 * chapter's title rather than one line into it. So the body handed to this file
 * starts with the title, and rendering it as an ordinary paragraph produces the
 * tell-tale `第二章 落雨雨来了。` — title and first sentence glued together with no
 * separation.
 *
 * Promoted to a real heading rather than merely split off, because it is the one
 * piece of structure a TXT actually has, and a reader scanning for a chapter
 * boundary is looking for exactly this.
 */
const HEADING_PATTERNS: readonly RegExp[] = [
  /^\s*第\s*[0-9０-９零一二三四五六七八九十百千万两]+\s*[章回节卷部篇集]\s*[:：.、\-—]?\s*.{0,60}$/,
  /^\s*(?:序章|序言|楔子|引子|前言|后记|尾声|终章|番外|附录)\s*.{0,40}$/,
  /^\s*[卷部]\s*[0-9０-９零一二三四五六七八九十百千万两]+\s*.{0,60}$/,
  /^\s*Chapter\s*\d+.*$/i,
  /^\s*#{1,3}\s+.+$/,
];

/** The longest line still plausibly a heading rather than prose. */
const MAX_HEADING_LENGTH = 60;

function isHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_HEADING_LENGTH) return false;
  return HEADING_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Escapes the five characters that would otherwise let a file rewrite the page. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Splits a chapter body into paragraph-sized strings.
 *
 * Exported because the split is the part worth testing: the escaping and the
 * wrapping below are mechanical, and every interesting failure of this file is a
 * paragraph boundary in the wrong place.
 */
export function splitParagraphs(body: string): string[] {
  return body
    .replace(LINE_ENDINGS, '\n')
    .split(PARAGRAPH_BREAK)
    .flatMap((block) => splitSentenceBreaks(block))
    .map((block) => block.replace(/\n/g, '').trim())
    .filter((block) => block.length > 0);
}

/**
 * Splits a block on sentence-final newlines, leaving continuations joined.
 *
 * `String.prototype.split` cannot express this on its own: the lookahead decides
 * from the *next* line whether the newline was a paragraph boundary, and a regex
 * split throws that line away with the separator. So the lines are walked, and a
 * newline is promoted to a boundary only when the line above ends a sentence and
 * the line below starts one.
 */
function splitSentenceBreaks(block: string): string[] {
  const lines = block.split('\n');
  const out: string[] = [];
  let current = lines[0] ?? '';
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const endsSentence = SENTENCE_END.test(current.trimEnd());
    const startsSentence = line.trim().length > 0 && !CONTINUATION_START.test(line);
    if (endsSentence && startsSentence) {
      out.push(current);
      current = line;
    } else {
      current += `\n${line}`;
    }
  }
  out.push(current);
  return out;
}

/** True when a line ends in a mark that closes a sentence. */
const SENTENCE_END = /[。！？…”』】]$/;

/**
 * Renders a chapter body as the `chapter-html` payload.
 *
 * A `<div class="txt-body">` rather than bare `<p>`s, so the client can scope its
 * own TXT rules to exactly this content and leave an EPUB's chapters untouched.
 * The markup it contains is what the client is expected to *re-typeset*; what the
 * server promises is the whole chapter and the paragraph boundaries within it,
 * and nothing about how it looks.
 */
export function renderChapterHtml(body: string): Buffer {
  const normalised = body.replace(LINE_ENDINGS, '\n');
  const lines = normalised.split('\n');
  // Only the *first* non-blank line is considered: a heading anywhere else is a
  // line of prose that happens to look like one, and promoting those would
  // restructure the book rather than render it.
  const firstIndex = lines.findIndex((line) => line.trim().length > 0);
  const hasHeading = firstIndex !== -1 && isHeading(lines[firstIndex] ?? '');
  const heading = hasHeading ? (lines[firstIndex] ?? '').trim() : '';
  const rest = hasHeading ? lines.slice(firstIndex + 1).join('\n') : normalised;

  const parts = splitParagraphs(rest).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`);
  if (heading) parts.unshift(`<h3>${escapeHtml(heading)}</h3>`);
  const html = parts.join('\n');
  return Buffer.from(`<div class="txt-body">\n${html}\n</div>\n`, 'utf8');
}
