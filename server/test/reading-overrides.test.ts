import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/db/index.ts';
import { ReadingOverrideService } from '../src/services/reading-overrides.ts';
import { SyncService } from '../src/services/sync.ts';
import type { ShelfService } from '../src/services/shelf.ts';
import { parseNavigation } from '../src/indexer/formats/navigation.ts';

test('personal reading overlays persist, reject stale writes and undo without modifying another user', () => {
 const db = new Db(':memory:');
 try {
  for (const id of ['one','two']) db.run('INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?)',id,id,'x','member',1,1);
  db.run('INSERT INTO books(id,content_hash,format,created_at,updated_at) VALUES(?,?,?,?,?)','b','hash','txt',1,1);
  const service = new ReadingOverrideService(db);
  const first = service.save('one','b',{version:0,headingPrefix:'第',corrections:[]});
  const next = service.save('one','b',{...first,headingPrefix:'Chapter '});
  assert.equal(new ReadingOverrideService(db).get('one','b').version,2);
  assert.equal(next.headingPrefix,'Chapter ');
  assert.equal(service.get('two','b').version,0);
  assert.throws(()=>service.save('one','b',first),/另一设备/);
  assert.equal(service.undo('one','b',next.version).headingPrefix,'第');
  assert.throws(()=>service.save('one','b',{version:3,headingPrefix:'x',corrections:[{} as never]}),/invalid correction/);
  const sync = new SyncService(db,{} as ShelfService);
  const note = {id:'n',bookId:'b',type:'highlight' as const,locator:'rt1:anchor',text:'原文',comment:'',color:'',updatedAt:1,deleted:false};
  sync.push('one',{notes:[note]});
  sync.push('two',{notes:[{...note,text:'他人修改',updatedAt:2}]});
  assert.equal(sync.pull('one',0).notes[0]?.text,'原文');
  sync.push('one',{notes:[{...note,type:'note',comment:'批注',updatedAt:3}]});
  assert.equal(sync.pull('one',0).notes[0]?.type,'note');
 } finally { db.close(); }
});
test('server navigation keeps nested NCX sibling order and fragments', () => {
 const xml = '<ncx><navMap><navPoint><navLabel><text>一</text></navLabel><content src="a#first"/><navPoint><navLabel><text>二</text></navLabel><content src="a#second"/><navPoint><navLabel><text>三</text></navLabel><content src="a#third"/></navPoint></navPoint></navPoint><navPoint><navLabel><text>四</text></navLabel><content src="b"/></navPoint></navMap></ncx>';
 assert.deepEqual(parseNavigation(xml,'ncx').map(e => [e.href,e.depth]),[['a#first',0],['a#second',1],['a#third',2],['b',0]]);
});
