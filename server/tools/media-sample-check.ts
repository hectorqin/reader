// Scan acceptance files into an in-memory catalog, never the user's database.
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {Db} from '../src/db/index.ts';
import {MediaLibraries} from '../src/media/libraries.ts';
import {MediaScanner} from '../src/media/scanner.ts';
if(!process.argv[2])throw Error('Provide the acceptance pack directory');
const root=resolve(process.argv[2]),db=new Db(':memory:'),libraries=new MediaLibraries(db),scanner=new MediaScanner(db,libraries);
const actor={id:'sample-verifier',role:'admin'} as const,report:{directory:string;counts:unknown;assets:number}[]=[];
try {
 for(const [folder,kind,expected] of [
  ['video','video',{movie:6,series:1,season:2,episode:4}],
  ['music','music',{artist:6,album:6,track:12}],
  ['audiobooks','audiobook',{audiobook:3}],
 ] as const){
  const lib=await libraries.create(actor,{name:'Acceptance '+folder,kind,root:join(root,folder),access:'all'});
  const job=scanner.start(actor,lib.id);await scanner.wait(lib.id);
  assert.equal(scanner.job(actor,job.id).state,'complete');
  const counts=Object.fromEntries(db.all<{kind:string;count:number}>('SELECT kind,count(*) count FROM media_items WHERE library_id=? GROUP BY kind',lib.id).map(row=>[row.kind,row.count]));
  assert.deepEqual(counts,expected);
  assert.equal(db.get<{count:number}>("SELECT count(*) count FROM media_assets WHERE library_id=? AND probe_status!='ready'",lib.id)?.count,0);
  assert.equal(db.get<{count:number}>("SELECT count(*) count FROM media_items WHERE library_id=? AND kind!='artist' AND json_extract(metadata_json,'$.coverRef') IS NULL",lib.id)?.count,0);
  if(kind==='audiobook'){
   assert.equal(db.get<{count:number}>('SELECT count(*) count FROM media_parts p JOIN media_assets a ON a.id=p.asset_id WHERE a.library_id=? AND p.active=1',lib.id)?.count,12);
   assert.equal(db.get<{count:number}>('SELECT count(*) count FROM media_editions e JOIN media_items i ON i.id=e.item_id WHERE i.library_id=?',lib.id)?.count,4);
  }
  report.push({directory:folder,counts,assets:db.get<{count:number}>('SELECT count(*) count FROM media_assets WHERE library_id=?',lib.id)!.count});
 }
 const result={passed:true,checkedAt:new Date().toISOString(),database:'in-memory only',libraries:report};
 await writeFile(join(root,'scan-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await scanner.close();db.close();}
