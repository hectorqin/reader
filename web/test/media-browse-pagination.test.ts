// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {MediaScreen} from '../src/media/screen.tsx';

for(const libraryId of ['','music-lib'])it(`bounds repeated shrink recovery for ${libraryId||'all libraries'}`,async()=>{
  const filters={artist:'artist',album:'album'},read=vi.fn()
    .mockResolvedValueOnce({items:[],total:70})
    .mockResolvedValueOnce({items:[],total:30})
    .mockResolvedValueOnce({items:[{id:'remaining'}],total:30});
  const context={catalogRequest:0,draw:vi.fn(),foldersOpen:false,kind:'track',libraries:[{id:'music-lib'}],libraryId,channel:'music',query:'',offset:180,trackSort:'title-desc',trackFilters:filters,abort:new AbortController(),api:{items:read,browse:read},items:[],total:0};
  await Reflect.apply(Reflect.get(MediaScreen.prototype,'load'),context,[]);
  const offsetIndex=libraryId?3:2;
  expect(read.mock.calls.map(call=>call[offsetIndex])).toEqual([180,60,0]);
  expect(read.mock.calls.every(call=>call.at(-1)===filters)).toBe(true);
  expect(context.offset).toBe(0);expect(context.items).toEqual([{id:'remaining'}]);expect(context.total).toBe(30);
});
it('does not discard results or pretend an empty library when the recovery request fails',async()=>{
  const read=vi.fn().mockResolvedValueOnce({items:[],total:0}).mockRejectedValueOnce(new Error('offline'));
  const context={catalogRequest:0,draw:vi.fn(),foldersOpen:false,kind:'track',libraries:[{id:'music-lib'}],libraryId:'',channel:'music',offset:60,trackSort:'default',trackFilters:{},abort:new AbortController(),api:{browse:read},items:[{id:'old'}],total:65};
  await expect(Reflect.apply(Reflect.get(MediaScreen.prototype,'load'),context,[])).rejects.toThrow('offline');
  expect(context.items).toEqual([{id:'old'}]);expect(context.total).toBe(65);expect(context.offset).toBe(0);
});
