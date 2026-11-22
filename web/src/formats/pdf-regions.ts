import type { PdfRenderer } from './types.ts';

/**
 * Draws the figures, tables and formulas of a PDF read as text (增强解析).
 *
 * The server cannot draw a page without a native canvas, so it says *where* each one
 * is — `<figure class="pdf-region" data-page data-box>` with an empty `<img>` sized to
 * its proportions — and this draws that rectangle from the PDF with PDF.js, which the
 * reader already ships. The PDF is opened on first need: from the downloaded file
 * when there is one, otherwise by byte ranges like the pages mode. Each drawing is
 * kept for the book, so turning back to a chapter or re-laying it out is instant.
 */
const PIXELS_PER_UNIT = 2.5;
const MAX_PIXELS = 2400;

export class PdfRegionPainter {
  private renderer: Promise<PdfRenderer> | null = null;
  private readonly urls = new Map<string, Promise<string>>();
  private readonly controller = new AbortController();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly open: (signal: AbortSignal) => Promise<PdfRenderer>) {}

  /** Fills every empty placeholder under `root`. Returns when all have been tried. */
  paint(root: ParentNode): Promise<void> {
    // A figure holds its image; a formula inside a sentence is an image of its own.
    const work = [
      ...[...root.querySelectorAll<HTMLElement>('figure.pdf-region')].map((figure) =>
        this.fill(figure, figure.querySelector('img')),
      ),
      ...[...root.querySelectorAll<HTMLImageElement>('img.pdf-inline')].map((img) => this.fill(img, img)),
    ];
    return Promise.all(work).then(() => undefined);
  }

  private async fill(figure: HTMLElement, img: HTMLImageElement | null): Promise<void> {
    const page = Number(figure.dataset.page);
    const box = (figure.dataset.box ?? '').split(',').map(Number) as [number, number, number, number];
    if (
      !img ||
      img.getAttribute('src') ||
      !Number.isInteger(page) ||
      box.length !== 4 ||
      box.some((v) => !Number.isFinite(v))
    )
      return;
    const key = `${page}:${box.join(',')}`;
    let url = this.urls.get(key);
    if (!url) {
      // One drawing at a time: a chapter of formulas must not open a hundred canvases at once.
      const scale = Math.min(PIXELS_PER_UNIT, MAX_PIXELS / Math.max(1, box[2] - box[0]));
      url = (this.queue = this.queue
        .catch(() => undefined)
        .then(async () => {
          const renderer = await (this.renderer ??= this.open(this.controller.signal));
          return URL.createObjectURL(await renderer.renderRegion(page, box, scale, this.controller.signal));
        })) as Promise<string>;
      this.urls.set(key, url);
      url.catch(() => this.urls.delete(key));
    }
    try {
      img.src = await url;
      figure.removeAttribute('data-state');
    } catch {
      if (this.controller.signal.aborted) return;
      figure.dataset.state = 'unavailable';
      // A figure says so under it; an inline formula keeps its text as the image's alt.
      if (figure !== img) figure.dataset.unavailable = '这里有一幅图，联网或下载整本 PDF 后显示';
    }
  }

  dispose(): void {
    this.controller.abort();
    for (const url of this.urls.values()) void url.then((value) => URL.revokeObjectURL(value)).catch(() => undefined);
    this.urls.clear();
    void this.renderer?.then((renderer) => renderer.dispose()).catch(() => undefined);
    this.renderer = null;
  }
}
