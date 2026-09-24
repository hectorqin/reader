import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchBookPage, htmlSearchText, plainSearchText } from '../src/services/book-search.ts';
import type { Manifest } from '../src/indexer/formats/registry.ts';
const overrides = {version:0,corrections:[],headingPrefix:''};
const manifest: Manifest = {kind:'text',revision:'one',total:3,groups:[],items:[0,1,2].map(seq=>({id:String(seq),seq,title:'章节'+seq,href:'chapter:'+seq,kind:'chapter',mediaType:'text/html'}))};
test('server search returns bounded pages, decoded text anchors, and excludes scripts', async () => {
  const load = async () => ({data:Buffer.from('<head><title>不应命中</title></head><body><p>甲&amp;乙目标丙</p><script>目标</script></body>'),contentType:'text/html'});
  const one = await searchBookPage(manifest,'目标',undefined,overrides,load,AbortSignal.timeout(3000),1);
  assert.equal(one.hits.length,1); assert.equal(one.scanned,1); assert.equal(one.hits[0]?.anchor.start,3);
  assert.equal(one.hits[0]?.anchor.prefix,'甲&乙'); assert.ok(one.nextCursor);
  const two = await searchBookPage(manifest,'目标',one.nextCursor,overrides,load,AbortSignal.timeout(3000),2);
  assert.equal(two.hits.length,2); assert.equal(two.scanned,3); assert.equal(two.nextCursor,undefined);
  await assert.rejects(searchBookPage({...manifest,revision:'changed'},'目标',one.nextCursor,overrides,load,AbortSignal.timeout(3000)),/已变化/);
  assert.equal(htmlSearchText('<p>文本</p><style>secret</style><noscript>secret</noscript>'),'文本');
});
test('chapter failures, cancellation, personal corrections and match limits remain explicit', async () => {
  const loaded: string[]=[];
  const result=await searchBookPage(manifest,'新内容',undefined,{...overrides,corrections:[{id:'c',anchor:{sectionId:'chapter:0',start:0,end:3,quote:'旧内容',prefix:'',suffix:''},replacement:'新内容'}]},async item=>{
    loaded.push(item.href); if(item.seq===1) throw Error('private upstream details'); return {data:Buffer.from('<p>旧内容</p>'),contentType:'text/html'};
  },AbortSignal.timeout(3000));
  assert.equal(result.hits.length,1);assert.deepEqual(result.failures,[{title:'章节1',code:'CHAPTER_UNAVAILABLE'}]);assert.equal(loaded.length,3);
  const abort=new AbortController();abort.abort();await assert.rejects(searchBookPage(manifest,'a',undefined,overrides,async()=>{throw Error('must not run')},abort.signal),{name:'AbortError'});
  const capped=await searchBookPage(manifest,'字',undefined,overrides,async()=>({data:Buffer.from('字'.repeat(1000)),contentType:'text/plain'}),AbortSignal.timeout(3000));
  assert.equal(capped.hits.length,200);assert.equal(capped.limited,true);assert.equal(capped.nextCursor,undefined);
  assert.equal(plainSearchText('第一章 测试\n\n  正文。\n  下一段。'),'\n第一章 测试\n正文。\n下一段。\n\n');
});
