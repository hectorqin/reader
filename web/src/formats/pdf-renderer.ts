import { getDocument, GlobalWorkerOptions, PDFDataRangeTransport, TextLayer } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import textLayerStyles from 'pdfjs-dist/web/pdf_viewer.css?inline';
import type { PdfRenderer, PdfSource } from './types.ts';

GlobalWorkerOptions.workerSrc = workerUrl;

export async function openPdf(source: Uint8Array | PdfSource, signal?: AbortSignal): Promise<{ document: PDFDocumentProxy; renderer: PdfRenderer }> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  let failRange: (error: unknown) => void = () => undefined;
  const rangeFailure = new Promise<never>((_resolve, reject) => { failRange = reject; });
  class RangeTransport extends PDFDataRangeTransport {
    override requestDataRange(begin: number, end: number): void {
      if (source instanceof Uint8Array) return;
      void source.readRange(begin, end, controller.signal).then(bytes => {
        if (!controller.signal.aborted) this.onDataRange(begin, bytes);
      }).catch(error => {
        if (controller.signal.aborted) return;
        failRange(error);
        abort();
      });
    }
    override abort(): void { controller.abort(); }
  }
  const assets = new URL(`${import.meta.env.BASE_URL}pdfjs/`, document.baseURI).href;
  const task = getDocument({
    ...(source instanceof Uint8Array ? { data: source.slice() } : { range: new RangeTransport(source.length, new Uint8Array(), true) }),
    rangeChunkSize: 64 * 1024,
    disableStream: true,
    disableAutoFetch: true,
    cMapUrl: `${assets}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`, enableXfa: false,
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
    if (previousTask && previousPage) void previousTask.promise.catch(() => undefined).then(() => previousPage.cleanup());
    textLayer?.cancel();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    currentPage?.cleanup();
    currentPage = undefined;
  };
  const renderer: PdfRenderer = {
    async render(pageNumber, container, fit) {
      cancel();
      const active = generation;
      const page = await pdf.getPage(pageNumber);
      if (active !== generation || controller.signal.aborted) { page.cleanup(); return; }
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
        const outputScale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16_000_000 / (viewport.width * viewport.height)));
        if (canvas) { canvas.width = 0; canvas.height = 0; }
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
      await draw().catch(error => {
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
          void draw().catch(error => {
            if (active === generation && error?.name !== 'RenderingCancelledException') container.textContent = 'PDF 页面渲染失败，请重新打开';
          });
        });
      });
      observer.observe(container);
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
