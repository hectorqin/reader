import {expect,it,vi} from 'vitest';
import {restorePlaybackEntries} from '../src/media/restore-playback.ts';
import type {MediaApi,Detail} from '../src/media/api.ts';
const part=(id:string,available=true)=>({id,assetId:id,title:id,available,start:0,end:100});
const item:Detail={id:'book',libraryId:'library',kind:'audiobook',title:'故事',parentId:null,metadata:{},overrides:{},children:[],editions:[{id:'original',label:'原版',parts:[part('original')]},{id:'selected',label:'新版',parts:[part('first'),part('missing',false),part('current')]}]};
it('restores the exact version and part from current library data',async()=>{
  const detail=vi.fn().mockResolvedValue(item),signal=new AbortController().signal;
  const result=await restorePlaybackEntries({detail} as unknown as MediaApi,'book','current',signal);
  expect(detail).toHaveBeenCalledWith('book',signal);expect(result.index).toBe(1);
  expect(result.entries.map(entry=>entry.part.id)).toEqual(['first','current']);expect(result.entries.every(entry=>!entry.video)).toBe(true);
});
it.each(['deleted','missing'])('does not substitute another version for an unavailable %s part',async id=>{
  await expect(restorePlaybackEntries({detail:async()=>item} as unknown as MediaApi,'book',id,new AbortController().signal)).rejects.toThrow(/变化|丢失/);
});
it('propagates revoked access instead of restoring unverified saved data',async()=>{
  await expect(restorePlaybackEntries({detail:async()=>{throw new Error('access denied');}} as unknown as MediaApi,'book','current',new AbortController().signal)).rejects.toThrow('access denied');
});
