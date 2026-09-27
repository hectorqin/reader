import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

export const MEDIA_STORAGE_IDENTITY='media_storage_identity';

/** Startup-only media metadata; preserved with reader.db across offline restores. */
export function ensureMediaStorageIdentity(path:string):string {
  const db=new DatabaseSync(path);
  try{
    const existing=readMediaStorageIdentity(db);
    if(existing&&db.prepare(`PRAGMA table_info(${MEDIA_STORAGE_IDENTITY})`).all().some(row=>row.name==='activated'))return existing;
    db.exec('BEGIN IMMEDIATE');
    try{
      db.exec(`CREATE TABLE IF NOT EXISTS ${MEDIA_STORAGE_IDENTITY}(id INTEGER PRIMARY KEY CHECK(id=1),origin_id TEXT NOT NULL)`);
      if(!db.prepare(`PRAGMA table_info(${MEDIA_STORAGE_IDENTITY})`).all().some(row=>row.name==='activated'))
        db.exec(`ALTER TABLE ${MEDIA_STORAGE_IDENTITY} ADD COLUMN activated INTEGER NOT NULL DEFAULT 0 CHECK(activated IN (0,1))`);
      db.prepare(`INSERT OR IGNORE INTO ${MEDIA_STORAGE_IDENTITY}(id,origin_id) VALUES(1,?)`).run(randomUUID());
      const row=db.prepare(`SELECT origin_id FROM ${MEDIA_STORAGE_IDENTITY} WHERE id=1`).get();
      if(typeof row?.origin_id!=='string'||!row.origin_id)throw new Error('invalid media storage identity');
      db.exec('COMMIT');return row.origin_id;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }finally{db.close();}
}

export function readMediaStorageIdentity(db:DatabaseSync):string|undefined {
  if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(MEDIA_STORAGE_IDENTITY))return undefined;
  const row=db.prepare(`SELECT origin_id FROM ${MEDIA_STORAGE_IDENTITY} WHERE id=1`).get();
  return typeof row?.origin_id==='string'&&row.origin_id?row.origin_id:undefined;
}

export function isMediaStorageActivated(db:DatabaseSync):boolean {
  if(!readMediaStorageIdentity(db))return false;
  if(!db.prepare(`PRAGMA table_info(${MEDIA_STORAGE_IDENTITY})`).all().some(row=>row.name==='activated'))return false;
  return db.prepare(`SELECT activated FROM ${MEDIA_STORAGE_IDENTITY} WHERE id=1`).get()?.activated===1;
}
