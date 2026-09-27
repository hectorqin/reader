// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { render } from '../src/ui/vendor/preact.ts';
import { MetadataMatcher } from '../src/media/metadata-matcher.tsx';
import type { Detail, MediaApi } from '../src/media/api.ts';

const root = document.createElement('div');
document.body.append(root);
const item: Detail = { id: 'movie', libraryId: 'library', kind: 'movie', title: '本地标题', parentId: null, metadata: {}, overrides: {}, children: [], editions: [] };
const click = async (label: string) => {
  const button = Array.from(root.querySelectorAll('button')).find(b => b.textContent === label)!;
  expect(button).toBeTruthy();
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  await act(async () => { button.click(); });
};
afterEach(() => { act(() => render(null, root)); });

describe('media metadata review', () => {
  it('keeps long candidate descriptions readable on demand and selection does not apply a match',async()=>{
    const description='完整的候选说明与来源资料。'.repeat(40),onUpdated=vi.fn();
    const request=vi.fn(async(path:string)=>path==='metadata/providers'?{items:[{id:'tmdb',label:'TMDB',kinds:['movie'],configured:true}]}:{items:[{candidateId:'long',provider:'tmdb',externalId:'42',title:'长候选',description}]});
    await act(async()=>render(<MetadataMatcher api={{request} as unknown as MediaApi} item={item} onUpdated={onUpdated} layout="page"/>,root));
    await vi.waitFor(()=>expect(root.querySelector('.media-match-description')).not.toBeNull());
    const disclosure=root.querySelector<HTMLDetailsElement>('.media-match-description')!;expect(disclosure.open).toBe(false);expect(disclosure.querySelector('p')!.textContent).toBe(description);
    expect(root.querySelector('.media-match-copy>small:last-of-type')!.textContent!.length).toBeLessThanOrEqual(161);
    await click('选择');expect(root.querySelector('[aria-label="确认元数据匹配"]')).not.toBeNull();expect(onUpdated).not.toHaveBeenCalled();expect(request.mock.calls.every(call=>(call as unknown[])[1]==='GET')).toBe(true);
  });
  it('continues loading while source discovery is pending after saved candidates fail',async()=>{
    let release!:(value:unknown)=>void;
    const request=vi.fn((path:string)=>path==='metadata/providers'?new Promise(resolve=>release=resolve):Promise.reject(new Error('saved read failed')));
    await act(async()=>render(<MetadataMatcher api={{request} as unknown as MediaApi} item={item} onUpdated={vi.fn()}/>,root));
    expect(root.querySelector('[aria-busy=true]')).not.toBeNull();expect(root.textContent).not.toContain('当前作品暂无支持');
    await act(async()=>release({items:[{id:'tmdb',label:'TMDB',kinds:['movie'],configured:false}]}));
    await vi.waitFor(()=>expect(root.querySelector('[aria-busy=true]')).toBeNull());expect(root.querySelector('[role=alert]')?.textContent).toContain('读取已存候选失败');
    expect([...root.querySelectorAll('button')].find(button=>button.textContent==='搜索候选')!.disabled).toBe(true);
  });
  it('sends an optional artist constraint and allows clearing it without changing metadata',async()=>{
    const request=vi.fn(async(path:string)=>path==='metadata/providers'?{items:[{id:'musicbrainz',label:'MusicBrainz',kinds:['track'],configured:true}]}:{items:[]});
    const onUpdated=vi.fn();
    await act(async()=>render(<MetadataMatcher api={{request} as unknown as MediaApi} item={{...item,kind:'track',title:'Yesterday'}} onUpdated={onUpdated}/>,root));
    await vi.waitFor(()=>expect(root.querySelector('[aria-label="刮削艺人限定"]')).not.toBeNull());
    const input=root.querySelector<HTMLInputElement>('[aria-label="刮削艺人限定"]')!;
    await act(async()=>{input.value=' The Beatles ';input.dispatchEvent(new Event('input',{bubbles:true}));});
    await click('搜索候选');
    expect(request).toHaveBeenCalledWith('items/movie/matches','POST',{provider:'musicbrainz',query:'Yesterday',artist:'The Beatles'},expect.any(AbortSignal));
    await act(async()=>{input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));});
    await click('搜索候选');
    expect(request).toHaveBeenLastCalledWith('items/movie/matches','POST',{provider:'musicbrainz',query:'Yesterday'},expect.any(AbortSignal));
    expect(onUpdated).not.toHaveBeenCalled();
  });
  it.each(['metadata/providers','items/movie/matches'])('recovers %s without searching or mutating and preserves the typed query',async failingPath=>{
    let failed=false;
    const request=vi.fn(async(path:string,_method:string)=>{
      if(path===failingPath&&!failed){failed=true;throw Error('network unavailable');}
      return path==='metadata/providers'?{items:[{id:'tmdb',label:'TMDB',kinds:['movie'],configured:true}]}:{items:[{candidateId:'saved',provider:'tmdb',externalId:'42',title:'已存候选'}]};
    });
    await act(async()=>render(<MetadataMatcher api={{request} as unknown as MediaApi} item={item} onUpdated={()=>{}}/>,root));
    await vi.waitFor(()=>expect(root.querySelector('summary')?.textContent).toContain('读取失败'));
    await act(async()=>{const input=root.querySelector('input')!;input.value='保留搜索词';input.dispatchEvent(new Event('input',{bubbles:true}));});
    await click('重试读取来源与候选');
    await vi.waitFor(()=>expect(root.querySelector('summary')?.textContent).toContain('1 个候选待核对'));
    expect(root.querySelector('input')?.value).toBe('保留搜索词');
    expect(root.querySelector('[role=alert]')).toBeNull();
    expect(request.mock.calls.every(call=>['metadata/providers','items/movie/matches'].includes(call[0]))).toBe(true);
    expect(request.mock.calls.every(call=>call[1]==='GET')).toBe(true);
  });
  it('ignores a late saved-candidate failure after a successful explicit search',async()=>{
    let rejectSaved!:(error:Error)=>void;
    const request=vi.fn(async(path:string,method:string)=>{
      if(path==='metadata/providers')return {items:[{id:'tmdb',label:'TMDB',kinds:['movie'],configured:true}]};
      if(method==='GET')return new Promise((_resolve,reject)=>{rejectSaved=reject;});
      return {items:[{candidateId:'fresh',provider:'tmdb',externalId:'42',title:'新候选'}]};
    });
    await act(async()=>render(<MetadataMatcher api={{request} as unknown as MediaApi} item={item} onUpdated={()=>{}}/>,root));
    await vi.waitFor(()=>expect(root.querySelector('select')?.value).toBe('tmdb'));
    await act(async()=>{root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    await vi.waitFor(()=>expect(root.textContent).toContain('新候选'));
    await act(async()=>rejectSaved(Error('late failure')));
    expect(root.querySelector('summary')?.textContent).not.toContain('读取失败');
    expect(root.querySelector('[role=alert]')).toBeNull();
  });
  it('keeps the chosen source when saved previews arrive after a source change', async () => {
    let release!: (value: unknown) => void;
    const request = vi.fn(async (path: string) => {
      if (path === 'metadata/providers') return { items: ['first', 'second'].map(id => ({ id, label: id, kinds: ['movie'], configured: true })) };
      return new Promise(resolve => { release = resolve; });
    });
    await act(async () => render(<MetadataMatcher api={{request} as unknown as MediaApi} item={item} onUpdated={()=>{}}/>, root));
    await vi.waitFor(() => expect(root.querySelector('select')?.value).toBe('first'));
    await act(async () => {
      const select = root.querySelector('select')!;
      select.value = 'second'; select.dispatchEvent(new Event('change', { bubbles: true }));
      release({ items: [{ candidateId: 'old', provider: 'first', externalId: '42', title: '旧候选' }] });
    });
    expect(root.querySelector('select')?.value).toBe('second');
    expect(root.textContent).not.toContain('旧候选');
  });

  it('restores the candidate source after delayed provider discovery and advertises review outside the collapsed panel', async () => {
    let release!: (value: unknown) => void;
    const request = vi.fn(async (path: string) => {
      if (path === 'metadata/providers') return new Promise(resolve => { release = resolve; });
      return { items: [{ candidateId: 'saved', provider: 'second', externalId: '42', title: '已保存候选' }] };
    });
    await act(async () => render(<MetadataMatcher api={{request} as unknown as MediaApi} item={item} onUpdated={()=>{}}/>, root));
    await act(async () => release({ items: ['first', 'second'].map(id => ({ id, label: id, kinds: ['movie'], configured: true })) }));
    await vi.waitFor(() => expect(root.querySelector('select')?.value).toBe('second'));
    expect(root.querySelector('summary')?.textContent).toContain('1 个候选待核对');
    expect(root.querySelector('details')?.open).toBe(false);
    await click('预览匹配');
    expect(root.textContent).toContain('将“本地标题”匹配为“已保存候选”');
  });

  it('does not replace freshly searched candidates with a late saved preview',async()=>{
    let release!:(value:unknown)=>void;
    const request=vi.fn(async(path:string,method:string)=>{
      if(path==='metadata/providers')return {items:[{id:'tmdb',label:'TMDB',kinds:['movie'],configured:true}]};
      if(method==='GET')return new Promise(resolve=>{release=resolve;});
      return {items:[{candidateId:'new',provider:'tmdb',externalId:'43',title:'新候选'}]};
    });
    await act(async()=>render(<MetadataMatcher api={{request} as unknown as MediaApi} item={item} onUpdated={()=>{}}/>,root));
    await vi.waitFor(()=>expect(root.querySelector('select')?.value).toBe('tmdb'));
    await act(async()=>{root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    await vi.waitFor(()=>expect(root.textContent).toContain('新候选'));
    await act(async()=>release({items:[{candidateId:'old',provider:'tmdb',externalId:'42',title:'旧候选'}]}));
    expect(root.textContent).not.toContain('旧候选');expect(root.textContent).toContain('新候选');
  });
  it('clears the previous review and query when navigating to another work', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === 'metadata/providers') return { items: [{ id: 'tmdb', label: 'TMDB', kinds: ['movie'], configured: true }] };
      if (path === 'items/movie/matches') return { items: [{ candidateId: 'saved', provider: 'tmdb', externalId: '42', title: '旧作品候选' }] };
      return { items: [] };
    });
    const api = { request } as unknown as MediaApi;
    await act(async () => render(<MetadataMatcher api={api} item={item} onUpdated={()=>{}}/>, root));
    await vi.waitFor(() => expect(root.textContent).toContain('旧作品候选'));
    await click('预览匹配');
    await act(async () => render(<MetadataMatcher api={api} item={{...item, id: 'next', title: '下一作品'}} onUpdated={()=>{}}/>, root));
    await vi.waitFor(() => expect(root.querySelector('input')?.value).toBe('下一作品'));
    expect(root.textContent).not.toContain('旧作品候选');
    expect(root.querySelector('[aria-label="确认元数据匹配"]')).toBeNull();
    expect(root.querySelector('summary')?.textContent).not.toContain('候选待核对');
  });
  it('requires an explicit confirmation and retains candidates after a recoverable failure', async () => {
    let fail = true;
    const updated = vi.fn();
    const request = vi.fn(async (path: string, method: string) => {
      if (path === 'metadata/providers') return { items: [{ id: 'tmdb', label: 'TMDB', kinds: ['movie'], configured: true }] };
      if (path.endsWith('/matches')) return { items: [{ candidateId: 'candidate', provider: 'tmdb', externalId: '42', title: '在线标题', year: 2024, description: '<script>bad()</script>' }] };
      if (method === 'PUT' && fail) { fail = false; throw new Error('临时连接错误'); }
      return { ...item, title: '在线标题' };
    });
    await act(async () => { render(<MetadataMatcher api={{ request } as unknown as MediaApi} item={item} onUpdated={updated}/>, root); });
    await act(async () => { root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(request.mock.calls.filter(call => call[1] === 'PUT')).toHaveLength(0);
    expect(root.querySelector('script')).toBeNull();
    await click('预览匹配');
    expect(root.textContent).toContain('将“本地标题”匹配为“在线标题”');
    await click('确认此匹配');
    expect(root.querySelector('[role=alert]')!.textContent).toContain('临时连接错误');
    expect(updated).not.toHaveBeenCalled();
    await click('确认此匹配');
    expect(updated).toHaveBeenCalledWith(expect.objectContaining({ title: '在线标题' }));
    expect(root.querySelector('[aria-label="确认元数据匹配"]')).toBeNull();
  });

  it('aborts an in-flight request when leaving the detail screen', async () => {
    let requestSignal: AbortSignal | undefined;
    const request = vi.fn(async (_path, _method, _body, signal) => {
      requestSignal = signal;
      return new Promise(() => {});
    });
    await act(async () => { render(<MetadataMatcher api={{ request } as unknown as MediaApi} item={item} onUpdated={() => {}}/>, root); });
    expect(requestSignal?.aborted).toBe(false);
    act(() => render(null, root));
    expect(requestSignal?.aborted).toBe(true);
  });
});
