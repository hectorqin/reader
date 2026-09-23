import type { Db } from '../db/index.ts';

export type AccessState = 'unknown' | 'reachable' | 'auth-required' | 'verification-required';

/** Last observed access, never a claim that a website session is still logged in. */
export class SourceAccess {
  constructor(private readonly db: Db) {}

  version(sourceId: string, userId: string): number {
    return this.db.get<{ generation: number }>(
      'SELECT generation FROM source_access WHERE source_id=? AND user_id=?', sourceId, userId,
    )?.generation ?? 0;
  }

  reset(sourceId: string, userId?: string): void {
    if (userId === undefined) {
      this.db.run("UPDATE source_access SET generation=generation+1,state='unknown',checked_at=NULL WHERE source_id=?", sourceId);
      return;
    }
    this.db.run(
      `INSERT INTO source_access(source_id,user_id,generation,state) VALUES(?,?,1,'unknown')
       ON CONFLICT(source_id,user_id) DO UPDATE SET generation=generation+1,state='unknown',checked_at=NULL`,
      sourceId, userId,
    );
  }

  record(sourceId: string, userId: string, generation: number, state: AccessState): void {
    if (this.version(sourceId, userId) !== generation) return;
    this.db.run(
      `INSERT INTO source_access(source_id,user_id,generation,state,checked_at) VALUES(?,?,?,?,?)
       ON CONFLICT(source_id,user_id) DO UPDATE SET state=excluded.state,checked_at=excluded.checked_at
       WHERE source_access.generation=excluded.generation`,
      sourceId, userId, generation, state, Date.now(),
    );
  }

  get(sourceId: string, userId: string) {
    const row = this.db.get<{ state: AccessState; checked_at: number | null }>(
      'SELECT state,checked_at FROM source_access WHERE source_id=? AND user_id=?', sourceId, userId,
    );
    return { state: row?.state ?? 'unknown', checkedAt: row?.checked_at ?? null };
  }
}
