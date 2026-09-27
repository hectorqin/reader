import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '../src/db/index.ts';
import { MediaLibraries } from '../src/media/libraries.ts';
import { MediaScanner } from '../src/media/scanner.ts';
import { MediaScraping } from '../src/media/scraping.ts';
import { MediaScrapeJobs } from '../src/media/scrape-jobs.ts';
import { MediaCatalog } from '../src/media/catalog.ts';
import { MetadataHttp, TmdbProvider, MusicBrainzProvider } from '../src/media/metadata-providers.ts';
import type { MetadataProvider, OnlineMetadata } from '../src/media/metadata-providers.ts';

test('candidate preview migration preserves legacy rows and reviewed candidates survive reopening the database',async t=>{
  const root=await mkdtemp(join(tmpdir(),'media-candidate-upgrade-')),path=join(root,'state.db');
  let db=new Db(path);
  t.after(async()=>{db.close();await rm(root,{recursive:true,force:true});});
  const actor={id:'admin',role:'admin'} as const;
  const catalog=new MediaCatalog(db,new MediaLibraries(db));
  db.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES('lib','films','video','/media','all',0,0)");
  db.run("INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json) VALUES('film','lib','movie','film','Local','{}')");
  db.run('CREATE TABLE media_scrape_candidates(id TEXT PRIMARY KEY,item_id TEXT NOT NULL,actor_id TEXT NOT NULL,provider TEXT NOT NULL,external_id TEXT NOT NULL,expires_at INTEGER NOT NULL)');
  db.run("INSERT INTO media_scrape_candidates VALUES('legacy','film','admin','tmdb','42',?)",Date.now()+60000);
  const provider:MetadataProvider={id:'tmdb',label:'fixture',configured:true,kinds:['movie'],
    async search(){return [{externalId:'42',title:'Preview title'}];},
    async detail(){return {externalId:'42',fields:{title:'Current title'},sourceUrl:'https://www.themoviedb.org/movie/42'};}};
  const scraping=new MediaScraping(db,catalog,[provider]);
  assert.ok(db.get("SELECT id FROM media_scrape_candidates WHERE id='legacy'"));
  assert.equal(scraping.candidates(actor,'film').items.length,0,'legacy rows without previews are not invented');
  const candidate=(await scraping.search(actor,'film','tmdb','Local')).items[0]!;
  db.close();db=new Db(path);
  const reopened=new MediaScraping(db,new MediaCatalog(db,new MediaLibraries(db)),[provider]);
  const saved=reopened.candidates(actor,'film').items;
  assert.equal(saved.length,1);assert.equal(saved[0]!.candidateId,candidate.candidateId);assert.equal(saved[0]!.title,'Preview title');
  const confirmed=await reopened.confirm(actor,'film',candidate.candidateId);
  assert.equal(confirmed.title,'Current title','confirmation refreshes provider detail rather than publishing stale preview');
  assert.equal(reopened.candidates(actor,'film').items.length,0);
});

test('provider cancellation interrupts fetch without retrying or leaking credentials',async()=>{
  let calls=0,entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const http=new MetadataHttp(async(_url,init)=>{
    calls++;entered();
    return await new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));
  });
  const provider=new TmdbProvider(http,'test-secret'),controller=new AbortController();
  const pending=provider.search('movie','test',controller.signal);
  await started;controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,1);
});

for(const operation of ['search','detail'] as const)test(`MusicBrainz ${operation} forwards cancellation to an active network request`,{timeout:5000},async()=>{
  let calls=0,entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const http=new MetadataHttp(async(_url,init)=>{
    calls++;entered();
    return new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));
  });
  const provider=new MusicBrainzProvider(http,'Reader test fixture'),controller=new AbortController();
  const pending=operation==='search'?provider.search('album','test',controller.signal):provider.detail('album','12345678-1234-1234-1234-123456789abc',controller.signal);
  await started;controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,1);
});

test('MusicBrainz cancellation during rate-limit waiting never sends the queued request',async()=>{
  let calls=0;
  const provider=new MusicBrainzProvider(new MetadataHttp(async()=>{calls++;return new Response(JSON.stringify({'release-groups':[]}));}),'Reader test fixture');
  await provider.search('album','first');
  const controller=new AbortController(),pending=provider.search('album','second',controller.signal);
  controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,1);
});

test('TMDB child matching uses confirmed series identity and refuses a changed parent',async t=>{
  const root=await mkdtemp(join(tmpdir(),'media-child-match-')),db=new Db(':memory:');
  const actor={id:'admin',role:'admin'} as const,libraries=new MediaLibraries(db);
  db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('admin','admin','x','admin',0,0)");
  const scanner=new MediaScanner(db,libraries,async()=>({status:'unavailable'}));
  t.after(async()=>{await scanner.close();db.close();await rm(root,{recursive:true,force:true});});
  await writeFile(join(root,'Drama.S01E02.mp4'),'fixture');
  const library=await libraries.create(actor,{name:'tv',kind:'video',root,access:'all'});
  scanner.start(actor,library.id);await scanner.wait(library.id);
  const series=scanner.catalog.list(actor,library.id,{kind:'series'}).items[0]!;
  const season=scanner.catalog.detail(actor,series.id).children[0]!;
  const episode=scanner.catalog.detail(actor,season.id).children[0]!;
  const paths:string[]=[];let seriesExternalId=42;
  const provider=new TmdbProvider(new MetadataHttp(async url=>{
    const path=new URL(String(url)).pathname;paths.push(path);
    if(path.includes('/search/'))return Response.json({results:[{id:seriesExternalId,name:'剧名'}]});
    if(path.endsWith('/episode/2'))return Response.json({id:902,season_number:1,episode_number:2,name:'第二集标题',overview:'本集简介',air_date:'2024-02-02',still_path:'/still.jpg'});
    if(path.endsWith('/season/1'))return Response.json({id:901,season_number:1,name:'第一季',overview:'本季简介'});
    return Response.json({id:seriesExternalId,name:'剧名'});
  }),'fixture-token');
  const scraping=new MediaScraping(db,scanner.catalog,[provider]);
  await assert.rejects(scraping.search(actor,episode.id,'tmdb','ignored'),{code:'MEDIA_PARENT_MATCH_REQUIRED'});
  const parentCandidate=(await scraping.search(actor,series.id,'tmdb','Drama')).items[0]!;
  await scraping.confirm(actor,series.id,parentCandidate.candidateId);
  const jobs=new MediaScrapeJobs(db,scanner.catalog,scraping);
  try{
    assert.throws(()=>jobs.startSeriesChildren({id:'member',role:'member'},series.id),{statusCode:403});
    const job=jobs.startSeriesChildren(actor,series.id);await jobs.wait(job.id);
    assert.equal(jobs.get(actor,job.id).state,'complete');
    assert.deepEqual(jobs.get(actor,job.id).items.map(row=>row.state),['review','review']);
    const saved=scraping.candidates(actor,episode.id).items;
    assert.equal(saved.length,1);assert.equal(saved[0]!.title,'第二集标题');
    assert.equal(scraping.candidates({id:'other-admin',role:'admin'},episode.id).items.length,0);
    assert.throws(()=>scraping.candidates({id:'member',role:'member'},episode.id),{statusCode:403});
    assert.equal(scanner.catalog.detail(actor,episode.id).metadata.onlineMatch,undefined);
    assert.equal(scanner.catalog.detail(actor,season.id).metadata.onlineMatch,undefined);
  }finally{await jobs.close();}
  const seasonCandidate=(await scraping.search(actor,season.id,'tmdb','ignored')).items[0]!;
  assert.equal(seasonCandidate.externalId,'42/season/1');
  const seasonResult=await scraping.confirm(actor,season.id,seasonCandidate.candidateId);assert.equal(seasonResult.title,'第一季');
  const candidate=(await scraping.search(actor,episode.id,'tmdb','ignored')).items[0]!;
  assert.equal(candidate.externalId,'42/season/1/episode/2');
  scanner.catalog.override(actor,episode.id,{title:'人工标题'});
  const result=await scraping.confirm(actor,episode.id,candidate.candidateId);
  assert.equal(result.title,'人工标题');assert.equal(result.metadata.plot,'本集简介');assert.equal(result.metadata.tmdbPosterPath,'/still.jpg');
  assert.ok(paths.includes('/3/tv/42/season/1/episode/2'));
  const stale=(await scraping.search(actor,episode.id,'tmdb','ignored')).items[0]!;
  db.run("UPDATE media_online_metadata SET external_id='43' WHERE item_id=?",series.id);
  await assert.rejects(scraping.confirm(actor,episode.id,stale.candidateId),{code:'MEDIA_PARENT_MATCH_CHANGED'});
  db.run("UPDATE media_online_metadata SET external_id='42' WHERE item_id=?",series.id);
  const beforeClear=scanner.catalog.detail(actor,episode.id);
  scraping.clear(actor,series.id);
  assert.equal(scanner.catalog.detail(actor,season.id).metadata.onlineMatch,undefined);
  const cleared=scanner.catalog.detail(actor,episode.id);
  assert.equal(cleared.metadata.onlineMatch,undefined);assert.equal(cleared.metadata.plot,undefined);
  assert.equal(cleared.title,'人工标题');assert.deepEqual(cleared.editions,beforeClear.editions);
  assert.equal(db.get<{n:number}>('SELECT count(*) n FROM media_scrape_candidates WHERE item_id=?',episode.id)!.n,0);
  assert.equal(scraping.candidates(actor,episode.id).items.length,0);
  const confirmParent=async()=>scraping.confirm(actor,series.id,(await scraping.search(actor,series.id,'tmdb','Drama')).items[0]!.candidateId);
  await confirmParent();
  await scraping.confirm(actor,episode.id,(await scraping.search(actor,episode.id,'tmdb','ignored')).items[0]!.candidateId);
  await confirmParent();
  assert.ok(scanner.catalog.detail(actor,episode.id).metadata.onlineMatch,'same parent confirmation preserves child metadata');
  seriesExternalId=43;await confirmParent();
  assert.equal(scanner.catalog.detail(actor,episode.id).metadata.onlineMatch,undefined);
  assert.equal(scanner.catalog.detail(actor,episode.id).title,'人工标题');
  await assert.rejects(provider.detail('episode','42/season/1/episode/3'),{code:'MEDIA_PROVIDER_UNAVAILABLE'});
});

test('confirmed metadata survives rescans, manual overrides win, clearing restores local fields', async t => {
  const root = await mkdtemp(join(tmpdir(), 'media-scraping-')), db = new Db(':memory:');
  const actor = { id: 'admin', role: 'admin' } as const;
  const libraries = new MediaLibraries(db), scanner = new MediaScanner(db, libraries, async () => ({ status: 'unavailable' }));
  t.after(async () => { await scanner.close(); db.close(); await rm(root, { recursive: true, force: true }); });
  await writeFile(join(root, 'Local.mp4'), 'fixture');
  const library = await libraries.create(actor, { name: 'movies', root, kind: 'video', access: 'all' });
  scanner.start(actor, library.id); await scanner.wait(library.id);
  const item = scanner.catalog.list(actor, library.id).items[0]!;
  const original = scanner.catalog.detail(actor, item.id);
  const provider: MetadataProvider = {
    id: 'tmdb', label: 'TMDB', kinds: ['movie'], configured: true,
    async search() { return [{ externalId: '42', title: 'Online title', year: 2024 }]; },
    async detail() { return { externalId: '42', fields: { title: 'Online title', year: 2024, plot: 'Synopsis' }, sourceUrl: 'https://www.themoviedb.org/movie/42' }; },
  };
  const scraping = new MediaScraping(db, scanner.catalog, [provider]);
  const search = () => scraping.search(actor, item.id, 'tmdb', 'Local');
  const candidates = await search();
  assert.equal(scanner.catalog.detail(actor, item.id).title, 'Local', 'search never publishes metadata');
  await assert.rejects(scraping.confirm({ id: 'other', role: 'admin' }, item.id, candidates.items[0]!.candidateId), { statusCode: 404 });
  await assert.rejects(scraping.search({ id: 'member', role: 'member' }, item.id, 'tmdb', 'x'), { statusCode: 403 });
  let detail = await scraping.confirm(actor, item.id, candidates.items[0]!.candidateId);
  assert.equal(detail.title, 'Online title');
  assert.equal((detail.metadata.sources as Record<string, string>).title, 'tmdb');
  assert.equal(scanner.catalog.list(actor, library.id, { search: 'Online title' }).total, 1);
  assert.deepEqual(detail.editions, original.editions);
  scanner.catalog.override(actor, item.id, { title: 'Manual title' });
  scanner.start(actor, library.id); await scanner.wait(library.id);
  detail = scanner.catalog.detail(actor, item.id);
  assert.equal(detail.title, 'Manual title'); assert.equal(detail.metadata.year, 2024);
  scanner.catalog.override(actor, item.id, { title: null });
  assert.equal(scanner.catalog.detail(actor, item.id).title, 'Online title');
  assert.equal(scraping.clear(actor, item.id).title, 'Local');
  assert.equal(scanner.catalog.detail(actor, item.id).metadata.onlineMatch, undefined);

  const expired = (await search()).items[0]!;
  db.run('UPDATE media_scrape_candidates SET expires_at=0 WHERE id=?', expired.candidateId);
  assert.equal(scraping.candidates(actor,item.id).items.length,0);
  await assert.rejects(scraping.confirm(actor, item.id, expired.candidateId), { code: 'MEDIA_CANDIDATE_EXPIRED' });
  const superseded = (await search()).items[0]!;
  await search();
  await assert.rejects(scraping.confirm(actor, item.id, superseded.candidateId), { statusCode: 404 });

  let finish!: (value: OnlineMetadata) => void;
  provider.detail = () => new Promise(resolve => { finish = resolve; });
  const pendingCandidate = (await search()).items[0]!;
  const pending = scraping.confirm(actor, item.id, pendingCandidate.candidateId);
  scraping.clear(actor, item.id);
  finish({ externalId: '42', fields: { title: 'Stale title' }, sourceUrl: 'https://www.themoviedb.org/movie/42' });
  await assert.rejects(pending, { code: 'MEDIA_CANDIDATE_EXPIRED' });
  assert.equal(scanner.catalog.detail(actor, item.id).title, 'Local');
});

test('TMDB adapter maps movie/series responses and does not expose its bearer token', async () => {
  const requests: Array<{ url: URL; headers: unknown; redirect: unknown }> = [];
  const http = new MetadataHttp(async (input, init) => {
    const url = new URL(String(input)); requests.push({ url, headers: init?.headers, redirect: init?.redirect });
    return Response.json(url.pathname.includes('/search/') ? { results: [{ id: 42, name: '剧名', first_air_date: '2024-01-01' }] } : { id: 42, name: '剧名', first_air_date: '2024-01-01', overview: '简介', poster_path: '/poster.jpg' });
  });
  const provider = new TmdbProvider(http, 'test-only-token');
  assert.deepEqual(await provider.search('series', '剧名 & 标题'), [{ externalId: '42', title: '剧名', year: 2024, description: '' }]);
  const metadata = await provider.detail('series', '42');
  assert.equal(metadata.sourceUrl, 'https://www.themoviedb.org/tv/42');
  assert.deepEqual(metadata.fields, { title: '剧名', year: 2024, plot: '简介', tmdbPosterPath: '/poster.jpg' });
  assert.equal(requests[0]!.url.searchParams.get('query'), '剧名 & 标题');
  assert.equal(requests[0]!.redirect, 'error');
  assert.ok(!JSON.stringify(metadata).includes('test-only-token'));
  await assert.rejects(provider.detail('movie', '../42'), { statusCode: 400 });
  await assert.rejects(provider.search('track', 'x'), { statusCode: 400 });
  await assert.rejects(new TmdbProvider(http, '', '').search('movie', 'x'), { code: 'MEDIA_PROVIDER_NOT_CONFIGURED' });
});

test('TMDB accepts API keys and prefers an explicitly configured bearer token', async () => {
  const requests: Array<{ url: URL; headers: Headers; redirect: unknown }> = [];
  const http = new MetadataHttp(async (input, init) => {
    requests.push({ url: new URL(String(input)), headers: new Headers(init?.headers), redirect: init?.redirect });
    return Response.json({ id: 42, title: 'Movie' });
  });
  const keyed = new TmdbProvider(http, '', 'test-only-key');
  assert.equal(keyed.configured, true);
  const detail = await keyed.detail('movie', '42');
  assert.equal(requests[0]!.url.searchParams.get('api_key'), 'test-only-key');
  assert.equal(requests[0]!.headers.has('authorization'), false);
  assert.equal(requests[0]!.redirect, 'error');
  assert.ok(!JSON.stringify(detail).includes('test-only-key'));
  await new TmdbProvider(http, 'test-only-token', 'test-only-key').detail('movie', '42');
  assert.equal(requests[1]!.url.searchParams.has('api_key'), false);
  assert.equal(requests[1]!.headers.get('authorization'), 'Bearer test-only-token');
  const failing = new TmdbProvider(new MetadataHttp(async () => Response.json({}, { status: 401 })), '', 'test-only-key');
  await assert.rejects(failing.detail('movie', '42'), error => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes('test-only-key'));
    return true;
  });
});

test('MusicBrainz artist detail preserves disambiguation and associated area without inventing a biography',async()=>{
  const id='b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d';
  const provider=new MusicBrainzProvider(new MetadataHttp(async()=>Response.json({id,name:'The Beatles',type:'Group',area:{name:'United Kingdom'},disambiguation:'UK rock band'})),'Reader test');
  const detail=await provider.detail('artist',id);
  assert.deepEqual(detail.fields,{title:'The Beatles',artistType:'Group',artistArea:'United Kingdom',artistDisambiguation:'UK rock band'});
  assert.equal(detail.fields.plot,undefined);
});

test('MusicBrainz searches audiobook releases and retrieves artist credits without assigning authors', async () => {
  const id = '12345678-1234-1234-1234-123456789abc', urls: URL[] = [];
  const provider = new MusicBrainzProvider(new MetadataHttp(async input => {
    const url = new URL(String(input)); urls.push(url);
    const row = { id, title: 'Audio book', 'first-release-date': '2021', 'artist-credit': [{ artist: { name: 'Reader' } }] };
    return Response.json(url.searchParams.has('query') ? { 'release-groups': [row] } : row);
  }), 'ReaderTest/1.0 (test@example.invalid)');
  const result = await provider.search('audiobook', 'title" OR *');
  assert.equal(result[0]!.artist, 'Reader');
  assert.ok(urls[0]!.searchParams.get('query')!.includes('AND secondarytype:audiobook'));
  assert.ok(urls[0]!.searchParams.get('query')!.includes('title\\" OR \\*'));
  const metadata = await provider.detail('audiobook', id);
  assert.deepEqual(metadata.fields, { title: 'Audio book', year: 2021, artist: 'Reader',musicBrainzCoverGroupId:id });
  assert.equal(urls[1]!.searchParams.get('inc'), 'artists');
});

test('manual search forwards artist constraints without overriding local metadata or publishing a match',async()=>{
  const db=new Db(':memory:');
  try{
    const catalog=new MediaCatalog(db,new MediaLibraries(db)),actor={id:'admin',role:'admin'} as const;
    db.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES('lib','music','music','/music','all',0,0)");
    db.run("INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json) VALUES('track','lib','track','track','Yesterday','{}')");
    const calls:Array<string|undefined>=[];
    const scraping=new MediaScraping(db,catalog,[{id:'musicbrainz',label:'MusicBrainz',kinds:['track'],configured:true,async search(_kind,_query,_signal,artist){calls.push(artist);return [];},async detail(){throw new Error('must not confirm');}}]);
    await scraping.search(actor,'track','musicbrainz','Yesterday',undefined,undefined,' The Beatles ');
    await scraping.search(actor,'track','musicbrainz','Yesterday');
    assert.deepEqual(calls,['The Beatles',undefined]);
    assert.equal(catalog.detail(actor,'track').metadata.artist,undefined);
    assert.equal(catalog.detail(actor,'track').metadata.onlineMatch,undefined);
    await assert.rejects(scraping.search(actor,'track','musicbrainz','Yesterday',undefined,undefined,'x'.repeat(201)),{statusCode:400});
    assert.equal(calls.length,2);
  }finally{db.close();}
});

test('MusicBrainz artist search constraints escape query syntax and reject unsupported kinds',async()=>{
  const urls:URL[]=[];
  const provider=new MusicBrainzProvider(new MetadataHttp(async input=>{urls.push(new URL(String(input)));return Response.json({recordings:[]});}),'Reader test');
  await provider.search('track','Yesterday',undefined,'Band" OR *');
  assert.equal(urls[0]!.searchParams.get('query'),'recording:"Yesterday" AND artist:"Band\\" OR \\*"');
  await assert.rejects(provider.search('audiobook','Book',undefined,'Reader'),{statusCode:400});
  assert.equal(urls.length,1);
});

test('provider transport rejects oversized responses, unexpected origins and safely reports errors', async () => {
  let calls = 0;
  const http = new MetadataHttp(async () => { calls++; return new Response('bad', { headers: { 'content-length': String(3 * 1024 * 1024) } }); });
  await assert.rejects(http.json(new URL('http://127.0.0.1/private'), {}), { statusCode: 400 });
  assert.equal(calls, 0);
  await assert.rejects(http.json(new URL('https://api.themoviedb.org/3/movie/1'), {}), { code: 'MEDIA_PROVIDER_UNAVAILABLE' });
  const denied = new MetadataHttp(async () => new Response('secret upstream response', { status: 401 }));
  await assert.rejects(denied.json(new URL('https://api.themoviedb.org/3/movie/1'), {}), error => error instanceof Error && !error.message.includes('secret'));
});

test('provider transport retries transient errors but honours long server backoff', async () => {
  let attempts = 0;
  const http = new MetadataHttp(async () => ++attempts === 1 ? new Response('', { status: 503 }) : Response.json({ id: 1 }));
  assert.deepEqual(await http.json(new URL('https://api.themoviedb.org/3/movie/1'), {}), { id: 1 });
  assert.equal(attempts, 2);
  const limited = new MetadataHttp(async () => new Response('', { status: 429, headers: { 'retry-after': '60' } }));
  await assert.rejects(limited.json(new URL('https://api.themoviedb.org/3/movie/1'), {}), { statusCode: 502 });
});
