import type { Edition,Item } from '../api/media-api.ts';
import { Link } from 'react-router-dom';

const kindLabels: Record<string, string> = {
  movie: '电影', series: '剧集', season: '季', episode: '单集',
  artist: '音乐人', album: '专辑', track: '曲目', audiobook: '有声书',
};

export function mediaDetailLabel(kind:string){
  return ({movie:'电影详情',series:'剧集详情',season:'剧集选集',episode:'单集详情',artist:'歌手详情',album:'专辑详情',track:'曲目详情',audiobook:'有声书详情'} as Record<string,string>)[kind]||'作品详情';
}

export function MediaDetailHeading({ item,edition,trackCount,seasonCount }: { item: Item;libraryName?:string|undefined;edition?:Edition;trackCount?:number;seasonCount?:number }) {
  const field = (key: string) => item.overrides[key] ?? item.metadata[key];
  const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const credit = item.kind === 'audiobook' ? text(field('author'))
    : ['track', 'album'].includes(item.kind) ? (text(field('artist')) || text(field('albumArtist'))) : '';
  const year = text(field('year'));
  const narrator=item.kind==='audiobook'?text(field('narrator')):'';
  const credits=[credit&&item.kind!=='album'?(item.kind==='audiobook'?credit+' 著':credit):'',narrator?narrator+' 演播':'',year,text(field('genre')),trackCount!==undefined?trackCount+' 首':'',seasonCount!==undefined?seasonCount+' 季':''].filter(Boolean);
  const knownDuration=edition?.parts.length&&edition.parts.every(part=>part.end!==null&&Number.isFinite(part.end)&&part.end>=part.start)?edition.parts.reduce((sum,part)=>sum+part.end!-part.start,0):null;
  const minutes=knownDuration===null?0:Math.floor(knownDuration/60);
  const duration=knownDuration===null?'':minutes>=60?Math.floor(minutes/60)+' 小时'+(minutes%60?' '+minutes%60+' 分':''):minutes?minutes+' 分':Math.floor(knownDuration)+' 秒';
  return <div className="media-detail-heading">
    {kindLabels[item.kind] && <small className="media-detail-kind">{kindLabels[item.kind]}</small>}
    <h1>{item.title}</h1>
    {item.kind==='album'&&credit&&<p className="media-detail-artist">{item.parentId?<Link to={'/media/music/items/'+encodeURIComponent(item.parentId)}>{credit} <span aria-hidden="true">›</span></Link>:credit}</p>}
    {!!credits.length&&<p className="media-detail-credit">{credits.join(' · ')}</p>}
    {edition&&<div className="media-detail-facts">{item.kind==='audiobook'&&<span>{edition.parts.length} 章</span>}{duration&&<span>{duration}</span>}{text(field('country'))&&<span>{text(field('country'))}</span>}</div>}
  </div>;
}
