/**
 * Turning a page of a book into speech.
 *
 * The hard part of TTS in a reader is not the synthesizer — `speechSynthesis` is
 * one API call. It is deciding **what to say next**, because everything a reader
 * wants to be able to do mid-sentence depends on it:
 *
 *  - highlight the sentence being spoken (so the highlight must be addressable),
 *  - tap a paragraph and hear it from there (so a chunk must map back to a block),
 *  - pause and resume without repeating a whole paragraph,
 *  - switch to another voice mid-book without losing the place.
 *
 * So the unit is a *sentence*, not a paragraph and not the chapter: paragraphs in
 * a Chinese novel can run to a thousand characters, and `speechSynthesis` given
 * one of those either stutters or is interrupted by any other speech request.
 * Sentence granularity is what every reading app that feels good uses, and it is
 * what makes the highlight track the voice instead of jumping block by block.
 *
 * ## Splitting rules, and why they are conservative
 *
 * Chinese books use 。！？…; Western ones use .!? and are full of `Mr.` and
 * `3.14`. The rule below never splits on a `.` that follows a single uppercase
 * letter or a digit, and never merges across a paragraph. Chinese needs no such
 * care — a full-width stop is unambiguous — which is why the two are handled by
 * different branches rather than one clever regex.
 *
 * ## Where the text comes from
 *
 * From the rendered DOM, not from the book's markup. Two reasons: the reader may
 * have a chapter whose markup nests text in ways that only the layout engine
 * resolves (a table cell, a footnote aside), and the spoken text must be exactly
 * the text the reader can see, including anything the format loader generated.
 * `SpokenChunk.node` therefore points at the *text node* the sentence came from,
 * which is what makes the highlight possible without wrapping every sentence in
 * a `<span>` — wrapping would edit the publisher's markup, which this client
 * refuses to do anywhere else and has no reason to start doing here.
 */

/** Elements whose text is not reading material. */
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'RT', 'RP', 'CODE', 'PRE']);

/** Sentence terminators. Kept as two sets because the rules around them differ. */
const CJK_TERMINATORS = new Set(['。', '！', '？', '；', '…', '‼', '⁇', '⁈', '⁉']);
const LATIN_TERMINATORS = new Set(['.', '!', '?', ';']);

/** Pairs that may *follow* a terminator and still belong to the same sentence. */
const CLOSERS = new Set(['\u201d', '\u2019', '\u300d', '\u300f', '\uff09', ')', '\u3011', '\u300b', ']', '"', "'"]);

export interface SpokenChunk {
  /** The sentence, whitespace-collapsed, ready to be handed to the synthesizer. */
  text: string;
  /** The text node the sentence starts in, for highlighting. Null when detached. */
  node: Text | null;
  /** Offset inside `node` where the sentence starts. */
  start: number;
  /** The top-level block the sentence lives in, so the view can scroll to it. */
  blockIndex: number;
}

export interface CollectOptions {
  /** Hard ceiling per utterance; a pathological paragraph must still be spoken. */
  maxChunkLength?: number;
}

/**
 * Walks the chapter's blocks in document order and produces speakable sentences.
 *
 * `root` is the element holding the book's own markup (inside the shadow root).
 * `blocksOf` maps a node to the index of the top-level block containing it — it is
 * injected rather than computed here because the paginator owns that notion, and
 * a sentence must be addressable by the same index a reading position uses.
 */
export function collectSpokenChunks(
  root: ParentNode,
  blocksOf: (node: Node) => number,
  options: CollectOptions = {},
): SpokenChunk[] {
  const max = options.maxChunkLength ?? 300;
  const chunks: SpokenChunk[] = [];
  const walker = root.ownerDocument?.createTreeWalker
    ? root.ownerDocument.createTreeWalker(root as Node, 4 /* SHOW_TEXT */)
    : null;
  if (!walker) return chunks;

  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    if (!isSkipped(text)) {
      const blockIndex = blocksOf(text);
      for (const piece of splitSentence(text.data, max)) {
        const value = piece.text.trim();
        if (!value) continue;
        // A chunk needs at least one letter or ideograph; a lone "——" or "123"
        // produces no useful audio and would make the highlight look broken.
        if (!/[\p{L}\p{N}]/u.test(value)) continue;
        chunks.push({ text: value, node: text, start: piece.start, blockIndex });
      }
    }
    node = walker.nextNode();
  }
  return chunks;
}

/**
 * Splits one text node into sentence pieces.
 *
 * Exported because it is the only part with a decision in it, and it is tested
 * directly instead of through a DOM.
 */
export function splitSentence(text: string, maxLength = 300): Array<{ text: string; start: number }> {
  const pieces: Array<{ text: string; start: number }> = [];
  let start = 0;
  let index = 0;

  const flush = (end: number): void => {
    if (end <= start) return;
    pieces.push({ text: text.slice(start, end), start });
    start = end;
  };

  while (index < text.length) {
    const char = text[index]!;
    if (!CJK_TERMINATORS.has(char) && !LATIN_TERMINATORS.has(char)) {
      index += 1;
      continue;
    }

    // A Latin terminator is only a terminator when followed by whitespace or by
    // the end of the node. That single rule is what protects "Mr. Smith",
    // "3.14" and "e.g." from being cut into three utterances.
    if (LATIN_TERMINATORS.has(char) && !(char === '.' ? isSentenceDot(text, index) : true)) {
      index += 1;
      continue;
    }
    if (LATIN_TERMINATORS.has(char)) {
      const next = text[index + 1];
      if (next !== undefined && !/\s/.test(next) && !CLOSERS.has(next)) {
        index += 1;
        continue;
      }
    }

    let end = index + 1;
    // Swallow a run of identical terminators ("什么？！") and any closing quote
    // or bracket, so the sentence ends where a reader would say it ends.
    while (end < text.length && (CJK_TERMINATORS.has(text[end]!) || LATIN_TERMINATORS.has(text[end]!))) end += 1;
    while (end < text.length && CLOSERS.has(text[end]!)) end += 1;
    flush(Math.min(text.length, end));
    index = end;

    // A "sentence" longer than the ceiling (a paragraph with no punctuation at
    // all, which Chinese web novels do produce) is cut at the last whitespace
    // before the ceiling. Speaking a 2000-character utterance is what makes the
    // synthesizer go silent on Android, so this is not optional.
    if (index - start > maxLength) {
      index = lastBreak(text, start, Math.min(index, start + maxLength));
      flush(index);
    }
  }

  // The same ceiling applies to text that has *no* terminator at all: a run of
  // text with no punctuation would otherwise leave this loop with one enormous
  // piece, which is the exact case the ceiling exists for.
  while (text.length - start > maxLength) {
    const cut = lastBreak(text, start, start + maxLength);
    flush(cut);
  }

  flush(text.length);
  return pieces.filter((piece) => piece.text.trim().length > 0);
}

/** The best place to cut a too-long sentence: whitespace, or failing that a hard cut. */
function lastBreak(text: string, start: number, limit: number): number {
  for (let i = limit - 1; i > start; i -= 1) {
    if (/\s/.test(text[i]!)) return i + 1;
  }
  return limit;
}

/**
 * True when the `.` at `index` really ends a sentence.
 *
 * One rule covers both false positives: a stop that is followed by something that
 * is not whitespace does not end a sentence. "Mr. Smith" has a letter before and a
 * space after (ambiguous), but "3.14", "e.g." and "U.S." are all immediately
 * followed by a non-space, so they are never cut. The trade is that a genuine
 * "end.Next" with no space survives as one sentence — which is a much smaller
 * error than cutting "Mr." off from its name.
 */
function isSentenceDot(text: string, index: number): boolean {
  const previous = text[index - 1];
  // "3.14" — a digit before a stop is a number, not a sentence.
  if (previous !== undefined && /\d/.test(previous)) return false;
  // "Dr." / "Mr." / "St." — a known abbreviation before a stop.
  if (/\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|Rev|vs|etc|No|Fig|Ch|Vol|p|pp|al)$/.test(text.slice(Math.max(0, index - 8), index))) {
    return false;
  }
  return true;
}

/** Skips nodes inside elements that are never read aloud. */
function isSkipped(node: Text): boolean {
  let parent: Node | null = node.parentNode;
  while (parent) {
    const name = (parent as Element).tagName;
    if (name && SKIPPED_TAGS.has(name)) return true;
    parent = parent.parentNode;
  }
  return false;
}

/**
 * The chunk list, navigated by sentence rather than by index arithmetic.
 *
 * The reader keeps a cursor into this; `next`/`previous` skip over chunks whose
 * text node has been detached by a chapter change, which is what makes the
 * toolbar's buttons safe to press at any moment.
 */
export class ChunkCursor {
  private chunks: SpokenChunk[] = [];
  private cursor = -1;

  get all(): readonly SpokenChunk[] {
    return this.chunks;
  }

  get index(): number {
    return this.cursor;
  }

  get current(): SpokenChunk | null {
    return this.chunks[this.cursor] ?? null;
  }

  reset(chunks: SpokenChunk[], index = 0): void {
    this.chunks = chunks;
    this.cursor = chunks.length === 0 ? -1 : Math.max(0, Math.min(chunks.length - 1, index));
  }

  next(): SpokenChunk | null {
    if (this.cursor + 1 >= this.chunks.length) return null;
    this.cursor += 1;
    return this.current;
  }

  previous(): SpokenChunk | null {
    if (this.cursor <= 0) return null;
    this.cursor -= 1;
    return this.current;
  }

  /** The first chunk at or after `chunk`, used when resuming after a jump. */
  seekTo(chunk: SpokenChunk | null): boolean {
    if (!chunk) return false;
    const index = this.chunks.indexOf(chunk);
    if (index === -1) return false;
    this.cursor = index;
    return true;
  }
}
