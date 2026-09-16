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
 * Deliberate omission: this reader does not re-typeset the text. No paragraph
 * inference, no smart quotes, no reflow. A TXT file with hard-wrapped lines is
 * rendered exactly as it is stored, because guessing at paragraph boundaries
 * mangles as many books as it fixes — and 「精品排版」 is a promise made for
 * EPUB, not for a file that has no typesetting to preserve.
 */

import { ApiClient, type BookDto } from '../net/api.ts';
import { Emitter } from '../lib/events.ts';

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
  private lastLength = 0;
  private loading = false;
  private finished = false;
  private readonly scroll: HTMLElement;

  constructor(
    private readonly host: HTMLElement,
    private readonly api: ApiClient,
    private readonly book: BookDto,
    private readonly options: TextOptions = {},
  ) {
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
  async open(bookId: string): Promise<void> {
    await this.append();
    this.scroll.addEventListener('scroll', () => this.maybeAppend());
  }

  /** Load the next chapter, when the book has a table of contents. */
  async goToChapter(index: number, bookId: string): Promise<void> {
    const blob = await this.api.asset(bookId, `chapter:${index}`);
    this.scroll.replaceChildren(paragraphs(await blob.text()));
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
      this.scroll.append(paragraphs(text));
      // A short reply means the end was reached; asking again would return empty
      // forever and keep a spinner on screen.
      if (text.length < CHUNK_CHARS) this.finished = true;
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
 * Split text into paragraphs for rendering.
 *
 * `<br>` between lines rather than one element per paragraph: a TXT file's blank
 * lines are the only paragraph signal it has, and treating a blank line as a
 * break while rendering single newlines as hard breaks is the most faithful
 * reading of a format that has no markup. Collapsing them would reflow a book
 * whose author wrapped at 80 columns, which is most of them.
 */
function paragraphs(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const lines = text.split(/\r\n|\r|\n/);
  let buffer: string[] = [];

  const flush = (): void => {
    if (buffer.length === 0) return;
    const block = document.createElement('p');
    // Text content, never innerHTML: a TXT file is user data and a `&` or a `<`
    // in a novel must not be able to produce markup.
    block.textContent = buffer.join('\n');
    block.style.whiteSpace = 'pre-wrap';
    fragment.append(block);
    buffer = [];
  };

  for (const line of lines) {
    if (line.trim() === '') flush();
    else buffer.push(line);
  }
  flush();
  return fragment;
}
