import type { Db, Row, SqlValue } from '../db/index.ts';
import type { MediaDatabase } from './read-database.ts';

/** Scanner-only statement reuse on the existing connection and transaction. */
export class MediaStatementDatabase implements MediaDatabase {
  private readonly statements = new Map<string, ReturnType<Db['prepare']>>();
  constructor(private readonly db: Pick<Db, 'prepare' | 'transaction'>) {}

  private statement(sql: string): ReturnType<Db['prepare']> {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      if (this.statements.size >= 128) this.statements.delete(this.statements.keys().next().value!);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  get<T = Row>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.statement(sql).get(...params) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: SqlValue[]): T[] {
    return this.statement(sql).all(...params) as T[];
  }

  run(sql: string, ...params: SqlValue[]): void { this.statement(sql).run(...params); }
  transaction<T>(fn: () => T): T { return this.db.transaction(fn); }
  clear(): void { this.statements.clear(); }
}
