// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { render } from '../src/ui/vendor/preact.ts';
import { MediaCover } from '../src/media/cover.tsx';
import type { Item, MediaApi } from '../src/media/api.ts';
import { ApiError } from '../src/api/errors.ts';

const host=document.createElement('div');document.body.append(host);
const item:Item={id:'item',libraryId:'lib',kind:'album',title:'Album',parentId:null,metadata:{coverRef:'cover.png'},overrides:{}};
afterEach(()=>{act(()=>render(null,host));vi.unstubAllGlobals();});
describe('media cover lifetime',()=>{
  it.each([['MEDIA_COVER_TIMEOUT','封面读取超时'],['MEDIA_COVER_NOT_FOUND','来源暂无封面'],['MEDIA_COVER_BUSY','封面服务繁忙'],['MEDIA_COVER_UPSTREAM','封面来源暂不可用']])('explains %s without displaying upstream details',async(code,label)=>{
    const cover=vi.fn().mockRejectedValue(new ApiError('server','private upstream URL',code,502));
    await act(async()=>render(<MediaCover api={{cover} as unknown as MediaApi} item={item} square retryable/>,host));
    await vi.waitFor(()=>expect(host.textContent).toContain(label));
    expect(host.textContent).not.toContain('private');expect(cover).toHaveBeenCalledTimes(1);
    await act(async()=>render(<MediaCover api={{cover} as unknown as MediaApi} item={item} square/>,host));
    expect(host.querySelector('button')).toBeNull();expect(host.textContent).not.toContain(label);
  });
  it('offers an explicit detail retry after a failed request and recovers the cover',async()=>{
    vi.stubGlobal('URL',{createObjectURL:()=> 'blob:retry',revokeObjectURL:vi.fn()});
    const cover=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Uint8Array([255,216,255]));
    await act(async()=>render(<MediaCover api={{cover} as unknown as MediaApi} item={item} square retryable/>,host));
    await vi.waitFor(()=>expect(host.textContent).toContain('封面加载失败'));
    expect(cover).toHaveBeenCalledTimes(1);
    await act(async()=>host.querySelector<HTMLButtonElement>('button')!.click());
    await vi.waitFor(()=>expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:retry'));
    expect(host.textContent).not.toContain('封面加载失败');expect(cover).toHaveBeenCalledTimes(2);
  });
  it('loads a MusicBrainz cover through the authenticated item endpoint',async()=>{
    vi.stubGlobal('URL',{createObjectURL:()=> 'blob:musicbrainz',revokeObjectURL:vi.fn()});
    const cover=vi.fn(async()=>new Uint8Array([255,216,255]));
    await act(async()=>render(<MediaCover api={{cover} as unknown as MediaApi} item={{...item,metadata:{musicBrainzCoverGroupId:'12345678-1234-1234-1234-123456789abc'}}} square/>,host));
    await vi.waitFor(()=>expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:musicbrainz'));
    expect(cover).toHaveBeenCalledWith('item',expect.any(AbortSignal));
  });
  it('loads an embedded album cover through the authenticated item endpoint',async()=>{
    vi.stubGlobal('URL',{createObjectURL:()=> 'blob:embedded',revokeObjectURL:vi.fn()});
    const cover=vi.fn(async()=>new Uint8Array([137,80,78,71]));
    await act(async()=>render(<MediaCover api={{cover} as unknown as MediaApi} item={{...item,metadata:{embeddedCoverAssetId:'asset'}}} square/>,host));
    await vi.waitFor(()=>expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:embedded'));
    expect(cover).toHaveBeenCalledWith('item',expect.any(AbortSignal));
  });
  it('loads a matched online poster through the same authenticated API',async()=>{
    vi.stubGlobal('URL',{createObjectURL:()=> 'blob:online',revokeObjectURL:vi.fn()});
    const cover=vi.fn(async()=>new Uint8Array([255,216,255]));
    await act(async()=>render(<MediaCover api={{cover} as unknown as MediaApi} item={{...item,metadata:{tmdbPosterPath:'/poster.jpg'}}} square/>,host));
    await vi.waitFor(()=>expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:online'));
    expect(cover).toHaveBeenCalledWith('item',expect.any(AbortSignal));
  });
  it('loads with the authenticated API and revokes the blob URL on unmount',async()=>{
    const createObjectURL=vi.fn(()=> 'blob:cover'),revokeObjectURL=vi.fn();
    vi.stubGlobal('URL',{createObjectURL,revokeObjectURL});
    const cover=vi.fn(async()=>new Uint8Array([137,80,78,71]));
    await act(async()=>{render(<MediaCover api={{cover} as unknown as MediaApi} item={item} square/>,host);});
    await vi.waitFor(()=>expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:cover'));
    expect(cover).toHaveBeenCalledWith('item',expect.any(AbortSignal));
    act(()=>render(null,host));expect(revokeObjectURL).toHaveBeenCalledWith('blob:cover');
  });
  it('does not create a blob from a late response after leaving the screen',async()=>{
    const createObjectURL=vi.fn(),revokeObjectURL=vi.fn();vi.stubGlobal('URL',{createObjectURL,revokeObjectURL});
    let finish!:(bytes:Uint8Array)=>void;
    const cover=vi.fn(()=>new Promise<Uint8Array>(resolve=>{finish=resolve;}));
    await act(async()=>{render(<MediaCover api={{cover} as unknown as MediaApi} item={item} square/>,host);});
    act(()=>render(null,host));
    await act(async()=>{finish(new Uint8Array([137]));});
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
