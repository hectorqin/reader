import { applyCorrections } from '../src/ui/reading-overrides.ts';
import { loadTxt } from '../src/formats/txt.ts';
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { parseNavigation } from '../src/formats/navigation.ts';
import { anchorFor, anchorRange, selectedAnchor, encodeAnchor, decodeAnchor, findText, searchableText } from '../src/ui/text-anchor.ts';
import { PublicationCache } from '../src/store/publications.ts';
import { OfflineDownload } from '../src/core/offline-download.ts';
import { MemoryKv, MemoryBlobs } from './helpers/env.ts';
import type { Manifest } from '../src/api/types.ts';
import type { ReaderApi } from '../src/api/client.ts';

describe('navigation and text anchors', () => {
  it('preserves three levels, fragments, entities, and TOC navigation selection', () => {
    expect(parseNavigation('<html><nav><a href="cover">封面</a></nav><nav epub:type="toc"><ol><li><a href="a#top">一 &amp; 二</a><ol><li><a href="a#middle">第二层</a><ol><li><a href="b#end">第三层</a></li></ol></li></ol></li><li><a href="c">尾章</a></li></ol></nav></html>', 'nav')).toEqual([
      { href: 'a#top', title: '一 & 二', depth: 0 }, { href: 'a#middle', title: '第二层', depth: 1 }, { href: 'b#end', title: '第三层', depth: 2 }, { href: 'c', title: '尾章', depth: 0 },
    ]);
    expect(parseNavigation('<ncx><navMap><navPoint><navLabel><text>父</text></navLabel><content src="a#x"/><navPoint><navLabel><text>子</text></navLabel><content src="b#y"/></navPoint></navPoint></navMap></ncx>', 'ncx').map(n => n.depth)).toEqual([0,1]);
  });
  it('locates different occurrences across text nodes and rejects ambiguous moved text', () => {
    const root = document.createElement('div'); root.innerHTML = '<p>开头词语<b>结尾</b></p><p>后面词语结束</p>';
    const hits = findText('s', '章', searchableText(root.innerHTML), '词语');
    expect(hits).toHaveLength(2);
    const first = anchorRange(root, hits[0]!.anchor)!, second = anchorRange(root, hits[1]!.anchor)!;
    expect(first.startContainer).not.toBe(second.startContainer);
    expect(decodeAnchor(encodeAnchor(hits[0]!.anchor))).toEqual(hits[0]!.anchor);
    expect(anchorRange(root, { ...hits[0]!.anchor, start: 90, prefix: '不存在', suffix: '不存在' })).toBeNull();
    const spanning = anchorFor('s', searchableText(root.innerHTML), 2, 6);
    expect(anchorRange(root, spanning)?.toString()).toBe('词语结尾');
  });
  it('captures a browser selection and relocates a unique quote after edits', () => {
    const root = document.createElement('div'); root.innerHTML = '<p>前文<b>选中文字</b>后文</p>'; document.body.append(root);
    const range = document.createRange(); range.selectNodeContents(root.querySelector('b')!);
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    const anchor = selectedAnchor(root, 's', selection)!; expect(anchor.quote).toBe('选中文字');
    root.prepend(document.createTextNode('新内容')); expect(anchorRange(root, anchor)?.toString()).toBe('选中文字'); root.remove();
  });
});
describe('scoped quota and offline tasks', () => {
  it('serializes quota checks, isolates accounts, and rolls back failed metadata writes', async () => {
    const kv = new MemoryKv(), blobs = new MemoryBlobs(); const cache = new PublicationCache(kv, blobs, 'one');
    await cache.setQuota(1024 * 1024);
    const results = await Promise.allSettled([cache.putResource('a','x',new Uint8Array(700000)),cache.putResource('b','y',new Uint8Array(700000))]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await new PublicationCache(kv,blobs,'two').resource('a','x')).toBeNull();
    const write = vi.spyOn(kv,'set').mockRejectedValueOnce(new Error('disk full'));
    await expect(cache.putResource('a','x',new Uint8Array([1]))).rejects.toThrow('disk full'); write.mockRestore();
    expect((await cache.resource('a','x'))?.length).toBe(700000);
    await cache.removeBook('a'); expect(await cache.entries()).toEqual([]);
  });
  it('downloads selected windows and resumes without downloading completed resources', async () => {
    const cache = new PublicationCache(new MemoryKv(), new MemoryBlobs(),'scope');
    const item = (seq: number) => ({ id: String(seq), seq, title: String(seq), href: 'chapter:' + seq, resourceRef: 'r:' + seq, kind: 'chapter', format: 'html', mediaType: 'text/plain' });
    const content = { revision: 'one', kind: 'text', total: 3, groups: [{ id:'a',seq:0,offset:0,count:1,title:'a' },{ id:'b',seq:1,offset:1,count:2,title:'b' }], items:[item(0)] };
    const manifest = { book:{ id:'b', format:'txt' }, content } as unknown as Manifest;
    const asset = vi.fn(async (_id: string, ref: string) => new NodeBlob([ref]));
    const api = { asset, items: vi.fn(async () => ({ ...content, group: 1, items:[item(1),item(2)] })) } as unknown as ReaderApi;
    const task = new OfflineDownload(api,cache,manifest,()=>{}); await task.start(2,3);
    expect(task.state.status).toBe('complete'); expect(asset).toHaveBeenCalledTimes(2);
    expect((await cache.window('b',1))?.items).toHaveLength(2);
    const resumed = new OfflineDownload(api,cache,manifest,()=>{}); await resumed.load(); await resumed.start(2,3);
    expect(asset).toHaveBeenCalledTimes(2); expect(resumed.state.completed).toBe(2);
    const changed = new OfflineDownload(api,cache,{ ...manifest,content:{ ...manifest.content!,revision:'two' } },()=>{});
    await changed.load(); expect(changed.state.status).toBe('idle');
  });
  it('aborts an in-flight task without marking incomplete bytes as cached', async () => {
    const cache = new PublicationCache(new MemoryKv(),new MemoryBlobs(),'pause');
    const manifest = { book:{id:'b',format:'epub'},files:[] } as unknown as Manifest;
    const bookBytes = vi.fn((_id: string,{signal}: {signal:AbortSignal}) => new Promise((_resolve,reject) => signal.addEventListener('abort',()=>reject(signal.reason))));
    const task = new OfflineDownload({bookBytes} as unknown as ReaderApi,cache,manifest,()=>{});
    const run = task.start(); await vi.waitFor(()=>expect(bookBytes).toHaveBeenCalled()); await task.pause(true); await run;
    expect(task.state.status).toBe('cancelled'); expect(await cache.entries()).toEqual([]);
  });
});

it('applies literal corrections safely, supports chained edits, and preserves original source', () => {
 const root = document.createElement('div'); root.innerHTML = '<p>需要纠错的原文</p>';
 const first = anchorFor('xhtml:a',root.textContent!,2,4);
 const second = anchorFor('a','需要修改的原文',2,4);
 expect(applyCorrections(root,'a',{version:1,headingPrefix:'',corrections:[{id:'1',anchor:first,replacement:'修改'},{id:'2',anchor:second,replacement:'<script>文本</script>'}]})).toBe(2);
 expect(root.querySelector('script')).toBeNull(); expect(root.textContent).toContain('<script>文本</script>');
});
it('previews and applies a literal TXT heading prefix without executing regular expressions', () => {
 const bytes = new TextEncoder().encode('前言\n@@ 一\n正文\n@@ 二\n正文');
 const result = loadTxt({bytes,fileName:'a.txt',bookId:'a'},{headingPrefix:'@@'});
 expect(result.doc.toc.map(t => t.label)).toEqual(['前言','@@ 一','@@ 二']);
 expect(loadTxt({bytes,fileName:'a.txt',bookId:'a'},{headingPrefix:'(a+)+'}).chapterCount).toBe(0);
});

it('retries a failed chapter download and uses a complete TXT file for custom headings', async () => {
 const cache=new PublicationCache(new MemoryKv(),new MemoryBlobs(),'retry');
 const content={kind:'text',total:2,revision:'v',groups:[{id:'all',seq:0,offset:0,count:2,title:'全部'}],items:[0,1].map(seq=>({id:String(seq),seq,title:String(seq),href:'chapter:'+seq,resourceRef:'r:'+seq,kind:'chapter',mediaType:'text/plain'}))};
 const manifest={book:{id:'b',format:'txt'},files:[],content} as unknown as Manifest;
 const asset=vi.fn().mockResolvedValueOnce(new NodeBlob(['a'])).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new NodeBlob(['b']));
 const api={asset,bookBytes:vi.fn(async()=>new Uint8Array([1,2,3]))} as unknown as ReaderApi;
 const task=new OfflineDownload(api,cache,manifest,()=>{});await task.start(1,2);expect(task.state.status).toBe('error');expect(task.state.completed).toBe(1);
 await task.start(1,2);expect(task.state.status).toBe('complete');expect(asset).toHaveBeenCalledTimes(3);
 await cache.putOverrides('b',{version:1,headingPrefix:'@@',corrections:[]});await task.start(1,1);
 expect(api.bookBytes).toHaveBeenCalledTimes(1);expect(task.state.message).toBe('整书已可离线阅读');
});
