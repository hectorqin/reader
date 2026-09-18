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
 *  4. **Every paragraph loses its leading whitespace.** What "段前空格" is: the
 *     full-width spaces a scraper indented with, which the client draws itself
 *     from the reader's own indent setting. Kept, they would be indent *added to*
 *     indent, and the setting would appear to do nothing on exactly the files that
 *     needed it most.
 */

/** Paragraphs are separated by a blank line. */
const PARAGRAPH_BREAK = /\n{2,}/;

/** `CRLF` and a lone `CR` are both line endings. */
const LINE_ENDINGS = /\r\n?/g;

/** Characters that end a sentence, so the next line may start a new one. */
const SENTENCE_END = /[。！？…”』】]$/;

/**
 * Characters that begin a *continuation* rather than a sentence.
 *
 * A line starting with one of these is finishing the sentence above it: a closing
 * quote, bracket or dash carried over from a wrapped paragraph, or a clause that
 * opens with punctuation. Excluded from the boundary test so that splitting is
 * driven by the text and not by where a source file happened to wrap.
 */
const CONTINUATION_START = /^[\s，。！？、；：”』】）\u3001-\u303f\uff01-\uff5e]/;

/** Whitespace at the start of a paragraph, including the ideographic space. */
const LEADING_SPACE = /^[\s\u3000\u00a0]+/;

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
  return text
    .replace(LINE_ENDINGS, '\n')
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
    const startsSentence = line.trim().length > 0 && !CONTINUATION_START.test(line);
    if (endsSentence && startsSentence) {
      out.push(current);
      current = line;
    } else {
      // A soft wrap joins with *no* separator: the newline was a line break the
      // file's author did not intend, and keeping it would leave the paragraph
      // full of gaps that grow with the reader's font size. A line ending inside
      // a CJK paragraph is not a space, and inserting one produces the visible
      // "多余的空格" a reader reports as a mangled book.
      current += line;
    }
  }
  out.push(current);
  return out;
}

/** Trims a paragraph and records what the trim removed from its front. */
function toParagraph(block: string): TextParagraph {
  const withoutLeading = block.replace(LEADING_SPACE, '');
  const leading = block.length - withoutLeading.length;
  return { text: withoutLeading.trimEnd(), leading };
}

/**
 * One paragraph as a `<p>`.
 *
 * `textContent`, never `innerHTML`: a TXT is user data, and a novel containing a
 * `&` or a `<` must not be able to produce markup. The absence of `white-space:
 * pre-wrap` is deliberate as well — the paragraph is now a paragraph, and the
 * lines inside it were soft wraps, so the *browser* is what decides where a line
 * ends. That decision is a function of the reader's font size and the column
 * width, which is the whole reason the flow is reflowable.
 */
export function paragraphElement(paragraph: TextParagraph): HTMLParagraphElement {
  const element = document.createElement('p');
  element.textContent = paragraph.text;
  return element;
}

/**
 * A chapter body as a fragment of `<p>` elements.
 *
 * The wrapper is a `<div class="txt-body">` rather than bare paragraphs, because
 * that class is what scopes the plain-text typesheet: an EPUB's chapter must not
 * inherit an indent the reader set for a different book, and the two meet in the
 * same shadow root.
 */
export function textToParagraphs(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const wrapper = document.createElement('div');
  wrapper.className = 'txt-body';
  for (const paragraph of splitTextParagraphs(text)) {
    wrapper.append(paragraphElement(paragraph));
  }
  fragment.append(wrapper);
  return fragment;
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
 * The same rendition, wrapped so the client's scoping class is present.
 *
 * The string form used by the loaders, and the one thing it adds over
 * `textToParagraphHtml` is the wrapper: a chapter's markup is the unit that
 * reaches a shadow root, and the class has to travel with it rather than being
 * added by whoever renders it — a server-rendered chapter carries it in its own
 * response, so a locally loaded one must not be the odd one out.
 */
export function textToChapterHtml(text: string): string {
  return `<div class="txt-body">\n${textToParagraphHtml(text)}\n</div>\n`;
}

/**
 * Whether a text ends at a paragraph break.
 *
 * Exported because the streaming reader has to decide, per chunk, whether the
 * paragraph it is looking at is finished — and the decision is a *rule about
 * paragraphs*, which is what this module owns. Duplicating the regex at the call
 * site would let the two drift, and the failure would be one extra indent somewhere
 * in the middle of a novel: invisible in any test and obvious on the page.
 */
export function endsAtParagraphBreak(text: string): boolean {
  return /(?:\r\n?|\n)\s*$/.test(text);
}
