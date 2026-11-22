import type { Db } from '../db/index.ts';
import { badRequest } from '../lib/errors.ts';
import { BusinessSettingsReader } from './business-settings.ts';

/**
 * How a reader sees a PDF: `pdfjs` draws its pages; `enhanced` reads its text layer
 * as reflowable chapters (docs/pdf.md). The administrator sets the site default in
 * 服务配置 → 书库; each reader may choose differently for one book, and that choice
 * wins. Clearing it returns the book to the site default.
 */
export type PdfMode = 'pdfjs' | 'enhanced';
export const PDF_MODES: readonly PdfMode[] = ['pdfjs', 'enhanced'];

export interface BookViewMode {
  /** What this book opens as. */
  pdfMode: PdfMode;
  /** The reader's own choice for this book, or null when it follows the site default. */
  chosen: PdfMode | null;
  /** The site default. */
  defaultPdfMode: PdfMode;
}

export class BookViewModes {
  constructor(private readonly db: Pick<Db, 'get' | 'run'>) {}

  get(userId: string, bookId: string): BookViewMode {
    const fallback = new BusinessSettingsReader(this.db).read('library').pdfMode;
    const defaultPdfMode: PdfMode = PDF_MODES.includes(fallback) ? fallback : 'pdfjs';
    const row = this.db.get<{ pdf_mode: string }>(
      'SELECT pdf_mode FROM book_view_modes WHERE user_id = ? AND book_id = ?',
      userId,
      bookId,
    );
    const chosen = row && PDF_MODES.includes(row.pdf_mode as PdfMode) ? (row.pdf_mode as PdfMode) : null;
    return { pdfMode: chosen ?? defaultPdfMode, chosen, defaultPdfMode };
  }

  /** `null` clears the reader's choice. */
  set(userId: string, bookId: string, pdfMode: unknown, now = Date.now()): BookViewMode {
    if (pdfMode === null) {
      this.db.run('DELETE FROM book_view_modes WHERE user_id = ? AND book_id = ?', userId, bookId);
    } else {
      if (typeof pdfMode !== 'string' || !PDF_MODES.includes(pdfMode as PdfMode))
        throw badRequest('pdfMode must be pdfjs, enhanced or null', 'BAD_MODE');
      this.db.run(
        `INSERT INTO book_view_modes (user_id, book_id, pdf_mode, updated_at) VALUES (?,?,?,?)
         ON CONFLICT(user_id, book_id) DO UPDATE SET pdf_mode = excluded.pdf_mode, updated_at = excluded.updated_at`,
        userId,
        bookId,
        pdfMode,
        now,
      );
    }
    return this.get(userId, bookId);
  }
}
