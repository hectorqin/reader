/** Synthetic indexed paths; no real media scanning or file access. */
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {Db} from '../src/db/index.ts';
import {MediaLibraries} from '../src/media/libraries.ts';
import {MediaScanner} from '../src/media/scanner.ts';
import {MediaFolders} from '../src/media/folders.ts';
const root=await mkdtemp(join(tmpdir(),'media-folders-benchmark-')),db=new Db(join(root,'catalog.db'));
const libraries=new MediaLibraries(db),scanner=new MediaScanner(db,libraries);
try{
  db.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES('lib','large','music',?,'all',0,0)",root);
  db.run(`WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n<99999)
    INSERT INTO media_assets(id,library_id,ref,size,modified_at,available,probe_status)
    SELECT cast(n AS TEXT),'lib',printf('🎧目录%03d/track-%06d.mp3',n/1000,n),1024,0,CASE WHEN n%10=0 THEN 0 ELSE 1 END,'ready' FROM seq`);
  const folders=new MediaFolders(db,libraries,scanner.catalog),actor={id:'member',role:'member'} as const;
  const measurements=[];
  for(const path of ['','🎧目录050']){
    const times=[];
    for(let i=0;i<6;i++){
      const start=performance.now(),result=folders.list(actor,'lib',path);times.push(performance.now()-start);
      assert.equal(result.total,path?1000:100);assert.equal(result.items.length,60);
      if(path)assert.ok(result.items.every(item=>item.path.startsWith(path+'/')));
      else assert.ok(result.items.every(item=>item.files===1000&&item.availableFiles===900&&item.size===1024000));
    }
    const sorted=times.slice(1).sort((a,b)=>a-b);
    measurements.push({path:path||'root',firstMs:Math.round(times[0]!),medianMs:Math.round(sorted[2]!),maxMs:Math.round(sorted[4]!)});
  }
  console.log(JSON.stringify({assets:100000,folders:100,samples:6,node:process.version,platform:process.platform,database:'temporary file, warm OS cache',measurements}));
}finally{await scanner.close();db.close();await rm(root,{recursive:true,force:true});}
