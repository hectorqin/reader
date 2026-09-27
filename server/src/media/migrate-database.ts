import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { existsSync,realpathSync } from 'node:fs';
import {ensureMediaStorageIdentity,readMediaStorageIdentity,isMediaStorageActivated,MEDIA_STORAGE_IDENTITY} from './storage-identity.ts';

const quote=(name:string)=>'"'+name.replace(/"/g,'""')+'"';
const MARKER='media_storage_migration';
interface SchemaRow {type:string;name:string;tbl_name:string;sql:string|null}
export interface MediaMigrationResult {state:'copied'|'existing';tables:number;rows:number}

/** Startup-only copy. Never removes legacy data or updates an already migrated media store. */
export function migrateMediaDatabase(sourcePath:string,targetPath:string):MediaMigrationResult {
  if(resolve(sourcePath)===resolve(targetPath))throw new Error('media migration requires a separate database');
  if(existsSync(targetPath)&&realpathSync(sourcePath)===realpathSync(targetPath))throw new Error('media migration requires a separate database');
  const source=new DatabaseSync(sourcePath,{readOnly:true});
  let target:DatabaseSync|undefined;
  try{
    const activated=isMediaStorageActivated(source);
    if(activated&&!existsSync(targetPath))throw new Error('activated media database is missing; restore the paired backup');
    target=new DatabaseSync(targetPath);
    const existing=target.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{name:string}>;
    if(existing.some(row=>row.name===MARKER)){
      const marker=target.prepare(`SELECT version,source_path,table_count,row_count FROM ${MARKER} WHERE id=1`).get() as {version:number;source_path:string;table_count:number;row_count:number}|undefined;
      if(!marker||![1,2].includes(marker.version))throw new Error('media migration marker does not match this source');
      if(marker.version===2){
        const identity=readMediaStorageIdentity(source);
        const stored=target.prepare(`SELECT source_id FROM ${MARKER} WHERE id=1`).get();
        if(!identity||stored?.source_id!==identity)throw new Error('media migration marker does not match this source');
      }else{
        // Legacy prototypes can upgrade only at the original location. Never re-copy their catalog.
        if(marker.source_path!==resolve(sourcePath))throw new Error('legacy media migration marker requires its original source path');
        const identity=ensureMediaStorageIdentity(sourcePath);
        target.exec('BEGIN IMMEDIATE');
        try{
          target.exec(`ALTER TABLE ${MARKER} ADD COLUMN source_id TEXT`);
          target.prepare(`UPDATE ${MARKER} SET version=2,source_id=? WHERE id=1`).run(identity);
          target.exec('COMMIT');
        }catch(error){target.exec('ROLLBACK');throw error;}
      }
      return {state:'existing',tables:marker.table_count,rows:marker.row_count};
    }
    if(activated)throw new Error('activated media database has no migration marker; restore the paired backup');
    if(existing.length)throw new Error('refusing to replace a nonempty media database without a migration marker');
    const identity=ensureMediaStorageIdentity(sourcePath);
    source.exec('BEGIN');
    const sourceSchema=source.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all() as unknown as SchemaRow[];
    const tables=sourceSchema.filter(row=>row.type==='table'&&row.name.startsWith('media_')&&row.name!==MARKER&&row.name!==MEDIA_STORAGE_IDENTITY);
    target.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
    try{
      target.exec('CREATE TABLE users(id TEXT PRIMARY KEY)');
      const userInsert=target.prepare('INSERT INTO users(id) VALUES(?)');
      for(const row of source.prepare('SELECT id FROM users').iterate())userInsert.run(row.id!);
      for(const table of tables){
        if(!table.sql||!/^CREATE TABLE\b/i.test(table.sql))throw new Error('unsupported media table definition');
        target.exec(table.sql);
      }
      let rows=0;
      for(const table of tables){
        const columns=source.prepare(`PRAGMA table_xinfo(${quote(table.name)})`).all() as Array<{name:string;hidden:number}>;
        const names=columns.filter(column=>column.hidden===0).map(column=>column.name);
        const sqlNames=names.map(quote).join(',');
        const insert=target.prepare(`INSERT INTO ${quote(table.name)}(${sqlNames}) VALUES(${names.map(()=>'?').join(',')})`);
        let count=0;
        for(const row of source.prepare(`SELECT ${sqlNames} FROM ${quote(table.name)}`).iterate()){
          insert.run(...names.map(name=>row[name]!));count++;
        }
        const copied=target.prepare(`SELECT count(*) n FROM ${quote(table.name)}`).get() as {n:number};
        if(copied.n!==count)throw new Error('media migration row count mismatch');
        rows+=count;
      }
      const mediaNames=new Set(tables.map(table=>table.name));
      for(const entry of sourceSchema.filter(row=>row.type==='index'&&mediaNames.has(row.tbl_name)&&row.sql))target.exec(entry.sql!);
      // Views/triggers may depend on reading tables or perform writes during migration.
      if(sourceSchema.some(row=>row.type==='trigger'&&mediaNames.has(row.tbl_name)||row.type==='view'&&row.name.startsWith('media_')))
        throw new Error('media migration requires explicit support for custom views or triggers');
      if(target.prepare('PRAGMA foreign_key_check').all().length)throw new Error('media migration foreign key validation failed');
      target.exec(`CREATE TABLE ${MARKER}(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,source_path TEXT NOT NULL,table_count INTEGER NOT NULL,row_count INTEGER NOT NULL,completed_at INTEGER NOT NULL,source_id TEXT NOT NULL)`);
      target.prepare(`INSERT INTO ${MARKER} VALUES(1,2,?,?,?,?,?)`).run(resolve(sourcePath),tables.length,rows,Date.now(),identity);
      target.exec('COMMIT; PRAGMA foreign_keys=ON');
      return {state:'copied',tables:tables.length,rows};
    }catch(error){target.exec('ROLLBACK');throw error;}
  }finally{target?.close();source.close();}
}

/** Expensive startup work; safe to run in the media worker before activation. */
export function prepareMediaDatabase(sourcePath:string,targetPath:string):MediaMigrationResult {
  const result=migrateMediaDatabase(sourcePath,targetPath);
  const media=new DatabaseSync(targetPath,{readOnly:true});
  try{
    const integrity=media.prepare('PRAGMA integrity_check').all();
    if(integrity.length!==1||integrity[0]?.integrity_check!=='ok'||media.prepare('PRAGMA foreign_key_check').get())
      throw new Error('media database validation failed before activation');
  }finally{media.close();}
  return result;
}

/** Serialize this tiny core write with reading writes on the host event loop. */
export function markMediaStorageActivated(sourcePath:string):void {
  // The target commit is durable before recording activation. A crash before this
  // write retries against the committed marker; after it, missing data is fatal.
  const identity=ensureMediaStorageIdentity(sourcePath),source=new DatabaseSync(sourcePath);
  try{
    if(isMediaStorageActivated(source))return;
    source.prepare(`UPDATE ${MEDIA_STORAGE_IDENTITY} SET activated=1 WHERE id=1 AND origin_id=?`).run(identity);
  }finally{source.close();}
}

/** Startup-only activation gate. Invoke before accepting any isolated media writes. */
export function activateMediaDatabase(sourcePath:string,targetPath:string):MediaMigrationResult {
  const result=prepareMediaDatabase(sourcePath,targetPath);
  markMediaStorageActivated(sourcePath);
  return result;
}
