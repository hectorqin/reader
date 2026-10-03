import type {Item} from '../api/media-api.ts';

const types:Record<string,string>={Person:'个人',Group:'组合',Orchestra:'管弦乐团',Choir:'合唱团',Character:'虚构角色',Other:'其他'};
export function ArtistInfo({item}:{item:Item}){
  if(item.kind!=='artist')return null;
  const value=(key:string)=>typeof item.metadata[key]==='string'?String(item.metadata[key]).trim():'';
  const type=value('artistType'),area=value('artistArea'),note=value('artistDisambiguation');
  if(!type&&!area&&!note)return null;
  return <section className="media-artist-info" aria-label="艺人资料"><h2>艺人资料</h2><dl>{type&&<><dt>类型</dt><dd>{types[type]||type}</dd></>}{area&&<><dt>关联地区</dt><dd>{area}</dd></>}{note&&<><dt>同名区分说明</dt><dd>{note}</dd></>}</dl></section>;
}
