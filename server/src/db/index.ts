import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { AppConfig } from '../config/index.ts';
import { SCHEMA_SQL } from './schema.ts';

/**
 * Thin wrapper over the built-in node:sqlite driver.
 *
 * We deliberately avoid better-sqlite3: it needs a native toolchain at install
 * time, which inflates the image and breaks the "one command to run it"
 * promise (§8.1). node:sqlite ships with Node itself.
 */
export type SqlValue = string | number | bigint | null | Uint8Array;
export type Row = Record<string, SqlValue>;

export class Db {
  private readonly raw: DatabaseSync;

  constructor(path: string) {
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA journal_mode = WAL;');
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec(SCHEMA_SQL);
  }

  get<T = Row>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: SqlValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  run(sql: string, ...params: SqlValue[]): void {
    this.raw.prepare(sql).run(...params);
  }

  /** Runs `fn` inside a transaction, rolling back on any throw. */
  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }

  close(): void {
    this.raw.close();
  }
}

export function openDatabase(config: AppConfig): Db {
  return new Db(join(config.dataDir, 'reader.db'));
}
