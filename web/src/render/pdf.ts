/**
 * The PDF surface.
 *
 * PDF is explicitly a "保底可读" format in this product, and this module keeps
 * that promise literal: the server sends the original bytes and the client hands
 * them to a PDF surface it does not own.
 *
 * ## Why an iframe here, when the reflowable reader refused one
 *
 * The container module explains the reasoning at length; the short version is
 * that the trade flips for PDF. A reflowable chapter needs to be measured,
 * paginated and selected *by this client*, and a frame would force a second
 * paginator inside it. A PDF needs none of that: the browser's own viewer already
 * handles page layout, zoom, text selection, search and print, and it expects to
 * own a browsing context to do it. Fighting that to keep a single container type
 * would mean reimplementing a PDF viewer, which is a project of its own.
 *
 * On Android the same logic points at the platform viewer, which is why the shell
 * routes `document`-kind books away from the WebView entirely.
 *
 * ## Why not PDF.js
 *
 * It would bundle about a megabyte of JavaScript plus a worker into both the H5
 * and the Android assets to do worse than the browser's built-in viewer on the
 * device it is running on, and worse than the platform viewer on Android. The
 * server also refuses to parse the page tree, so a PDF.js-based client would
 * still have to discover the page count itself. There is no version of this that
 * is better than "give the bytes to a viewer".
 *
 * ## What the client does contribute
 *
 * Progress. The viewer is opaque, so the position has to come from somewhere the
 * client can observe: the URL fragment (`#page=N`), which is the one interface
 * every PDF viewer agrees on. Writing it is how "continue reading" works for a
 * PDF at all; reading it back is not possible without the viewer's cooperation,
 * so a PDF's progress is coarse — page-level, from the client's own tracking of
 * where it sent the viewer — and that limitation is stated rather than papered
 * over with a guess.
 */

import { ApiClient, type BookDto } from '../net/api.ts';
import { Emitter } from '../lib/events.ts';
import { parseLocator, serializeLocator } from '../lib/locator.ts';

export interface PdfState {
  book: BookDto;
  /** Page the viewer was last sent to, when the client knows it. */
  page: number;
  /** The URL the viewer is showing, for diagnostics. */
  url: string;
}

export interface PdfOptions {
  device?: string;
}

export class PdfReader {
  readonly state = new Emitter<PdfState>();
  private frame: HTMLIFrameElement | null = null;
  private page = 1;

  constructor(
    private readonly host: HTMLElement,
    private readonly api: ApiClient,
    private readonly book: BookDto,
    private readonly options: PdfOptions = {},
  ) {}

  /**
   * Open the document.
   *
   * The URL carries the auth token in a query parameter rather than a header,
   * because an iframe cannot set headers. The server accepts `?access_token=` on
   * asset and content routes for exactly this reason. It is the one place a
   * token travels in a URL, and it is deliberate: the alternative is proxying the
   * whole document through `fetch` and a Blob URL, which defeats the viewer's own
   * range requests and makes a 100MB manual load entirely before the first page
   * appears.
   */
  async open(bookId: string): Promise<PdfState> {
    const saved = parseLocator(
      (await this.api.progress(bookId).catch(() => ({ progress: null }))).progress?.locator ?? '',
    );
    if (saved?.block) this.page = Math.max(1, saved.block);

    const frame = document.createElement('iframe');
    frame.className = 'reader-pdf';
    // `allow-scripts` is not granted: the document is the user's own file, but
    // there is no feature the viewer needs that requires it, and withholding it
    // costs nothing.
    frame.setAttribute('sandbox', 'allow-same-origin allow-popups allow-forms');
    frame.title = this.book.title;
    this.frame = frame;
    this.host.replaceChildren(frame);
    this.setPage(bookId, this.page);
    return { book: this.book, page: this.page, url: frame.src };
  }

  /** Send the viewer to a page. The fragment is the only portable interface. */
  setPage(bookId: string, page: number): void {
    this.page = Math.max(1, Math.floor(page));
    if (this.frame) this.frame.src = this.url(bookId, this.page);
    this.state.emit({ book: this.book, page: this.page, url: this.frame?.src ?? '' });
    void this.saveProgress(bookId);
  }

  /** PDF readers are opaque; the client can only report where it sent them. */
  async flush(bookId: string): Promise<void> {
    await this.saveProgress(bookId);
  }

  destroy(): void {
    this.host.replaceChildren();
    this.frame = null;
    this.state.clear();
  }

  private url(bookId: string, page: number): string {
    const token = this.api.currentSession?.accessToken ?? '';
    const base = this.api.url(`/api/v1/books/${encodeURIComponent(bookId)}/assets?ref=document`);
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}access_token=${encodeURIComponent(token)}#page=${page}`;
  }

  private async saveProgress(bookId: string): Promise<void> {
    // Page count is unknown to the server by design, so a percentage would be a
    // guess. `block` carries the page number and `percent` stays 0 rather than
    // inventing a denominator.
    const locator = {
      chapter: 'document',
      spine: 0,
      block: this.page,
      ratio: 0,
      percent: 0,
    };
    await this.api
      .putProgress(bookId, {
        locator: serializeLocator(locator),
        percentage: 0,
        chapterTitle: `第 ${this.page} 页`,
        device: this.options.device ?? 'web',
        updatedAt: Date.now(),
      })
      .catch(() => undefined);
  }
}
