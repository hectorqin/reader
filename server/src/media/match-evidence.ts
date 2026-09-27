import type { MediaItem } from './catalog.ts';
import type { MetadataCandidate } from './metadata-providers.ts';

// Keep digits and words: removing edition numbers can conflate sequels and recordings.
const normalize=(value:unknown)=>typeof value==='string'?value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\p{P}\p{Z}\s]+/gu,'').trim():'';
export function matchEvidence(item:MediaItem,candidate:MetadataCandidate) {
  const reasons:string[]=[];
  const title=normalize(item.title),sameTitle=!!title&&title===normalize(candidate.title);
  reasons.push(sameTitle?'标题一致':'标题不一致');
  const year=item.overrides.year??item.metadata.year;
  const hasYear=typeof year==='number'&&Number.isInteger(year)&&typeof candidate.year==='number';
  const yearMatch=hasYear&&year===candidate.year;
  if(hasYear)reasons.push(yearMatch?'年份一致':'年份冲突');else reasons.push('年份信息不足');
  const artist=normalize(item.overrides.albumArtist??item.overrides.artist??item.metadata.albumArtist??item.metadata.artist);
  const candidateArtist=normalize(candidate.artist);
  const hasArtist=!!artist&&!!candidateArtist,artistMatch=hasArtist&&artist===candidateArtist;
  if(hasArtist)reasons.push(artistMatch?'艺人一致':'艺人冲突');
  const conflict=(hasYear&&!yearMatch)||(hasArtist&&!artistMatch);
  const video=item.kind==='movie'||item.kind==='series';
  const supported=video||item.kind==='album'||item.kind==='track';
  // A name alone never qualifies; audiobooks need edition/narrator evidence not supplied by these candidates.
  const strong=supported&&sameTitle&&!conflict&&(video?yearMatch:artistMatch&&yearMatch);
  return {level:conflict?'conflict':strong?'strong':'review',reasons} as const;
}
