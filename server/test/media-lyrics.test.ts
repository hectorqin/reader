import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLyrics,MediaLyrics } from '../src/media/lyrics.ts';
import { Db } from '../src/db/index.ts';
import { MediaLibraries } from '../src/media/libraries.ts';
import { MediaScanner } from '../src/media/scanner.ts';

test('LRC handles repeated timestamps, offsets, translation and instrumental gaps',()=>{
  assert.deepEqual(parseLyrics(Buffer.from('[ar:艺术家]\n[offset:500]\n[00:02.5][00:04.500]重复\n[00:02.500]翻译\n[00:03.00]\n[00:00.20]开头')),{synced:true,lines:[{time:0,text:'开头'},{time:2,text:'重复'},{time:2,text:'翻译'},{time:2.5,text:''},{time:4,text:'重复'}]});
  assert.deepEqual(parseLyrics(Buffer.from('普通歌词\n<script>literal</script>')),{synced:false,lines:[{time:null,text:'普通歌词'},{time:null,text:'<script>literal</script>'}]});
  assert.equal(parseLyrics(Buffer.concat([Buffer.from([255,254]),Buffer.from('[00:01.00]中文','utf16le')])).lines[0]!.text,'中文');
  assert.throws(()=>parseLyrics(Buffer.alloc(512*1024+1)),{code:'MEDIA_LYRICS_INVALID'});
  assert.throws(()=>parseLyrics(Buffer.from('bad\0text')),{code:'MEDIA_LYRICS_INVALID'});
  assert.throws(()=>parseLyrics(Buffer.from('[00:01]x\n'.repeat(10001))),{code:'MEDIA_LYRICS_INVALID'});
});

test('lyrics use authorized matching sidecars before embedded tags and reject missing assets',async t=>{
  const root=await mkdtemp(join(tmpdir(),'media-lyrics-')),db=new Db(':memory:'),libraries=new MediaLibraries(db),actor={id:'admin',role:'admin'} as const;
  const scanner=new MediaScanner(db,libraries,async()=>({status:'ready',info:{duration:30,format:'mp3',streams:[],chapters:[],tags:{lyrics:'内嵌歌词'}}}));
  t.after(async()=>{await scanner.close();db.close();await rm(root,{recursive:true,force:true});});
  await writeFile(join(root,'song.mp3'),'fake');await writeFile(join(root,'other.lrc'),'无关歌词');
  const library=await libraries.create(actor,{name:'music',root,kind:'music',access:'restricted'});
  scanner.start(actor,library.id);await scanner.wait(library.id);
  const item=scanner.catalog.list(actor,library.id,{kind:'track'}).items[0]!;
  const part=scanner.catalog.detail(actor,item.id).editions[0]!.parts[0]!,lyrics=new MediaLyrics(db,libraries);
  assert.equal((await lyrics.read(actor,part.id)).source,'embedded');
  await assert.rejects(lyrics.read({id:'other',role:'member'},part.id),{statusCode:404});
  await assert.rejects(lyrics.read(actor,'../song.mp3'),{statusCode:404});
  await writeFile(join(root,'song.lrc'),'[00:01.00]侧车歌词');
  assert.deepEqual(await lyrics.read(actor,part.id),{source:'sidecar',synced:true,lines:[{time:1,text:'侧车歌词'}]});
  await writeFile(join(root,'song.lrc'),Buffer.alloc(512*1024+1));await assert.rejects(lyrics.read(actor,part.id),{code:'MEDIA_LYRICS_INVALID'});
  db.run('UPDATE media_assets SET available=0 WHERE id=?',part.assetId);
  await assert.rejects(lyrics.read(actor,part.id),{statusCode:404});
});
