import type {Item} from './api.ts';

const labels:Record<string,string>={filename:'文件名识别',tag:'内嵌标签',nfo:'本地 NFO',tmdb:'TMDB',musicbrainz:'MusicBrainz'};
export function MetadataSources({item}:{item:Item}){
  const sources=item.metadata.sources;
  const values=sources&&typeof sources==='object'&&!Array.isArray(sources)?Object.values(sources):[];
  const names=[...new Set(values.filter((value):value is string=>typeof value==='string').map(value=>labels[value]||'其它来源'))];
  const corrected=Object.keys(item.overrides).length>0;
  return <p className="media-metadata-sources">资料来源：{[...names,...(corrected?['人工修正']:[])].join(' · ')||'暂无来源记录'}</p>;
}
