import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { Db } from '../src/db/index.ts';
import { MediaLibraries } from '../src/media/libraries.ts';
import { MediaScanner } from '../src/media/scanner.ts';
import { MediaFolders } from '../src/media/folders.ts';
import { MediaUserState } from '../src/media/user-state.ts';
import { MediaPlayback } from '../src/media/playback.ts';
import { MediaReadDatabase } from '../src/media/read-database.ts';
import { MediaCatalogReader } from '../src/media/catalog-reader.ts';
import { registerMediaRoutes } from '../src/http/routes/media.ts';
import { registerErrorHandler } from '../src/http/errors.ts';
import { loadConfig } from '../src/config/index.ts';
import { UserService } from '../src/services/users.ts';
import { signAccessToken } from '../src/services/tokens.ts';
import type { AppContext } from '../src/http/context.ts';
import type { CatalogQuery } from '../src/media/catalog-query.ts';

const member = { id: 'member', role: 'member' as const };
const query: CatalogQuery = { method: 'browse', args: [member, 'music', 'track', { limit: 1 }] };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'media-reader-'));
  const path = join(root, 'state.db');
  const db = new Db(path);
  const libraries = new MediaLibraries(db);
  const scanner = new MediaScanner(db, libraries), catalog = scanner.catalog;
  db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('member','member','unused','member',0,0)");
  for (const [id, access] of [['visible', 'all'], ['private', 'restricted']]) {
    db.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES(?,?,'music',?,?,0,0)", id!, id!, root, access!);
    db.run("INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json) VALUES(?,?,'track',?,'Song','{}')", id!, id!, id!);
  }
  return { root, path, db, libraries, catalog, async close() { await scanner.close(); db.close(); await rm(root, { recursive: true, force: true }); } };
}

test('read connection cannot write and retains a consistent WAL snapshot', async () => {
  const f = await fixture();
  const read = new MediaReadDatabase(f.path);
  try {
    assert.throws(() => read.run(), /read-only/);
    assert.throws(() => read.get("UPDATE media_items SET title='Forbidden'"), /readonly|read-only/);
    read.transaction(() => {
      assert.equal(read.get<{title:string}>("SELECT title FROM media_items WHERE id='visible'")!.title, 'Song');
      f.db.run("UPDATE media_items SET title='New' WHERE id='visible'");
      assert.equal(read.get<{title:string}>("SELECT title FROM media_items WHERE id='visible'")!.title, 'Song');
    });
    assert.equal(read.get<{title:string}>("SELECT title FROM media_items WHERE id='visible'")!.title, 'New');
  } finally { read.close(); await f.close(); }
});

test('worker preserves catalog semantics, commits, error codes, bounded queue and shutdown', async () => {
  const f = await fixture(), reader = new MediaCatalogReader(f.path);
  try {
    const result = await reader.query(query);
    assert.deepEqual(result.result, f.catalog.browse(...query.args));
    assert.deepEqual(result.access?.libraryIds, ['visible']);
    f.catalog.override({ id: 'member', role: 'admin' }, 'visible', { title: '手工标题' });
    const search = await reader.query({ method: 'search', args: [member, '手工'] });
    assert.equal(search.result?.items[0]?.title, '手工标题');
    assert.deepEqual((await reader.query({ method: 'list', args: [member, 'visible'] })).result, f.catalog.list(member, 'visible'));
    await assert.rejects(reader.query({ method: 'list', args: [member, 'private'] }), { statusCode: 404 });
    await assert.rejects(reader.query({ method: 'browse', args: [member, 'video', 'track'] }), { code: 'MEDIA_BROWSE_KIND' });
    const queued = Array.from({ length: 16 }, () => reader.query(query));
    await assert.rejects(reader.query(query), { code: 'MEDIA_QUERY_BUSY' });
    await Promise.all(queued);
    // Hold reply delivery so a fast query cannot win the race with terminate().
    // The real worker still exits and must reject its pending request.
    Reflect.get(reader, 'worker').removeAllListeners('message');
    const crashed = reader.query(query);
    const crashRejected = assert.rejects(crashed, { code: 'MEDIA_QUERY_FAILED' });
    await Reflect.get(reader, 'worker').terminate();
    await crashRejected;
    assert.equal((await reader.query(query)).result?.total, 1, 'next request recreates a failed worker');
    const pending = reader.query(query);
    const rejected = assert.rejects(pending, { code: 'MEDIA_QUERY_FAILED' });
    await reader.close();
    await rejected;
    await assert.rejects(reader.query(query), { code: 'MEDIA_QUERY_FAILED' });
  } finally { await reader.close(); await f.close(); }
});

test('file-backed HTTP rechecks grants, role, disabled account and token revocation after worker response', async t => {
  const f = await fixture();
  await mkdir(join(f.root, 'books'));
  process.env.BOOKS_DIR = join(f.root, 'books');
  process.env.DATA_DIR = join(f.root, 'data');
  process.env.READER_TOKEN_SECRET = 'media-reader-test';
  const config = loadConfig(), app = Fastify({ logger: false });
  registerErrorHandler(app);
  registerMediaRoutes(app, { db: f.db, config, users: new UserService(f.db, config) } as AppContext);
  const headers = { authorization: 'Bearer ' + signAccessToken(config, member).token };
  const original = MediaCatalogReader.prototype.query;
  let mutate: (() => void) | undefined;
  t.mock.method(MediaCatalogReader.prototype, 'query', async function(this: MediaCatalogReader, input: CatalogQuery) {
    const result = await original.call(this, input);
    mutate?.();
    return result;
  });
  const request = () => app.inject({ url: '/api/v1/media/browse?channel=music&kind=track', headers });
  try {
    const normal = await request();
    assert.equal(normal.statusCode, 200);
    assert.equal(normal.json().total, 1);
    f.db.run("INSERT INTO media_assets(id,library_id,ref,size,modified_at,probe_status) VALUES('asset','visible','book.mp3',100,0,'ready')");
    for(const url of ['/api/v1/media/libraries/visible/folders','/api/v1/media/assets/asset/catalog','/api/v1/media/items/visible']){
      assert.equal((await app.inject({url,headers})).statusCode,200);
      mutate=()=>f.db.run("UPDATE media_libraries SET access='restricted' WHERE id='visible'");
      assert.equal((await app.inject({url,headers})).json().error.code,'MEDIA_ACCESS_CHANGED');
      mutate=undefined;
      assert.equal((await app.inject({url,headers})).statusCode,404);
      f.db.run("UPDATE media_libraries SET access='all' WHERE id='visible'");
    }
    for(const url of ['/api/v1/media/favorites','/api/v1/media/history']){
      mutate=()=>f.db.run("UPDATE media_libraries SET access='restricted' WHERE id='visible'");
      const response=await app.inject({url,headers});
      assert.equal(response.statusCode,503);
      assert.equal(response.json().error.code,'MEDIA_ACCESS_CHANGED');
      mutate=undefined;
      assert.deepEqual((await app.inject({url,headers})).json(),{items:[],total:0});
      f.db.run("UPDATE media_libraries SET access='all' WHERE id='visible'");
    }
    mutate = () => f.db.run("UPDATE media_libraries SET access='restricted' WHERE id='visible'");
    const revoked = await request();
    assert.equal(revoked.statusCode, 503);
    assert.equal(revoked.json().error.code, 'MEDIA_ACCESS_CHANGED');
    mutate = undefined;
    assert.equal((await request()).json().total, 0);
    mutate = () => f.db.run("UPDATE users SET role='admin' WHERE id='member'");
    assert.equal((await request()).json().error.code, 'MEDIA_ACCESS_CHANGED');
    mutate = () => f.db.run("UPDATE users SET disabled=1 WHERE id='member'");
    assert.equal((await request()).json().error.code, 'ACCOUNT_DISABLED');
    f.db.run("UPDATE users SET disabled=0 WHERE id='member'");
    mutate = () => f.db.run("UPDATE users SET auth_version=auth_version+1 WHERE id='member'");
    assert.equal((await request()).json().error.code, 'TOKEN_INVALID');
  } finally { await app.close(); await f.close(); }
});

test('worker favorites and history isolate accounts, page visible rows and observe committed edits', async () => {
  const f=await fixture(),reader=new MediaCatalogReader(f.path);
  const state=new MediaUserState(f.db,f.libraries,f.catalog);
  new MediaPlayback(f.db,f.libraries);
  const other={id:'other',role:'member' as const};
  try{
    f.db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('other','other','unused','member',0,0)");
    f.db.run(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<120)
      INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json)
      SELECT printf('song-%03d',n),CASE WHEN n<=100 THEN 'visible' ELSE 'private' END,'track',cast(n AS TEXT),printf('Song %03d',n),'{}' FROM seq`);
    f.db.run("INSERT INTO media_assets(id,library_id,ref,size,modified_at,available,probe_status) SELECT id,library_id,id,1,0,CASE WHEN id='song-001' THEN 0 ELSE 1 END,'ready' FROM media_items");
    f.db.run("INSERT INTO media_editions(id,item_id,local_key,label) SELECT id,id,id,'版本' FROM media_items");
    f.db.run("INSERT INTO media_parts(id,edition_id,asset_id,local_key,title,ordinal) SELECT id,id,id,id,title,0 FROM media_items");
    f.db.run("INSERT INTO media_favorites SELECT 'member',id,0 FROM media_items WHERE id LIKE 'song-%'");
    f.db.run("INSERT INTO media_progress(user_id,part_id,position,revision,session_id,updated_at) SELECT 'member',id,5,1,'fixture',0 FROM media_items WHERE id LIKE 'song-%'");
    f.db.run("INSERT INTO media_favorites VALUES('other','visible',1)");
    f.db.run("INSERT INTO media_progress(user_id,part_id,position,revision,session_id,updated_at) VALUES('other','visible',9,1,'fixture',0)");
    for(const offset of [0,60,120]){
      const options={channel:'music' as const,offset,limit:60};
      assert.deepEqual((await reader.query({method:'favorites',args:[member,options]})).result,state.favorites(member,options));
      // Worker structured cloning normalizes SQLite's null-prototype row objects.
      assert.deepEqual((await reader.query({method:'history',args:[member,options]})).result,structuredClone(state.history(member,options)));
    }
    assert.equal((await reader.query({method:'favorites',args:[member]})).result!.total,100);
    assert.equal((await reader.query({method:'favorites',args:[other]})).result!.items[0]!.id,'visible');
    const history=(await reader.query({method:'history',args:[other]})).result!;
    assert.equal(history.total,1);assert.equal(history.items[0]!.position,9);
    assert.equal((await reader.query({method:'history',args:[member]})).result!.items[0]!.available,0);
    f.catalog.override({id:'member',role:'admin'},'song-001',{title:'人工标题'});
    assert.equal((await reader.query({method:'history',args:[member]})).result!.items[0]!.title,'人工标题');
    state.favorite(member,'song-001',false);
    assert.equal((await reader.query({method:'favorites',args:[member]})).result!.total,99);
    f.db.run("UPDATE media_progress SET position=12,updated_at=1 WHERE user_id='member' AND part_id='song-001'");
    assert.equal((await reader.query({method:'history',args:[member]})).result!.items[0]!.position,12);
    for(const method of ['favorites','history'] as const){
      assert.deepEqual((await reader.query({method,args:[member,{channel:'video'}]})).result,{items:[],total:0});
    }
    f.db.run("UPDATE media_libraries SET access='restricted' WHERE id='visible'");
    for(const method of ['favorites','history'] as const){
      assert.deepEqual((await reader.query({method,args:[member]})).result,{items:[],total:0});
    }
  }finally{await reader.close();await f.close();}
});

test('worker folder snapshots and file details preserve unicode paths, missing resources and per-file chapters', async () => {
  const f = await fixture(), reader = new MediaCatalogReader(f.path);
  const folders = new MediaFolders(f.db, f.libraries, f.catalog);
  try {
    for (const [id, ref, available] of [['a', '🎧100%_/one.m4b', 0], ['b', '🎧100%_/two.m4b', 1], ['c', '🎧100%_0/other.m4b', 1]] as const) {
      f.db.run("INSERT INTO media_assets(id,library_id,ref,size,modified_at,available,probe_status) VALUES(?,'visible',?,100,0,?,'ready')", id, ref, available);
    }
    f.db.run("INSERT INTO media_editions(id,item_id,local_key,label) VALUES('edition','visible','edition','默认')");
    for (const [id, asset, start] of [['p1', 'a', 0], ['p2', 'a', 10], ['p3', 'b', 0]] as const) {
      f.db.run("INSERT INTO media_parts(id,edition_id,asset_id,local_key,title,ordinal,start_seconds,end_seconds) VALUES(?,'edition',?,?,?,0,?,?)", id, asset, id, id, start, start+10);
    }
    const folderQuery: CatalogQuery = {method:'folders',args:[member,'visible','🎧100%_',0,1]};
    assert.deepEqual((await reader.query(folderQuery)).result,folders.list(...folderQuery.args));
    const file = (await reader.query({method:'file',args:[member,'a']})).result!;
    assert.deepEqual(file,folders.file(member,'a'));
    assert.equal(file.available,false);
    assert.deepEqual(file.items[0]!.editions[0]!.parts.map(part=>part.id),['p1','p2']);
    assert.deepEqual((await reader.query({method:'detail',args:[member,'visible']})).result,f.catalog.detail(member,'visible'));
    for(const path of ['..','🎧100%_/../secret','C:/'])
      await assert.rejects(reader.query({method:'folders',args:[member,'visible',path]}),{code:'MEDIA_FOLDER_PATH'});
    await assert.rejects(reader.query({method:'folders',args:[member,'private']}),{statusCode:404});
    await assert.rejects(reader.query({method:'file',args:[member,'missing']}),{statusCode:404});
    f.db.run("UPDATE media_assets SET available=1 WHERE id='a'");
    assert.equal((await reader.query({method:'file',args:[member,'a']})).result!.available,true);
    f.db.run("UPDATE media_libraries SET access='restricted' WHERE id='visible'");
    for(const q of [folderQuery,{method:'file',args:[member,'a']},{method:'detail',args:[member,'visible']}] as CatalogQuery[])
      await assert.rejects(reader.query(q),{statusCode:404});
  } finally { await reader.close(); await f.close(); }
});
