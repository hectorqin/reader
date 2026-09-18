/**
 * The plain-text reader.
 *
 * TXT is the format that punishes naive implementations, because everything the
 * reader wants — a page count, a table of contents, a scroll position that means
 * something — depends on the text being measured, and the text is 20MB.
 *
 * The approach:
 *
 *  - **A table of contents comes from the server.** Chapter headings are detected
 *    server-side (encoding-aware) and returned as items. The client does not
 *    re-scan the text for headings, which would mean downloading the whole file
 *    to build a contents list.
 *  - **Chapters are fetched one at a time.** A book with headings is read exactly
 *    like an EPUB, which is why this module is a thin layer over the reflowable
 *    reader rather than the reader.
 *  - **A book without headings is streamed in chunks.** The server exposes byte
 *    ranges; the client appends them as the reader reaches the bottom. Appending
 *    rather than replacing is what keeps a scroll position valid.
 *
 * Its typography is the reader's own, and it comes from the same place the
 * windowed TXT path gets it: `formats/segments.ts` decides what a paragraph is,
 * so a book cannot look like a different book depending on whether it arrived as
 * a window or as a stream. The one thing this path does differently is *add* to
 * the reading surface instead of replacing it — the split is therefore applied per
 * chunk, which is why a chunk boundary is always taken at a paragraph end (see
 * `paragraphsOf`).
 */

import { ApiClient, type BookDto } from '../net/api.ts';
import { Emitter } from '../lib/events.ts';
import { endsAtParagraphBreak, paragraphElement, splitTextParagraphs } from '../formats/segments.ts';

/** Size of a streamed chunk, matching the server's own window. */
const CHUNK_CHARS = 256 * 1024;
/** Stop appending this far from the end. */
const APPEND_THRESHOLD_PX = 1200;

export interface TextState {
  book: BookDto;
  /** Position in the text, in characters. */
  offset: number;
  /** Chapters when the book has headings; empty when it does not. */
  chapters: number;
  /** Whether more text is available to append. */
  hasMore: boolean;
  loading: boolean;
}

export interface TextOptions {
  device?: string;
}

/**
 * Read a plain-text book.
 *
 * Two modes, chosen by whether the server found headings. This is not a
 * simplification: the choice changes what "a position" means (a chapter index or
 * a character offset) and therefore what a progress update contains.
 */
export class TextReader {
  readonly state = new Emitter<TextState>();
  private offset = 0;
  private loading = false;
  private finished = false;
  /**
   * The tail of the last chunk, which could not be split yet.
   *
   * At most one paragraph, and it exists because a split needs to see the *next*
   * line: the last paragraph of a chunk might still be continued by the first line
   * of the one after it.
   */
  private carry = '';
  private readonly scroll: HTMLElement;

  private readonly host: HTMLElement;

  constructor(
    host: HTMLElement,
    private readonly api: ApiClient,
    private readonly book: BookDto,
    private readonly options: TextOptions = {},
  ) {
    this.host = host;
    this.scroll = document.createElement('div');
    this.scroll.className = 'reader-text';
    this.host.replaceChildren(this.scroll);
  }

  /**
   * Stream the book, appending as the reader approaches the end.
   *
   * The offset is tracked in characters rather than bytes because the client
   * counts characters: the server's `chunk:` references are character offsets,
   * and the reply's length is reported in bytes. Mixing the two would cut a
   * Chinese novel in the middle of a character every 256KB — a visible defect
   * roughly every few pages.
   */
  async open(): Promise<void> {
    await this.append();
    this.scroll.addEventListener('scroll', () => this.maybeAppend());
  }

  /** Load the next chapter, when the book has a table of contents. */
  async goToChapter(index: number, bookId: string): Promise<void> {
    const blob = await this.api.asset(bookId, `chapter:${index}`);
    const { fragment } = paragraphsOf(await blob.text(), '');
    this.scroll.replaceChildren(fragment);
    this.offset = 0;
    this.scroll.scrollTop = 0;
    this.emit(false);
    await this.saveProgress(bookId, index);
  }

  async flush(bookId: string): Promise<void> {
    await this.saveProgress(bookId, null);
  }

  destroy(): void {
    this.host.replaceChildren();
    this.state.clear();
  }

  private maybeAppend(): void {
    if (this.finished || this.loading) return;
    const remaining = this.scroll.scrollHeight - this.scroll.scrollTop - this.scroll.clientHeight;
    if (remaining > APPEND_THRESHOLD_PX) return;
    void this.append();
  }

  private async append(): Promise<void> {
    if (this.loading || this.finished) return;
    this.loading = true;
    this.emit(true);
    try {
      const blob = await this.api.asset(this.book.id, `chunk:${this.offset}`);
      const text = await blob.text();
      if (text.length === 0) {
        this.finished = true;
        return;
      }
      this.offset += text.length;
      const { fragment, rest } = paragraphsOf(text, this.carry);
      this.scroll.append(fragment);
      // Kept for the next chunk: see `paragraphsOf`. Re-emitting it is what would
      // duplicate a paragraph across a chunk boundary.
      this.carry = rest;
      // A short reply means the end was reached; asking again would return empty
      // forever and keep a spinner on screen.
      if (text.length < CHUNK_CHARS) {
        this.finished = true;
        // The final chunk is the one place where "wait for the next line" has no
        // next line; whatever was held back has to be drawn or the novel loses its
        // last paragraph.
        if (this.carry) {
          const { fragment: tail } = paragraphsOf(`${this.carry}\n\n`, '');
          this.scroll.append(tail);
          this.carry = '';
        }
      }
    } finally {
      this.loading = false;
      this.emit(false);
    }
  }

  private async saveProgress(bookId: string, chapter: number | null): Promise<void> {
    // A streamed text has no known total length, so progress is "how far in" as a
    // fraction of what has been loaded. Reporting it as whole-book progress would
    // need the byte count the server deliberately does not compute.
    const loaded = this.scroll.scrollHeight || 1;
    const ratio = Math.max(0, Math.min(1, this.scroll.scrollTop / loaded));
    const locator =
      chapter !== null
        ? JSON.stringify({ chapter: `chapter:${chapter}`, spine: chapter, block: 0, ratio, percent: ratio })
        : JSON.stringify({ chapter: `chunk:${Math.round(this.offset * ratio)}`, spine: 0, block: 0, ratio, percent: ratio });
    await this.api
      .putProgress(bookId, {
        locator,
        percentage: ratio,
        chapterTitle: chapter !== null ? `第 ${chapter + 1} 章` : '',
        device: this.options.device ?? 'web',
        updatedAt: Date.now(),
      })
      .catch(() => undefined);
  }

  private emit(loading: boolean): void {
    this.state.emit({
      book: this.book,
      offset: this.offset,
      chapters: 0,
      hasMore: !this.finished,
      loading,
    });
  }
}

/**
 * A chunk of text as `<p>` elements, for the reader's typography.
 *
 * The split itself is `formats/segments.ts`, shared with the windowed TXT path so
 * the two cannot disagree about where a paragraph is. What is *not* shared is what
 * a hard-wrapped line means, and the difference is why this function exists
 * instead of a one-line call: a stream arrives in 256KB pieces, so a chunk
 * boundary usually lands in the middle of a paragraph, and both of the split's
 * rules look at the *next* line to decide. Splitting each chunk independently
 * would therefore turn every chunk boundary into a spurious paragraph break — one
 * extra indent somewhere in the middle of a novel, which is exactly the kind of
 * defect that is never reported but always visible.
 *
 * `carry` is the text left over from the previous chunk: everything the split
 * could not finish, which is at most the final incomplete paragraph. It is
 * prepended so the boundary paragraph is decided with both of its halves present,
 * and the last paragraph is held back rather than emitted — there is no way to
 * know yet whether more of it is coming.
 */
function paragraphsOf(
  text: string,
  carry: string,
): { fragment: DocumentFragment; rest: string } {
  const combined = carry + text;
  const split = splitTextParagraphs(combined);
  // The last paragraph is only held back when the chunk was cut, which is the
  // case whenever it is not the final one. An empty result means the chunk ended
  // at a paragraph break, so there is nothing to carry.
  const endsClean = endsAtParagraphBreak(combined);
  const settled = endsClean ? split : split.slice(0, -1);
  const rest = endsClean ? '' : (split[split.length - 1]?.text ?? '');
  const fragment = document.createDocumentFragment();
  for (const paragraph of settled) fragment.append(paragraphElement(paragraph));
  return { fragment, rest };
}
