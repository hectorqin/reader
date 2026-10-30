/**
 * Paragraph inference for plain text — the first half of the TXT排版.
 *
 * A TXT file has no markup at all, so the only structure it has is its line
 * breaks, and those are ambiguous in a way that has to be decided *once*, in one
 * place, rather than guessed at independently by every consumer. This module is
 * that place.
 *
 * Why the client does this and the server does not. A TXT's paragraph boundaries
 * look like formatting, but they are really a *reading* decision: which indent a
 * reader wants, whether a hard-wrapped line is a paragraph or a continuation, and
 * what a scraped novel's one-paragraph-per-line file should look like. All three
 * are per-device preferences that a reader changes while looking at the page, and
 * a server that baked them into a response would make every one of them a round
 * trip. So the server hands out the text as it is stored and the client typesets
 * it — which is also what makes the same file look the same on a phone, in the
 * browser and inside the Android shell, since all three run this code.
 *
 * The rules, in order:
 *
 *  1. **A blank line ends a paragraph.** The only unambiguous signal a TXT has.
 *  2. **Carriage returns are line endings.** Old conversions and files off a
 *     serial console use `CR` alone; treated as a character instead, the whole
 *     file arrives as one paragraph — the exact failure this module exists to
 *     prevent, arriving through the encoding path nobody tests.
 *  3. **A line that ends a sentence and is followed by one that starts a sentence
 *     is a paragraph boundary.** Chinese web novels are routinely scraped one
 *     paragraph per line with no blank lines at all; without this rule such a book
 *     is a single slab, and with a *looser* rule a hard-wrapped paragraph is
 *     chopped into fragments. The lookahead on the next line is what keeps the
 *     second failure out: a wrapped paragraph's continuation starts mid-sentence.
 *
 *     The lookahead is applied to the next line's *content*, with its indentation
 *     removed first, and that detail is load-bearing rather than tidy: the same
 *     scraped novels that need this rule are the ones that indent every paragraph
 *     with two full-width spaces, so a rule that read the leading whitespace as
 *     "this line continues the one above" never fired on any of them.
 *  0. **Web-page markup is cleaned first.** Novels saved from a site arrive as
 *     TXT with the page's `<div>`, `<br/>` and `&nbsp;` still in them; escaped,
 *     they are drawn literally and every `<br/>` line is a gap. See
 *     {@link cleanTextMarkup}.
 *  4. **Every paragraph loses its leading whitespace.** What "段前空格" is: the
 *     full-width spaces a scraper indented with, which the client draws itself
 *     from the reader's own indent setting. Kept, they would be indent *added to*
 *     indent, and the setting would appear to do nothing on exactly the files that
 *     needed it most.
 */

/**
 * HTML tags a scraped page leaves in a TXT. Only real tag names are matched, so a
 * `<` in prose (`a<b`, a quoted `<书名>`) is text and stays text.
 */
const BLOCK_TAG = /<\/?(?:br|p|div|h[1-6]|li|ul|ol|tr|table|tbody|section|article|blockquote|center|pre|hr|dd|dt|dl)\b[^<>]*>/gi;
const INLINE_TAG = /<\/?(?:span|font|b|i|u|em|strong|small|big|a|img|sup|sub|ins|del|s|strike|tt|code|mark|abbr|cite|q|wbr|o:p)\b[^<>]*>/gi;
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', ensp: ' ', emsp: '\u3000', thinsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…', mdash: '—', ndash: '–', middot: '·',
};
const ENTITY = /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,8}));/gi;
/** A line holding only whitespace is a blank line: a reader cannot tell them apart. */
const WHITESPACE_LINE = /^[ \t\u3000\u00a0]+$/gm;

/**
 * Removes the markup a web page leaves behind in a TXT, keeping its line structure.
 *
 * Block tags (`<br>`, `<p>`, `<div>`, headings, list items) become line breaks, so
 * the paragraphs they marked survive as the blank lines the rules below read;
 * inline tags (`<span>`, `<font>`) are dropped; common character entities become
 * the characters they stand for. Idempotent, and a file without markup is returned
 * with only its whitespace-only lines emptied. The result is still *text*: every
 * consumer escapes it, so nothing here can turn into markup.
 */
export function cleanTextMarkup(text: string): string {
  return decodeEntities(text.replace(LINE_ENDINGS, '\n').replace(BLOCK_TAG, '\n').replace(INLINE_TAG, ''))
    .replace(WHITESPACE_LINE, '');
}

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (all, decimal: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? all;
    const code = decimal ? Number(decimal) : Number.parseInt(hex!, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
  });
}

/** Elements a chapter cannot lose by being read as text. */
const RICH_MARKUP = /<(?:img|svg|table|video|audio|iframe|math|canvas|picture|object|embed|ruby)\b/i;
const COMMENT = /<!--[\s\S]*?-->/g;
const HIDDEN_BLOCK = /<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const ANY_TAG = /<\/?[a-zA-Z][^<>]*>/g;

/**
 * Whether a book source's HTML chapter is only text with line-level markup, so it
 * can be typeset like a TXT without losing anything (no images, tables or media).
 */
export function isTextOnlyMarkup(html: string): boolean {
  return !RICH_MARKUP.test(html);
}

/**
 * A book source's HTML chapter as characters, the way legado-E reads it
 * (`HtmlFormatter.format`): block tags and line breaks become newlines and every
 * other tag is removed. Unlike {@link cleanTextMarkup} the input *is* markup, so
 * no tag survives as text; entities are decoded last, so an escaped `&lt;b&gt;`
 * in the prose becomes the characters `<b>` rather than being stripped.
 */
export function htmlToText(html: string): string {
  const stripped = html.replace(LINE_ENDINGS, '\n').replace(COMMENT, '').replace(HIDDEN_BLOCK, '')
    .replace(BLOCK_TAG, '\n').replace(ANY_TAG, '');
  return decodeEntities(stripped).replace(WHITESPACE_LINE, '');
}

/** Paragraphs are separated by a blank line. */
const PARAGRAPH_BREAK = /\n{2,}/;

/** `CRLF` and a lone `CR` are both line endings. */
const LINE_ENDINGS = /\r\n?/g;

/** Characters that end a sentence, so the next line may start a new one. */
const SENTENCE_END = /[。！？…”』】]$/;

/**
 * What a line starts with, once its indentation has been set aside.
 *
 * Splitting the indentation out is the whole of the rule, and getting it wrong is
 * the difference between a novel and one paragraph. `CONTINUATION_START` used to
 * be tested against the line *as written*, and its first alternative was `\s` —
 * whitespace. Every paragraph of a Chinese web novel begins with two full-width
 * spaces, so **every** indented line was classified a continuation: the boundary
 * rule never fired once and a chapter of forty paragraphs became a single slab of
 * text. It was invisible in the tests because their fixtures wrote paragraphs
 * *without* the indent that the files the module exists for are full of.
 *
 * So the two alternatives are separated: `CONTINUATION_START` is punctuation, and
 * the indentation is carried for the paragraph it belongs to (which is also what
 * lets the reader's indent be `text-indent` from zero without the file's own
 * indentation stacking on top of it).
 */
const INDENT = /^[\s\u3000\u00a0]+/;

/**
 * Characters that begin a *continuation* rather than a sentence.
 *
 * A line starting with one of these is finishing the sentence above it: a closing
 * quote, bracket or dash carried over from a wrapped paragraph, or a clause that
 * opens with punctuation. Excluded from the boundary test so that splitting is
 * driven by the text and not by where a source file happened to wrap.
 *
 * Deliberately no whitespace: the line's indentation is stripped before this is
 * applied, so a leading space can never make a paragraph look like a continuation
 * again.
 */
const CONTINUATION_START = /^[，。！？、；：”』】）\u3001-\u303f\uff01-\uff5e]/;

/**
 * The leading whitespace a line had, in *characters*.
 *
 * Reported rather than only removed because two spaces at the head of a line is
 * also how a TXT file spells "this is a diary entry / a letter / a quotation",
 * and the reader's indent is drawn with `text-indent` from zero — so a paragraph
 * whose own leading space was significant is rendered as an ordinary one. Nothing
 * depends on this yet; it exists so that a future rule can, without re-deriving
 * the information from text that has already been trimmed.
 */
export interface TextParagraph {
  /** The paragraph's text, with leading and trailing whitespace removed. */
  text: string;
  /** How many whitespace characters were removed from the front. */
  leading: number;
}

/**
 * Splits plain text into paragraphs, dropping the ones that are only whitespace.
 *
 * The single entry point for the whole client: the local TXT loader, the
 * windowed-manifest path and the streaming text reader all render what this
 * returns, so a book cannot look like a different book depending on which
 * transport happened to deliver it.
 */
export function splitTextParagraphs(text: string): TextParagraph[] {
  return cleanTextMarkup(text)
    .split(PARAGRAPH_BREAK)
    .flatMap((block) => splitSentenceBreaks(block))
    .map(toParagraph)
    .filter((paragraph) => paragraph.text.length > 0);
}

/**
 * Splits a block on sentence-final newlines, keeping continuations joined.
 *
 * `String.prototype.split` cannot express this: the lookahead decides from the
 * *next* line whether the newline was a boundary, and a split throws that line
 * away with the separator. So the lines are walked, and a newline is promoted
 * only when the line above ends a sentence and the line below starts one.
 */
function splitSentenceBreaks(block: string): string[] {
  const lines = block.split('\n');
  const out: string[] = [];
  let current = lines[0] ?? '';
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const endsSentence = SENTENCE_END.test(current.trimEnd());
    // Tested against the content, not the raw line: see `CONTINUATION_START`.
    const content = line.replace(INDENT, '');
    const startsSentence = content.length > 0 && !CONTINUATION_START.test(content);
    if (endsSentence && startsSentence) {
      out.push(current);
      current = line;
    } else {
      // A soft wrap joins with *no* separator: the newline was a line break the
      // file's author did not intend, and keeping it would leave the paragraph
      // full of gaps that grow with the reader's font size. A line ending inside
      // a CJK paragraph is not a space, and inserting one produces the visible
      // "多余的空格" a reader reports as a mangled book.
      //
      // Its *indentation* goes with it. A file that indents every paragraph and
      // also hard-wraps long ones indents the continuation lines too, so joining
      // the raw line put two full-width spaces in the middle of a sentence — the
      // same "多余的空格", from the same character, one branch over. The
      // indentation belongs to a paragraph's first line, and this line is not one.
      current += content;
    }
  }
  out.push(current);
  return out;
}

/**
 * Trims a paragraph and records what the trim removed from its front.
 *
 * The leading count is in *characters* and includes a full-width space as one, so
 * a caller can tell "this paragraph was indented with two ideographic spaces"
 * from "it was indented with four ASCII ones" — the two are written by different
 * converters, and only the first is what a Chinese novel's indentation is.
 */
function toParagraph(block: string): TextParagraph {
  const withoutLeading = block.replace(INDENT, '');
  const leading = block.length - withoutLeading.length;
  return { text: withoutLeading.trimEnd(), leading };
}

/**
 * The same rendition, as an HTML string.
 *
 * The string form exists for the local TXT loader, whose sections are HTML rather
 * than nodes (`formats/types.ts`): a document assembled once from a whole file in
 * memory is cheaper to describe as markup than as ten thousand elements built one
 * at a time. Both forms call the same split, so the two cannot drift.
 */
export function textToParagraphHtml(text: string): string {
  return splitTextParagraphs(text)
    .map((paragraph) => `<p>${escapeHtml(paragraph.text)}</p>`)
    .join('\n');
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
 * A chapter heading, promoted out of the body.
 *
 * A chapter's own slice *includes* its heading line — chapter splitting records
 * the heading as the chapter's first line, which is what makes a saved position
 * land on the title rather than one line into the chapter. Left as ordinary prose
 * it renders as `第二章 落雨雨来了。`: the title and the first sentence glued
 * together with no separation, which is what a reader reports as "格式乱了".
 *
 * Promoted rather than merely split off, because it is the one piece of structure
 * a TXT actually has, and a reader scanning for a chapter boundary is looking for
 * exactly this. The patterns are deliberately narrow for the same reason the
 * chapter *split* is: a false positive restructures the book rather than
 * rendering it.
 */
const HEADING_PATTERNS: readonly RegExp[] = [
  /^第\s*[0-9０-９零一二三四五六七八九十百千万两]+\s*[章回节卷部篇集]\s*[:：.、\-—]?\s*.{0,60}$/,
  /^(?:序章|序言|楔子|引子|前言|后记|尾声|终章|番外|附录)\s*.{0,40}$/,
  /^[卷部]\s*[0-9０-９零一二三四五六七八九十百千万两]+\s*.{0,60}$/,
  /^Chapter\s*\d+.*$/i,
  /^#{1,3}\s+.+$/,
];

/** The longest line still plausibly a heading rather than prose. */
const MAX_HEADING_LENGTH = 60;

function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_HEADING_LENGTH) return false;
  return HEADING_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Splits a chapter body into its heading line and the rest.
 *
 * Only the *first* non-blank line is considered: a heading anywhere else is a line
 * of prose that happens to look like one, and promoting those would restructure
 * the book rather than render it.
 */
export function splitChapterHeading(text: string): { heading: string; body: string } {
  const normalised = cleanTextMarkup(text);
  const lines = normalised.split('\n');
  const firstIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstIndex === -1) return { heading: '', body: '' };
  if (!isHeadingLine(lines[firstIndex] ?? '')) return { heading: '', body: normalised };
  return {
    heading: (lines[firstIndex] ?? '').trim(),
    body: lines.slice(firstIndex + 1).join('\n'),
  };
}

/**
 * The same rendition, wrapped so the client's scoping class is present.
 *
 * The string form used by the loaders, and what it adds over
 * `textToParagraphHtml` is the wrapper — a chapter's markup is the unit that
 * reaches a shadow root, and the class has to travel with it rather than being
 * added by whoever renders it — plus the heading promotion, which is the same
 * decision on every path (a locale's own file, the windowed manifest, the stream)
 * rather than one the server made for two of them.
 */
export function textToChapterHtml(text: string): string {
  const { heading, body } = splitChapterHeading(text);
  const promoted = heading ? `<h3>${escapeHtml(heading)}</h3>\n` : '';
  return `<div class="txt-body">\n${promoted}${textToParagraphHtml(body)}\n</div>\n`;
}
