import {expect,it} from 'vitest';
import {seasonQueue,type SeasonEpisode} from '../src/features/media/components/season-playback.tsx';
const episode=(id:string,versions=1,available=true):SeasonEpisode=>({id,title:id,editions:Array.from({length:versions},(_,index)=>({id:id+index,label:'版本'+index,parts:[{id:id+'part'+index,assetId:id,title:id,start:0,end:30,available}]}))});
it('keeps episode and file order from the selected starting episode',()=>{
  const result=seasonQueue([episode('01'),episode('02'),episode('03')],1,{});
  expect(result.entries.map(e=>e.part.id)).toEqual(['02part0','03part0']);expect(result.count).toBe(2);
});
it('stops before an ambiguous edition and includes it only after an explicit choice',()=>{
  const episodes=[episode('01'),episode('02',2),episode('03')];
  expect(seasonQueue(episodes,0,{}).entries).toHaveLength(1);
  expect(seasonQueue(episodes,0,{}).notice).toContain('选择版本');
  expect(seasonQueue(episodes,0,{'02':'021'}).entries.map(e=>e.part.id)).toEqual(['01part0','02part1','03part0']);
});
it('does not skip unavailable episodes or play an incomplete multi-file edition',()=>{
  const broken=episode('02');broken.editions[0]!.parts.push({...broken.editions[0]!.parts[0]!,id:'missing',available:false});
  expect(seasonQueue([episode('01'),broken,episode('03')],0,{}).count).toBe(1);
  expect(seasonQueue([broken],0,{}).notice).toContain('资源不完整');
});
