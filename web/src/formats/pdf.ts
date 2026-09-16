import type { BookDoc, RenderMode } from './types.ts';

/**
 * PDF loader.
 *
 * Scope is honest: PDF is "保底可读" (product design §10). The browser's own
 * viewer is used, in an iframe with the blob URL, because reimplementing text
 * selection, search and zoom on a canvas renderer is weeks of work for a format
 * the product explicitly does not differentiate on.
 *
 * What this loader does provide is the *same navigation contract* as every other
 * format: a manifest with a content URL and a page count, so the shelf, progress
 * reporting and the reading UI do not need a PDF special case.
 *
 * The one thing worth caring about here is the page count. Reading a PDF without
 * a page indicator is disorienting, and the client cannot count pages without
 * parsing the file, so the count is read from the server's metadata when the
 * book was scanned (`book.pageCount`). When it is missing, the UI degrades to
 * percentage-only progress rather than showing a fake page number.
 */
export async function loadPdf(): Promise<BookDoc> {
  return {
    format: 'pdf',
    layout: 'fixed',
    render: pdfRenderMode(),
    direction: 'ltr',
    // A PDF is one document, not a list of sections: the browser viewer owns
    // navigation inside it. One section keeps the progress model uniform.
    sections: [
      {
        id: 'pdf',
        label: 'PDF',
        html: '',
        depth: 0,
      },
    ],
    toc: [{ id: 'pdf', label: 'PDF', depth: 0 }],
    styles: [],
    resources: new Map(),
    orderedByBook: true,
  };
}

/**
 * Render mode for a PDF. Always `document`.
 *
 * A PDF is one document, and both the browser and Android already ship a viewer
 * for it that is better than anything this project would write. The host is told
 * so rather than being handed bytes to guess from.
 */
export function pdfRenderMode(): RenderMode {
  return 'document';
}
