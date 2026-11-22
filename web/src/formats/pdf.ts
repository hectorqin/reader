import type { BookDoc, PdfSource, RenderMode } from './types.ts';

export async function loadPdf(
  source: Uint8Array | PdfSource = new Uint8Array(),
  signal?: AbortSignal,
): Promise<BookDoc> {
  const { openPdf } = await import('./pdf-renderer.ts');
  const { document, renderer } = await openPdf(source, signal);
  const sections = Array.from({ length: document.numPages }, (_, index) => ({
    id: pdfSectionId(index + 1),
    label: `第 ${index + 1} 页`,
    depth: 0,
  }));
  // The book's own bookmarks are its table of contents; a PDF without any lists its pages.
  const outline = await renderer.outline().catch(() => []);
  return {
    format: 'pdf',
    layout: 'fixed',
    render: pdfRenderMode(),
    direction: 'ltr',
    sections,
    toc: outline.length
      ? outline.map((entry) => ({ id: pdfSectionId(entry.page), label: entry.title, depth: entry.depth }))
      : sections.map(({ id, label, depth }) => ({ id, label, depth })),
    styles: [],
    resources: new Map(),
    orderedByBook: true,
    pdf: renderer,
  };
}

/** A page's section id (1-based page): `pdf` for the first, `pdf:N` after — the ids saved positions use. */
export function pdfSectionId(page: number): string {
  return page <= 1 ? 'pdf' : `pdf:${page}`;
}

/** The page (1-based) a PDF section id names, or null. */
export function pdfPageOf(sectionId: string): number | null {
  if (sectionId === 'pdf') return 1;
  const match = /^pdf:(\d+)$/.exec(sectionId);
  return match ? Number(match[1]) : null;
}

export function pdfRenderMode(): RenderMode {
  return 'document';
}
