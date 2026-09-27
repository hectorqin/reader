import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import type {Row,SqlValue} from '../db/index.ts';
import type {MediaDatabase} from './read-database.ts';

/** Existing migrated media storage only. Never creates reading tables or runs reading migrations. */
export class MediaStoreDatabase implements MediaDatabase {
  private readonly raw:DatabaseSync;
  constructor(path:string){
    if(!existsSync(path))throw new Error('media database must be migrated before opening');
    this.raw=new DatabaseSync(path);
    try{
      const marker=this.raw.prepare('SELECT version FROM media_storage_migration WHERE id=1').get();
      if(marker?.version!==1&&marker?.version!==2)throw new Error('unsupported media database version');
      this.raw.exec('PRAGMA foreign_keys=ON');
    }catch(error){this.raw.close();throw error;}
  }
  prepare(sql:string){return this.raw.prepare(sql);}
  get<T=Row>(sql:string,...params:SqlValue[]):T|undefined{return this.prepare(sql).get(...params) as T|undefined;}
  all<T=Row>(sql:string,...params:SqlValue[]):T[]{return this.prepare(sql).all(...params) as T[];}
  run(sql:string,...params:SqlValue[]):void{this.prepare(sql).run(...params);}
  transaction<T>(fn:()=>T):T{
    this.raw.exec('BEGIN');
    try{const result=fn();this.raw.exec('COMMIT');return result;}
    catch(error){this.raw.exec('ROLLBACK');throw error;}
  }
  close():void{this.raw.close();}
}
