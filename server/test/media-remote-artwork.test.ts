import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RemoteArtwork} from '../src/media/remote-artwork.ts';
import {MediaArtwork} from '../src/media/artwork.ts';
import {MediaCatalog} from '../src/media/catalog.ts';
import {MediaLibraries} from '../src/media/libraries.ts';
import {Db} from '../src/db/index.ts';

const png=Buffer.from([137,80,78,71,13,10,26,10,0]);
test('distinguishes absent covers, upstream failures and transport timeouts without leaking URLs',async()=>{
  for(const status of [404,410,429,503]){
    const artwork=new RemoteArtwork((async()=>new Response(null,{status})) as typeof fetch);
    await assert.rejects(artwork.tmdb('/poster.png'),{statusCode:status===404||status===410?404:502,code:status===404||status===410?'MEDIA_COVER_NOT_FOUND':'MEDIA_COVER_UPSTREAM'});
  }
  for(const error of [new DOMException('secret URL','TimeoutError'),new TypeError('secret URL',{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}})]){
    const artwork=new RemoteArtwork((async()=>{throw error;}) as typeof fetch);
    await assert.rejects(artwork.tmdb('/poster.png'),(failure:unknown)=>{
      const value=failure as {statusCode:number;code:string;message:string};
      assert.equal(value.statusCode,504);assert.equal(value.code,'MEDIA_COVER_TIMEOUT');assert.ok(!value.message.includes('secret'));return true;
    });
  }
});
test('MusicBrainz cover follows only bounded archive redirects and shares cached bytes',async()=>{
  const id='12345678-1234-1234-1234-123456789abc';let calls=0;
  const artwork=new RemoteArtwork((async(url,options)=>{
    calls++;assert.equal(options?.redirect,'manual');assert.equal(options?.headers,undefined);
    if(calls===1){assert.equal(url,`https://coverartarchive.org/release-group/${id}/front-500`);return new Response(null,{status:307,headers:{location:'https://archive.org/download/mbid-test/front-500.jpg'}});}
    assert.equal(url,'https://archive.org/download/mbid-test/front-500.jpg');return new Response(png);
  }) as typeof fetch);
  assert.deepEqual(await artwork.musicBrainz(id),png);assert.deepEqual(await artwork.musicBrainz(id),png);assert.equal(calls,2);
  for(const location of ['http://archive.org/a','https://localhost/private','https://archive.org.evil.test/a','https://user:pass@archive.org/a','https://archive.org:8443/a']){
    let requests=0;const blocked=new RemoteArtwork((async()=>{requests++;return new Response(null,{status:302,headers:{location}});}) as typeof fetch);
    await assert.rejects(blocked.musicBrainz(id));assert.equal(requests,1);
  }
});
test('concurrent identical posters share one request and failed downloads can be retried',async()=>{
  let calls=0,finish!:(response:Response)=>void;
  const artwork=new RemoteArtwork((()=>{calls++;return new Promise<Response>(resolve=>{finish=resolve;});}) as typeof fetch);
  const first=artwork.tmdb('/same.png'),second=artwork.tmdb('/same.png');
  assert.equal(calls,1);finish(new Response('offline',{status:503}));
  const failures=await Promise.allSettled([first,second]);assert.ok(failures.every(result=>result.status==='rejected'));
  const retry=artwork.tmdb('/same.png');assert.equal(calls,2);finish(new Response(png));assert.deepEqual(await retry,png);
});
test('distinct poster downloads never exceed four active fetches',async()=>{
  let active=0,peak=0;
  const releases:Array<()=>void>=[];
  const artwork=new RemoteArtwork((async()=>{
    active++;peak=Math.max(peak,active);await new Promise<void>(resolve=>releases.push(resolve));active--;return new Response(png);
  }) as typeof fetch);
  const requests=Array.from({length:9},(_,i)=>artwork.tmdb('/poster'+i+'.png'));
  assert.equal(releases.length,4);
  for(let i=0;i<9;i++){
    while(!releases[i])await new Promise<void>(resolve=>setImmediate(resolve));
    releases[i]!();
  }
  await Promise.all(requests);assert.equal(peak,4);
});
test('online artwork restricts keys and origin, caches bytes and rejects oversized bodies',async()=>{
  let calls=0;
  const artwork=new RemoteArtwork((async(url,options)=>{calls++;assert.equal(url,'https://image.tmdb.org/t/p/w500/poster.jpg');assert.equal(options?.redirect,'error');assert.equal(options?.headers,undefined);return new Response(png);}) as typeof fetch);
  await assert.rejects(artwork.tmdb('https://localhost/private'));
  await assert.rejects(artwork.tmdb('/../private.jpg'));
  assert.equal(calls,0);
  assert.deepEqual(await artwork.tmdb('/poster.jpg'),png);assert.deepEqual(await artwork.tmdb('/poster.jpg'),png);assert.equal(calls,1);
  const oversized=new RemoteArtwork((async()=>new Response(new Uint8Array(5*1024*1024+1))) as typeof fetch);
  await assert.rejects(oversized.tmdb('/large.png'));
});
test('online cover rechecks access and current match after the image request',async()=>{
  const db=new Db(':memory:'),libraries=new MediaLibraries(db);new MediaCatalog(db,libraries);
  db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('admin','admin','x','admin',0,0)");
  db.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES('lib','film','video','/missing','all',0,0)");
  db.run("INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json) VALUES('film','lib','movie','film','Film','{}')");
  db.run("INSERT INTO media_online_metadata VALUES('film','tmdb','1','https://www.themoviedb.org/movie/1',?,'admin',0)",JSON.stringify({tmdbPosterPath:'/poster.png'}));
  const actor={id:'admin',role:'admin'} as const;
  const remote=new RemoteArtwork((async()=>new Response(png)) as typeof fetch);
  try{
    const artwork=new MediaArtwork(db,libraries,remote);
    assert.equal((await artwork.cover(actor,'film')).contentType,'image/png');
    db.run("UPDATE media_online_metadata SET provider='musicbrainz',fields_json=? WHERE item_id='film'",JSON.stringify({musicBrainzCoverGroupId:'12345678-1234-1234-1234-123456789abc'}));
    assert.equal((await artwork.cover(actor,'film')).contentType,'image/png');
    db.run("UPDATE media_online_metadata SET provider='tmdb',fields_json=? WHERE item_id='film'",JSON.stringify({tmdbPosterPath:'/poster.png'}));
    db.run("UPDATE media_libraries SET access='restricted' WHERE id='lib'");
    await assert.rejects(artwork.cover({id:'member',role:'member'},'film'),{statusCode:404});
    db.run("UPDATE media_libraries SET access='all' WHERE id='lib'");
    const revoked=new MediaArtwork(db,libraries,new RemoteArtwork((async()=>{db.run("UPDATE media_libraries SET access='restricted' WHERE id='lib'");return new Response(png);}) as typeof fetch));
    await assert.rejects(revoked.cover({id:'member',role:'member'},'film'),{statusCode:404});
    const uncached=new MediaArtwork(db,libraries,new RemoteArtwork((async()=>{db.run("DELETE FROM media_online_metadata WHERE item_id='film'");return new Response(png);}) as typeof fetch));
    await assert.rejects(uncached.cover(actor,'film'),{statusCode:404});
  }finally{db.close();}
});
