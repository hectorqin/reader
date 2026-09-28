import {createHash} from 'node:crypto';
import type {MediaDatabase} from './read-database.ts';
import type {MediaActor} from './libraries.ts';
import {MediaLibraries} from './libraries.ts';
import {validateMediaFolderPath} from './folders.ts';
import {badRequest,conflict,forbidden} from '../lib/errors.ts';
import {withinDirectory,type VideoRule} from './video-recognition.ts';

export class MediaDirectoryRules {
  constructor(private readonly db:MediaDatabase){
    db.run(`CREATE TABLE IF NOT EXISTS media_directory_rules(library_id TEXT NOT NULL REFERENCES media_libraries(id) ON DELETE CASCADE,path TEXT NOT NULL,rule_json TEXT NOT NULL,PRIMARY KEY(library_id,path))`);
  }
  list(libraryId:string):VideoRule[]{return this.db.all<{rule_json:string}>('SELECT rule_json FROM media_directory_rules WHERE library_id=? ORDER BY path',libraryId).map(row=>JSON.parse(row.rule_json) as VideoRule);}
  version(libraryId:string){return createHash('sha256').update(JSON.stringify(this.list(libraryId))).digest('hex');}
  get(actor:MediaActor,libraries:MediaLibraries,libraryId:string,path:string){
    this.authorize(actor,libraries,libraryId,path);
    const rules=this.list(libraryId),exact=rules.find(rule=>rule.path===path)??null;
    return {rule:exact,inherited:rules.filter(rule=>rule.path!==path&&withinDirectory(path+'/',rule.path)).sort((a,b)=>b.path.length-a.path.length)[0]??null,revision:this.version(libraryId)};
  }
  authorize(actor:MediaActor,libraries:MediaLibraries,libraryId:string,path:string){
    if(actor.role!=='admin')throw forbidden('admin role required','ADMIN_REQUIRED');
    if(libraries.get(actor,libraryId).kind!=='video')throw badRequest('目录识别规则仅用于影视库','MEDIA_RULE_KIND');
    validateMediaFolderPath(path);
  }
  assertIdle(libraryId:string){
    if(this.db.get("SELECT 1 FROM media_scan_jobs WHERE library_id=? AND state IN ('queued','running')",libraryId))throw conflict('扫描期间不能修改识别规则','SCAN_RUNNING');
    if(this.db.get("SELECT 1 FROM sqlite_master WHERE name='media_scrape_jobs'")&&this.db.get(`SELECT 1 FROM media_scrape_jobs j JOIN media_scrape_job_items r ON r.job_id=j.id JOIN media_items i ON i.id=r.item_id WHERE j.state='running' AND i.library_id=?`,libraryId))throw conflict('刮削期间不能重新识别','SCRAPE_RUNNING');
  }
  save(actor:MediaActor,libraries:MediaLibraries,libraryId:string,path:string,input:VideoRule|null,revision:string){
    this.authorize(actor,libraries,libraryId,path);this.validate(path,input);
    return this.db.transaction(()=>{
      this.assertIdle(libraryId);
      if(this.version(libraryId)!==revision)throw conflict('识别规则已变化，请重新打开','MEDIA_RULE_CHANGED');
      if(input)this.db.run('INSERT INTO media_directory_rules VALUES(?,?,?) ON CONFLICT(library_id,path) DO UPDATE SET rule_json=excluded.rule_json',libraryId,path,JSON.stringify(input));
      else this.db.run('DELETE FROM media_directory_rules WHERE library_id=? AND path=?',libraryId,path);
      return {revision:this.version(libraryId)};
    });
  }
  private validate(path:string,rule:VideoRule|null){
    if(rule===null)return;
    if(typeof rule!=='object'||rule.path!==path||!['auto','movie','series','season','ignore'].includes(rule.mode)||Object.keys(rule).some(key=>!['path','mode','title','season','year','stripLeadingNumber'].includes(key)))throw badRequest('无效目录识别规则');
    if(rule.title!==undefined&&(typeof rule.title!=='string'||!rule.title.trim()||rule.title.length>200))throw badRequest('剧名需为 1–200 字符');
    if(rule.season!==undefined&&(!Number.isInteger(rule.season)||rule.season<0||rule.season>999))throw badRequest('季号需为 0–999');
    if(rule.mode==='season'&&rule.season===undefined)throw badRequest('季目录必须指定季号');
    if(rule.year!==undefined&&(!Number.isInteger(rule.year)||rule.year<1800||rule.year>2199))throw badRequest('年份需为 1800–2199');
    if(rule.stripLeadingNumber!==undefined&&typeof rule.stripLeadingNumber!=='boolean')throw badRequest('无效编号设置');
  }
}
