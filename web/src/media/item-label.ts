import type {Item} from './api.ts';

export function itemLabel(item:Item):string {
  const field=(name:string)=>{
    const value=item.overrides[name]??item.metadata[name];
    return Array.isArray(value)?value.filter(v=>typeof v==='string').join(' / '):typeof value==='string'||typeof value==='number'?String(value):'';
  };
  const fields=item.kind==='audiobook'?['narrator','author']:['album','track'].includes(item.kind)?['artist',...(item.kind==='track'?['album']:[])]:['year','genre'];
  return fields.map(name=>name==='artist'?field('artist')||field('albumArtist'):field(name)).filter(Boolean).join(' · ');
}
