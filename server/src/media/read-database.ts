import { DatabaseSync } from 'node:sqlite';
import type { Db, Row, SqlValue } from '../db/index.ts';

export type MediaDatabase = Pick<Db, 'get' | 'all' | 'run' | 'transaction'>;

/** Opens an already initialized catalog without migrations or write access. */
export class MediaReadDatabase implements MediaDatabase {
  private readonly raw: DatabaseSync;

  constructor(path: string) {
    this.raw = new DatabaseSync(path, { readOnly: true });
    this.raw.exec('PRAGMA query_only = ON');
    this.raw.exec('PRAGMA busy_timeout = 2000');
  }

  get<T = Row>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  prepare(sql:string){return this.raw.prepare(sql);}

  all<T = Row>(sql: string, ...params: SqlValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  run(): never { throw new Error('media catalog connection is read-only'); }

  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void { this.raw.close(); }
}
