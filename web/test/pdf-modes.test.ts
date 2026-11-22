import { describe, expect, it } from 'vitest';
import { pdfPageOf, pdfSectionId } from '../src/formats/pdf.ts';
import { downloadsByChapter } from '../src/core/offline-download.ts';
import type { Manifest } from '../src/api/types.ts';

describe('PDF modes', () => {
  it('names a page by the section ids saved positions already use', () => {
    expect([1, 2, 30].map(pdfSectionId)).toEqual(['pdf', 'pdf:2', 'pdf:30']);
    expect(['pdf', 'pdf:2', 'pdf:30', 'xhtml:pdf/part0001.xhtml', 'pdf:x'].map(pdfPageOf)).toEqual([
      1,
      2,
      30,
      null,
      null,
    ]);
  });

  it('downloads a PDF by chapter when it is read as text, and as one file when it is read as pages', () => {
    const manifest = (format: string, kind?: string) =>
      ({ book: { format }, content: kind ? { kind } : null }) as unknown as Manifest;
    expect(downloadsByChapter(manifest('pdf', 'reflowable'))).toBe(true);
    expect(downloadsByChapter(manifest('pdf', 'document'))).toBe(false);
    expect(downloadsByChapter(manifest('txt', 'text'))).toBe(true);
    expect(downloadsByChapter(manifest('epub', 'reflowable'))).toBe(false);
  });
});
