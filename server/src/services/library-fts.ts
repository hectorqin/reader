import type { AppContext } from '../http/context.ts';
import type { AssetPayload, ContentItem, Manifest } from '../indexer/formats/index.ts';
import { FilePublications } from '../publications/files.ts';
import { BookViewModes } from './book-view-modes.ts';
import { ReadingOverrideService } from './reading-overrides.ts';
import { correctedSearchText, htmlSearchText, plainSearchText } from './book-search.ts';
import { resolveProgressSectionIndex } from './mcp.ts';
import { badRequest } from '../lib/errors.ts';

export interface LibrarySearchHit {
  bookId: string;
  bookTitle: string;
  author: string;
  sectionIndex: number;
  chapterTitle: string;
  excerpt: string;
}

export interface LibrarySearchResult {
  query: string;
  indexedBooks: number;
  newlyIndexed: number;
  hits: LibrarySearchHit[];
}

interface FtsRow {
  book_id: string;
  section_seq: number;
  section_id: string;
  title: string;
  content: string;
}

const MAX_AUTO_INDEX_BOOKS = 10;
const MAX_CHAPTERS_PER_BOOK_INDEX = 500;
const MAX_SEARCH_HITS = 50;

/**
 * Lazy SQLite FTS5 full-text index across books.
 *
 * Indexing is deliberately lazy rather than part of `Scanner`: unpacking every
 * EPUB on a NAS during a directory scan would hammer disk I/O. Books are only
 * indexed when searched or explicitly requested, and skipped whenever their
 * `content_hash` has not changed.
 */
export class LibraryFtsService {
  private readonly ftsAvailable: boolean;

  constructor(private readonly ctx: AppContext) {
    ctx.db.run(`
      CREATE TABLE IF NOT EXISTS book_fts_state (
        book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
        content_hash TEXT NOT NULL,
        chapter_count INTEGER NOT NULL DEFAULT 0,
        indexed_at INTEGER NOT NULL
      )
    `);
    let hasFts = false;
    try {
      ctx.db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS book_fts USING fts5(
          book_id UNINDEXED,
          section_seq UNINDEXED,
          section_id UNINDEXED,
          title,
          content,
          tokenize='trigram'
        )
      `);
      hasFts = true;
    } catch {
      // Fallback plain table if a custom SQLite build lacks FTS5.
      ctx.db.run(`
        CREATE TABLE IF NOT EXISTS book_fts (
          book_id TEXT NOT NULL,
          section_seq INTEGER NOT NULL,
          section_id TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL
        )
      `);
    }
    this.ftsAvailable = hasFts;
  }

  /** Indexes up to `maxBooks` unindexed or changed books on the user's shelf. */
  async ensureIndexed(
    userId: string,
    bookIds?: readonly string[],
    maxBooks = MAX_AUTO_INDEX_BOOKS,
  ): Promise<{ indexed: number; skipped: number }> {
    const candidates = bookIds?.length
      ? bookIds.slice(0, maxBooks).map((id) => this.ctx.shelf.getVisible(userId, id))
      : this.ctx.shelf.list(userId, { page: 1, pageSize: Math.min(50, maxBooks * 3) }).items;

    let indexed = 0;
    let skipped = 0;
    for (const book of candidates) {
      if (indexed >= maxBooks) break;
      if (!['epub', 'txt', 'mobi', 'azw3', 'pdf', 'chapters'].includes(book.format)) {
        skipped += 1;
        continue;
      }
      const row = this.ctx.db.get<{ content_hash: string }>('SELECT content_hash FROM books WHERE id = ?', book.id);
      if (!row) continue;
      const state = this.ctx.db.get<{ content_hash: string }>(
        'SELECT content_hash FROM book_fts_state WHERE book_id = ?',
        book.id,
      );
      if (state && state.content_hash === row.content_hash) {
        skipped += 1;
        continue;
      }
      const count = await this.indexOneBook(userId, book.id, book.format, row.content_hash);
      if (count > 0) indexed += 1;
      else skipped += 1;
    }
    return { indexed, skipped };
  }

  async search(
    userId: string,
    rawQuery: string,
    options: {
      bookIds?: readonly string[];
      limit?: number;
      autoIndex?: boolean;
      respectProgress?: boolean;
    } = {},
  ): Promise<LibrarySearchResult> {
    const query = rawQuery.trim();
    if (!query || query.length > 200) throw badRequest('关键词须为 1–200 个字符');
    const limit = Math.min(MAX_SEARCH_HITS, Math.max(1, Math.trunc(options.limit ?? 20)));

    let newlyIndexed = 0;
    if (options.autoIndex !== false) {
      const res = await this.ensureIndexed(userId, options.bookIds, MAX_AUTO_INDEX_BOOKS);
      newlyIndexed = res.indexed;
    }

    const allowedIds = this.resolveAllowedBookIds(userId, options.bookIds);
    if (allowedIds.length === 0) {
      return { query, indexedBooks: 0, newlyIndexed, hits: [] };
    }

    const placeholders = allowedIds.map(() => '?').join(',');
    const indexedBooks =
      this.ctx.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM book_fts_state WHERE book_id IN (${placeholders})`,
        ...allowedIds,
      )?.n ?? 0;

    if (indexedBooks === 0) {
      return { query, indexedBooks: 0, newlyIndexed, hits: [] };
    }

    // FTS5 trigram handles queries >= 3 chars via index; shorter CJK/word queries fall back to instr().
    const useMatch = this.ftsAvailable && query.length >= 3;
    const ftsQuery = `"${query.replace(/"/g, '""')}"`;
    const fetchLimit = options.respectProgress ? limit * 4 : limit * 2;
    const rows = useMatch
      ? this.ctx.db.all<FtsRow>(
          `SELECT book_id, section_seq, section_id, title, content
           FROM book_fts
           WHERE book_id IN (${placeholders}) AND book_fts MATCH ?
           LIMIT ?`,
          ...allowedIds,
          ftsQuery,
          fetchLimit,
        )
      : this.ctx.db.all<FtsRow>(
          `SELECT book_id, section_seq, section_id, title, content
           FROM book_fts
           WHERE book_id IN (${placeholders}) AND instr(lower(content), lower(?)) > 0
           LIMIT ?`,
          ...allowedIds,
          query,
          fetchLimit,
        );

    const bookMeta = this.ctx.shelf.getMany(
      userId,
      [...new Set(rows.map((r) => r.book_id))],
    );
    const progressCapCache = new Map<string, number | null>();

    const hits: LibrarySearchHit[] = [];
    for (const row of rows) {
      if (hits.length >= limit) break;
      const book = bookMeta.get(row.book_id);
      if (!book) continue;

      if (options.respectProgress) {
        if (!progressCapCache.has(row.book_id)) {
          progressCapCache.set(row.book_id, await this.resolveBookCap(userId, row.book_id, book.format));
        }
        const cap = progressCapCache.get(row.book_id);
        if (cap === null || cap === undefined || row.section_seq > cap) continue;
      }

      hits.push({
        bookId: row.book_id,
        bookTitle: book.title,
        author: book.author,
        sectionIndex: row.section_seq,
        chapterTitle: row.title,
        excerpt: buildExcerpt(row.content, query),
      });
    }

    return { query, indexedBooks, newlyIndexed, hits };
  }

  private resolveAllowedBookIds(userId: string, explicit?: readonly string[]): string[] {
    if (explicit?.length) {
      return explicit.filter((id) => {
        try {
          this.ctx.shelf.getVisible(userId, id);
          return true;
        } catch {
          return false;
        }
      });
    }
    return this.ctx.db
      .all<{ book_id: string }>('SELECT book_id FROM user_books WHERE user_id = ? AND hidden = 0 LIMIT 500', userId)
      .map((r) => r.book_id);
  }

  private async resolveBookCap(userId: string, bookId: string, format: string): Promise<number | null> {
    const progress = this.ctx.sync.progressFor(userId, bookId);
    if (!progress) return null;
    const manifest = await this.loadManifest(userId, bookId, format);
    if (!manifest) return null;
    return resolveProgressSectionIndex(progress.locator, progress.percentage, manifest.items);
  }

  private async indexOneBook(userId: string, bookId: string, format: string, contentHash: string): Promise<number> {
    const manifest = await this.loadManifest(userId, bookId, format);
    if (!manifest || !['text', 'reflowable'].includes(manifest.kind)) return 0;

    const overrides = new ReadingOverrideService(this.ctx.db).get(userId, bookId);
    const items = manifest.items.slice(0, MAX_CHAPTERS_PER_BOOK_INDEX);
    const extracted: Array<{ seq: number; href: string; title: string; text: string }> = [];

    for (let seq = 0; seq < items.length; seq += 1) {
      const item = items[seq]!;
      const text = await this.tryLoadSectionText(bookId, format, item, overrides);
      if (!text || !text.trim()) continue;
      extracted.push({ seq, href: item.href, title: item.title, text });
    }

    this.ctx.db.transaction(() => {
      this.ctx.db.run('DELETE FROM book_fts WHERE book_id = ?', bookId);
      const stmt = this.ctx.db.prepare(
        'INSERT INTO book_fts(book_id, section_seq, section_id, title, content) VALUES(?, ?, ?, ?, ?)',
      );
      for (const entry of extracted) {
        stmt.run(bookId, entry.seq, entry.href, entry.title, entry.text);
      }
      this.ctx.db.run(
        `INSERT INTO book_fts_state(book_id, content_hash, chapter_count, indexed_at)
         VALUES(?, ?, ?, ?)
         ON CONFLICT(book_id) DO UPDATE SET
           content_hash = excluded.content_hash,
           chapter_count = excluded.chapter_count,
           indexed_at = excluded.indexed_at`,
        bookId,
        contentHash,
        extracted.length,
        Date.now(),
      );
    });
    return extracted.length;
  }

  private async loadManifest(userId: string, bookId: string, format: string): Promise<Manifest | null> {
    if (this.ctx.sources?.chapters.has(bookId)) {
      return this.ctx.sources.chapters.manifest(userId, bookId);
    }
    const files = new FilePublications(this.ctx.db, this.ctx.config);
    const handler = files.handler(format);
    if (!handler) return null;
    const base = { ...files.context(bookId), bookId };
    const context =
      format === 'pdf' ? { ...base, variant: new BookViewModes(this.ctx.db).get(userId, bookId).pdfMode } : base;
    return handler.manifest(context);
  }

  private async tryLoadSectionText(
    bookId: string,
    format: string,
    item: ContentItem,
    overrides: ReturnType<ReadingOverrideService['get']>,
  ): Promise<string | null> {
    const isChapters = this.ctx.sources?.chapters.has(bookId) ?? false;
    let payload: AssetPayload | undefined;
    try {
      if (isChapters) {
        const ref = item.resourceRef ?? '';
        const match = /^chapter-resource:([^:]+):([^:]+)$/.exec(ref);
        if (!match) return null;
        const row = this.ctx.db.get<{ media_type: string; body: string | null }>(
          'SELECT media_type, body FROM chapter_resources WHERE book_id = ? AND revision = ? AND chapter_id = ?',
          bookId,
          match[1]!,
          match[2]!,
        );
        if (!row || row.body === null) return null;
        payload = { data: Buffer.from(row.body, 'utf8'), contentType: row.media_type || 'text/plain; charset=utf-8' };
      } else {
        const files = new FilePublications(this.ctx.db, this.ctx.config);
        const handler = files.handler(format);
        if (!handler) return null;
        const ref =
          item.resourceRef ??
          (item.format === 'html' && item.href.startsWith('chapter:')
            ? item.href.replace('chapter:', 'chapter-full:')
            : item.href);
        payload = await handler.asset({ ...files.context(bookId), bookId }, { ref });
      }
      if (!payload.data || payload.data.length > 8 * 1024 * 1024) return null;
      const raw = payload.data.toString('utf8');
      return correctedSearchText(
        /html|xml/i.test(payload.contentType) ? htmlSearchText(raw) : plainSearchText(raw),
        item.href,
        overrides,
      );
    } catch {
      return null;
    } finally {
      payload?.stream?.destroy();
    }
  }
}

function buildExcerpt(content: string, query: string): string {
  const lower = content.toLowerCase();
  const at = lower.indexOf(query.toLowerCase());
  if (at < 0) return content.slice(0, 160).replace(/\s+/g, ' ').trim();
  const start = Math.max(0, at - 60);
  const end = Math.min(content.length, at + query.length + 100);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < content.length ? '…' : '';
  return `${prefix}${content.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}
