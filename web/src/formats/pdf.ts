import type { BookDoc, PdfSource, RenderMode } from './types.ts';

export async function loadPdf(source: Uint8Array | PdfSource = new Uint8Array(), signal?: AbortSignal): Promise<BookDoc> {
  const { openPdf } = await import('./pdf-renderer.ts');
  const { document, renderer } = await openPdf(source, signal);
  const sections = Array.from({ length: document.numPages }, (_, index) => ({
    id: index === 0 ? 'pdf' : `pdf:${index + 1}`,
    label: `第 ${index + 1} 页`,
    depth: 0,
  }));
  return {
    format: 'pdf', layout: 'fixed', render: pdfRenderMode(), direction: 'ltr',
    sections,
    toc: sections.map(({ id, label, depth }) => ({ id, label, depth })),
    styles: [], resources: new Map(), orderedByBook: true, pdf: renderer,
  };
}

export function pdfRenderMode(): RenderMode {
  return 'document';
}
