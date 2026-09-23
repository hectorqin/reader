import type { Db } from '../db/index.ts';
import { badRequest, conflict } from '../lib/errors.ts';

export interface ReadingOverrides { version: number; corrections: Array<{ id: string; anchor: { sectionId: string; start: number; end: number; quote: string; prefix: string; suffix: string }; replacement: string }>; headingPrefix: string }
const empty = (): ReadingOverrides => ({ version: 0, corrections: [], headingPrefix: '' });
/** Personal, versioned overlays live beside progress in DATA_DIR; source files are never changed. */
export class ReadingOverrideService {
  constructor(private readonly db: Db) {}
  get(userId: string, bookId: string): ReadingOverrides {
    const row = this.db.get<{ payload: string; version: number }>('SELECT payload,version FROM reading_overrides WHERE user_id=? AND book_id=? ORDER BY version DESC LIMIT 1',userId,bookId);
    return row ? { ...JSON.parse(row.payload) as ReadingOverrides, version: row.version } : empty();
  }
  save(userId: string, bookId: string, input: ReadingOverrides): ReadingOverrides {
    if (!input || !Number.isSafeInteger(input.version) || typeof input.headingPrefix !== 'string' || input.headingPrefix.length > 60 || /[\r\n]/.test(input.headingPrefix) || !Array.isArray(input.corrections) || input.corrections.length > 500) throw badRequest('invalid reading overrides');
    const ids = new Set<string>();
    for (const correction of input.corrections) {
      const a = correction?.anchor;
      if (!correction || typeof correction.id !== 'string' || !correction.id || correction.id.length > 100 || ids.has(correction.id) || typeof correction.replacement !== 'string' || correction.replacement.length > 4000 || !a || typeof a.sectionId !== 'string' || a.sectionId.length > 4096 || typeof a.quote !== 'string' || !a.quote || a.quote.length > 4000 || typeof a.prefix !== 'string' || a.prefix.length > 32 || typeof a.suffix !== 'string' || a.suffix.length > 32 || !Number.isSafeInteger(a.start) || a.start < 0 || !Number.isSafeInteger(a.end) || a.end <= a.start || a.end - a.start !== a.quote.length) throw badRequest('invalid correction');
      ids.add(correction.id);
    }
    return this.db.transaction(() => {
      const previous = this.get(userId,bookId);
      if (input.version !== previous.version) throw conflict('整理规则已被另一设备修改，请重新打开后重试');
      const next = { version: previous.version + 1, headingPrefix: input.headingPrefix, corrections: input.corrections };
      this.db.run('INSERT INTO reading_overrides(user_id,book_id,version,payload) VALUES(?,?,?,?)',userId,bookId,next.version,JSON.stringify(next));
      return next;
    });
  }
  undo(userId: string, bookId: string, version: number): ReadingOverrides {
    const row = this.db.get<{ payload: string }>('SELECT payload FROM reading_overrides WHERE user_id=? AND book_id=? AND version<? ORDER BY version DESC LIMIT 1',userId,bookId,version);
    return this.save(userId,bookId,{ ...(row ? JSON.parse(row.payload) as ReadingOverrides : empty()),version });
  }
}
