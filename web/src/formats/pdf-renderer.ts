import { getDocument, GlobalWorkerOptions, PDFDataRangeTransport, TextLayer } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import textLayerStyles from 'pdfjs-dist/web/pdf_viewer.css?inline';
import type { PdfRenderer, PdfSource } from './types.ts';

GlobalWorkerOptions.workerSrc = workerUrl;

export async function openPdf(
  source: Uint8Array | PdfSource,
  signal?: AbortSignal,
): Promise<{ document: PDFDocumentProxy; renderer: PdfRenderer }> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  let failRange: (error: unknown) => void = () => undefined;
  const rangeFailure = new Promise<never>((_resolve, reject) => {
    failRange = reject;
  });
  class RangeTransport extends PDFDataRangeTransport {
    override requestDataRange(begin: number, end: number): void {
      if (source instanceof Uint8Array) return;
      void source
        .readRange(begin, end, controller.signal)
        .then((bytes) => {
          if (!controller.signal.aborted) this.onDataRange(begin, bytes);
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          failRange(error);
          abort();
        });
    }
    override abort(): void {
      controller.abort();
    }
  }
  const assets = new URL(`${import.meta.env.BASE_URL}pdfjs/`, document.baseURI).href;
  const task = getDocument({
    ...(source instanceof Uint8Array
      ? { data: source.slice() }
      : { range: new RangeTransport(source.length, new Uint8Array(), true) }),
    rangeChunkSize: 64 * 1024,
    disableStream: true,
    disableAutoFetch: true,
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
    enableXfa: false,
  });
  const abort = () => {
    if (controller.signal.aborted) return;
    failRange(signal?.reason ?? new DOMException('PDF loading cancelled', 'AbortError'));
    controller.abort();
    void task.destroy().catch(() => undefined);
  };
  signal?.addEventListener('abort', abort, { once: true });
  let pdf: PDFDocumentProxy;
  try {
    pdf = await Promise.race([task.promise, rangeFailure]);
    signal?.throwIfAborted();
  } catch (error) {
    signal?.removeEventListener('abort', abort);
    abort();
    throw error;
  }
  let generation = 0;
  let drawing = 0;
  let frame: number | undefined;
  let observer: ResizeObserver | undefined;
  let renderTask: RenderTask | undefined;
  let textLayer: TextLayer | undefined;
  let currentPage: PDFPageProxy | undefined;
  let canvas: HTMLCanvasElement | undefined;
  const cancel = () => {
    generation += 1;
    drawing += 1;
    observer?.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
    const previousTask = renderTask;
    const previousPage = currentPage;
    previousTask?.cancel();
    if (previousTask && previousPage)
      void previousTask.promise.catch(() => undefined).then(() => previousPage.cleanup());
    textLayer?.cancel();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    currentPage?.cleanup();
    currentPage = undefined;
  };
  const renderer: PdfRenderer = {
    async render(pageNumber, container, fit) {
      cancel();
      const active = generation;
      const page = await pdf.getPage(pageNumber);
      if (active !== generation || controller.signal.aborted) {
        page.cleanup();
        return;
      }
      currentPage = page;
      container.classList.add('pdf-page');
      const style = document.createElement('style');
      style.textContent = textLayerStyles;
      const surface = document.createElement('div');
      surface.className = 'pdf-surface';
      container.replaceChildren(style, surface);
      const draw = async () => {
        const drawId = ++drawing;
        const previous = renderTask;
        previous?.cancel();
        textLayer?.cancel();
        await previous?.promise.catch(() => undefined);
        if (active !== generation || drawId !== drawing) return;
        const base = page.getViewport({ scale: 1 });
        const width = Math.max(1, container.clientWidth);
        const height = Math.max(1, container.clientHeight);
        const scale = fit === 'width' ? width / base.width : Math.min(width / base.width, height / base.height);
        const viewport = page.getViewport({ scale });
        const outputScale = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        );
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
        canvas = document.createElement('canvas');
        canvas.setAttribute('aria-label', `第 ${pageNumber} 页`);
        canvas.width = Math.ceil(viewport.width * outputScale);
        canvas.height = Math.ceil(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        surface.style.width = `${viewport.width}px`;
        surface.style.height = `${viewport.height}px`;
        surface.style.setProperty('--total-scale-factor', String(scale));
        const text = document.createElement('div');
        text.className = 'textLayer';
        surface.replaceChildren(canvas, text);
        renderTask = page.render({ canvas, viewport, transform: [outputScale, 0, 0, outputScale, 0, 0] });
        await renderTask.promise;
        if (active !== generation || drawId !== drawing) return;
        textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport });
        await textLayer.render();
      };
      await draw().catch((error) => {
        if (active === generation && error?.name !== 'RenderingCancelledException') throw error;
      });
      if (active !== generation) return;
      let lastSize = `${container.clientWidth}:${container.clientHeight}`;
      observer = new ResizeObserver(() => {
        const nextSize = `${container.clientWidth}:${container.clientHeight}`;
        if (lastSize === nextSize) return;
        lastSize = nextSize;
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          void draw().catch((error) => {
            if (active === generation && error?.name !== 'RenderingCancelledException')
              container.textContent = 'PDF 页面渲染失败，请重新打开';
          });
        });
      });
      observer.observe(container);
    },
    async pageText(pageNumber, pageSignal) {
      pageSignal?.throwIfAborted();
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        pageSignal?.throwIfAborted();
        // A line break where the text layer has one, so a phrase is not found across two lines' ends.
        return content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join('');
      } finally {
        if (page !== currentPage) page.cleanup();
      }
    },
    async renderRegion(pageNumber, box, scale, regionSignal) {
      regionSignal?.throwIfAborted();
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      // The rectangle in the viewport's pixels (it handles the page's rotation and offset).
      const [ax, ay] = viewport.convertToViewportPoint(box[0], box[1]) as [number, number];
      const [bx, by] = viewport.convertToViewportPoint(box[2], box[3]) as [number, number];
      const left = Math.min(ax, bx),
        top = Math.min(ay, by);
      const width = Math.max(1, Math.ceil(Math.abs(bx - ax))),
        height = Math.max(1, Math.ceil(Math.abs(by - ay)));
      const area = document.createElement('canvas');
      area.width = width;
      area.height = height;
      const task = page.render({ canvas: area, viewport, transform: [1, 0, 0, 1, -left, -top] });
      const stop = () => task.cancel();
      regionSignal?.addEventListener('abort', stop, { once: true });
      try {
        await task.promise;
      } finally {
        regionSignal?.removeEventListener('abort', stop);
        if (page !== currentPage) page.cleanup();
      }
      const blob = await new Promise<Blob | null>((resolve) => area.toBlob(resolve, 'image/png'));
      area.width = area.height = 0;
      if (!blob) throw new Error('无法生成图片');
      return blob;
    },
    async outline() {
      const entries: Array<{ title: string; page: number; depth: number }> = [];
      type Item = { title: string; dest: unknown; items: Item[] };
      const walk = async (items: Item[] | null, depth: number): Promise<void> => {
        for (const item of items ?? []) {
          try {
            const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
            const target = Array.isArray(dest) ? dest[0] : null;
            const index =
              typeof target === 'number'
                ? target
                : target
                  ? await pdf.getPageIndex(target as Parameters<PDFDocumentProxy['getPageIndex']>[0])
                  : -1;
            if (index >= 0 && item.title?.trim()) entries.push({ title: item.title.trim(), page: index + 1, depth });
          } catch {
            /* a bookmark that points nowhere is left out */
          }
          await walk(item.items, depth + 1);
        }
      };
      await walk((await pdf.getOutline().catch(() => null)) as Item[] | null, 0);
      return entries;
    },
    cancel,
    dispose() {
      cancel();
      signal?.removeEventListener('abort', abort);
      abort();
    },
  };
  return { document: pdf, renderer };
}
