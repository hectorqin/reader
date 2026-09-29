import {posix} from 'node:path';
import type {LocalMediaMetadata} from './local-metadata.ts';

export type VideoRuleMode='auto'|'movie'|'series'|'season'|'ignore';
export interface VideoRule {
  path:string;
  mode:VideoRuleMode;
  title?:string;
  season?:number|string;
  year?:number;
  stripLeadingNumber?:boolean;
  /** Optional filename regexp. Named groups are copied to media metadata. */
  filePattern?:string;
}
export interface VideoRecognition {kind:'movie'|'episode'|'ignore';confidence:'high'|'review';reasons:string[];metadata:LocalMediaMetadata}
export const withinDirectory=(ref:string,path:string)=>!path||ref.startsWith(path+'/');

const PATTERN_FIELDS=new Set(['title','name','show','year','season','episode','order','track','disc','artist','album','author','narrator','edition']);
const numericPatternFields=new Set(['year','episode','order','track','disc']);

function applyFilePattern(ref:string,metadata:LocalMediaMetadata,rule:VideoRule|undefined):LocalMediaMetadata {
  if(!rule?.filePattern)return metadata;
  let expression:RegExp;
  try{expression=new RegExp(rule.filePattern,'i');}catch{return metadata;}
  const match=expression.exec(posix.basename(ref));
  if(!match?.groups)return metadata;
  const result:LocalMediaMetadata={...metadata,sources:{...metadata.sources}};
  for(const [rawName,value] of Object.entries(match.groups)){
    const name=rawName==='name'?'title':rawName==='order'?(rule.mode==='series'||rule.mode==='season'?'episode':'track'):rawName;
    if(!value?.trim())continue;
    if(!PATTERN_FIELDS.has(rawName)){
      result.attributes={...(result.attributes??{}),[rawName]:value.trim().slice(0,32000)};
      continue;
    }
    const text=value.trim();
    const numeric=numericPatternFields.has(rawName)||numericPatternFields.has(name);
    const parsed=numeric?Number(text):text;
    if(numeric&&(!Number.isSafeInteger(parsed as number)||(parsed as number)<0||(parsed as number)>100000))continue;
    (result as unknown as Record<string,unknown>)[name]=parsed;
    (result.sources as Record<string, 'filename'|'tag'|'nfo'|'rule'>)[name]='rule';
  }
  return result;
}

function number(text:string):number|undefined{
  if(/^\d+$/.test(text))return Number(text);
  const digits:Record<string,number>={'零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
  let result=0,current=0;
  for(const character of text){if(character in digits)current=digits[character]!;else if(character==='十'||character==='百'){result+=(current||1)*(character==='十'?10:100);current=0;}else return undefined;}
  return text?result+current:undefined;
}
export function seasonDirectory(name:string):number|undefined{
  const match=/(?:season[ ._-]*|s)(\d{1,3})$/i.exec(name)||/([零〇一二两三四五六七八九十百\d]+)季$/.exec(name);
  if(match)return number(match[1]!);
  if(/^(specials?|特别篇|特別篇)$/i.test(name))return 0;
  return undefined;
}

/** Recognized release tokens are removed only at boundaries; title numerals stay intact. */
export function cleanVideoTitle(input:string,stripLeadingNumber=false){
  const removed:string[]=[];
  let value=input.replace(/\[[^\]]*\]|【[^】]*】|\([^)]*\)/g,token=>{
    if(/(?:字幕组|字幕組|整理组|发布组|压制组|www\.|https?:|^\[[a-f\d]{8}\]$)/i.test(token)){removed.push(token);return ' ';}return token;
  });
  value=value.replace(/(?:^|[ ._\-[\]【】()])(?:\d{3,4}[pi]|4k|8k|uhd|web[ ._-]?(?:dl|rip)|blu[ ._-]?ray|b[dr]rip|hdtv|dvdrip|remux|[hx][ ._-]?26[45]|hevc|avc|av1|hdr10\+?|hdr|dolby[ ._-]?vision|dts(?:[ ._-]?hd)?|aac|ac3|eac3|truehd|ddp?(?:[ .]?\d[ .]\d)?|10bit|8bit)(?=$|[ ._\-[\]【】()])/gi,token=>{removed.push(token.trim());return ' ';});
  // Dotted separators are common release naming, but decimal titles are preserved.
  value=value.replace(/(?<!\d)\.|\.(?!\d)|_/g,' ').replace(/\[\s*\]|【\s*】|\(\s*\)/g,' ');
  if(stripLeadingNumber){
    value=value.replace(/^\s*(?:\[\d{1,4}\]|【\d{1,4}】|\d{1,4}[ ._-]+|\d{1,4}(?=[\u3400-\u9fff]))\s*/,token=>{removed.push(token.trim());return '';});
    value=value.replace(/\s+-\s+\d{1,4}\s*$/,'');
  }
  return {title:value.replace(/\s+/g,' ').replace(/^[\s.-]+|[\s.-]+$/g,'').trim(),removed};
}

export function recognizeVideo(ref:string,raw:LocalMediaMetadata,rules:VideoRule[],fallbackEpisode?:number):VideoRecognition{
  const metadata:LocalMediaMetadata={...raw,sources:{...raw.sources},externalIds:{...raw.externalIds},warnings:[...raw.warnings]};
  const inherited=rules.filter(rule=>withinDirectory(ref,rule.path)).sort((a,b)=>a.path.length-b.path.length),rule=inherited.at(-1);
  const effectiveRule=rule;
  const patterned=applyFilePattern(ref,metadata,effectiveRule);
  Object.assign(metadata,patterned);metadata.sources=patterned.sources;
  const reasons:string[]=[],mode=effectiveRule?.mode??'auto';
  if(mode==='ignore')return {kind:'ignore',confidence:'high',reasons:['目录已设为忽略'],metadata};
  const stem=posix.basename(ref,posix.extname(ref)),dir=posix.dirname(ref),segments=dir==='.'?[]:dir.split('/');
  const seasonIndex=segments.findLastIndex(segment=>seasonDirectory(segment)!==undefined),directorySeason=seasonIndex>=0?seasonDirectory(segments[seasonIndex]!):undefined;
  let seriesRoot=raw.seriesRoot??(seasonIndex>=0?segments.slice(0,seasonIndex).join('/'):dir==='.'?'':dir);
  const seriesRule=mode==='series'?rule:mode==='season'?inherited.slice(0,-1).reverse().find(value=>value.mode==='series'):undefined;
  if(seriesRule)seriesRoot=seriesRule.path;
  if(mode==='season'&&!seriesRule)seriesRoot=posix.dirname(effectiveRule!.path)==='.'?'':posix.dirname(effectiveRule!.path);
  const patterns=[/(?:^|[ ._-])S(\d{1,3})[ ._-]*E(\d{1,4})(?=$|[ ._-]|E\d)/i,/(?:^|[ ._-])(\d{1,3})x(\d{1,4})(?=$|[ ._-])/i,/第([零〇一二两三四五六七八九十百\d]+)季[ ._-]*第?([零〇一二两三四五六七八九十百\d]+)[集话話]/,/第([零〇一二两三四五六七八九十百\d]+)季[ ._-]*(\d{1,4})(?=$|[ ._-])/i,/(?:^|[ ._-])SE(\d{1,3})[ ._-]+(\d{1,4})(?=$|[ ._-])/i];
  const match=patterns.map(pattern=>pattern.exec(stem)).find(Boolean);
  let season:number|string|undefined=metadata.season??(match?number(match[1]!):directorySeason),episode=metadata.episode??(match?number(match[2]!):undefined);
  const discTitle=/^(.*?)(?:CD|DISC|DISK|盘)[ ._-]*(\d{1,3})\s*[=:：-]\s*(.+)$/i.exec(stem);
  const single=/(?:^|[ ._-])(?:EP?|第)[ ._-]*([零〇一二两三四五六七八九十百\d]+)(?:[集话話])?(?=$|[ ._-])/i.exec(stem);
  const bare=/^\s*(\d{1,4})(?=$|[ ._-])/.exec(stem);
  const trailing=/(?:^|[ ._-])(?:-|集)?\s*(\d{1,4})\s*$/i.exec(stem);
  if(episode===undefined&&(directorySeason!==undefined||raw.sources.season==='nfo'||mode==='series'||mode==='season'))episode=number((single||bare||trailing)?.[1]??'') ?? (fallbackEpisode&&fallbackEpisode>0?fallbackEpisode:undefined);
  if(mode==='series'||mode==='season'){season=mode==='season'?effectiveRule?.season:effectiveRule?.season??directorySeason??'正片';reasons.push('目录规则');}
  const multi=/(?:S\d{1,3}[ ._-]*)?E\d{1,4}(?:[ ._-]*E\d{1,4}|-\d{1,3})(?=$|[ ._-])/i.test(stem)||/第?[\d一二三四五六七八九十]+[-~至到][\d一二三四五六七八九十]+集/.test(stem);
  let cleanedStem=match&&!multi?stem.slice(0,match.index):stem;
  if(metadata.sources.title==='rule'&&metadata.title)cleanedStem=metadata.title;
  if(discTitle)cleanedStem=discTitle[3]!;
  if(raw.sources.year==='filename'){delete metadata.year;delete metadata.sources.year;}
  const yearMatch=/(?:[ ._(\[])(19\d{2}|20\d{2})(?=$|[ ._)\]])/.exec(cleanedStem);
  if(yearMatch){metadata.year??=Number(yearMatch[1]);cleanedStem=cleanedStem.replace(yearMatch[1]!,' ');}
  const cleaned=cleanVideoTitle(cleanedStem,effectiveRule?.stripLeadingNumber);
  if(cleaned.removed.length)reasons.push('移出技术/发布标记：'+cleaned.removed.join('、'));
  const parentTitle=cleanVideoTitle(posix.basename(seriesRoot),effectiveRule?.stripLeadingNumber).title;
  let show=match?cleaned.title:parentTitle;
  if(raw.seriesRoot||directorySeason!==undefined)show=parentTitle||show;
  if(!show||/^(?:season[ ._-]*\d+|s\d+)$/i.test(show))show=parentTitle;
  if(raw.sources.show==='nfo'&&raw.show)show=raw.show;
  if(raw.sources.season==='nfo')season=raw.season;
  if(raw.sources.episode==='nfo')episode=raw.episode;
  if(mode==='series'||mode==='season'){
    show=effectiveRule?.title||seriesRule?.title||parentTitle||show;
    season=mode==='season'?effectiveRule?.season:effectiveRule?.season??directorySeason??'正片';
  }
  if(effectiveRule?.year!==undefined){metadata.year=effectiveRule.year;metadata.sources.year='rule';}
  // A directory explicitly marked as a series/season owns every supported file.
  // A multi-episode filename still becomes one ordered episode; it is not a movie.
  const episodic=mode!=='movie'&&!!show&&season!==undefined&&episode!==undefined&&episode>0&&(mode==='series'||mode==='season'||!multi);
  let confidence:'high'|'review'='high';
  if(episodic){
    metadata.show=show;metadata.season=season;metadata.episode=episode;metadata.seriesRoot=seriesRoot;
    if(metadata.sources.title==='filename')metadata.title=discTitle?.[3]?.trim()||`第 ${episode} 集`;
    reasons.push(raw.sources.episode==='nfo'?'NFO 季集信息':match?'文件名季集编号':discTitle?'目录规则与文件顺序':'季目录与集号');
    metadata.sources.show=mode==='series'||mode==='season'?'rule':raw.sources.show==='nfo'?'nfo':'filename';
  }else{
    delete metadata.show;delete metadata.season;delete metadata.episode;delete metadata.seriesRoot;
    if(raw.sources.title==='filename')metadata.title=cleaned.title||cleanVideoTitle(stem).title||stem;
    if(mode==='series'||mode==='season'||directorySeason!==undefined||match||multi||/^(?:EP?\d+|\d+)$/i.test(stem)){confidence='review';reasons.push(multi&&!(['series','season'] as VideoRuleMode[]).includes(mode)?'多集合集，不自动拆分':'缺少可靠的剧名或季集编号');}
    else reasons.push(mode==='movie'?'目录指定电影':'独立电影');
  }
  if(/^(?:\[\d+\]|\d{1,4}[ ._-])/.test(stem)&&!episodic&&!effectiveRule?.stripLeadingNumber){confidence='review';reasons.push('前缀数字可能属于片名，保留待确认');}
  if(!metadata.title.trim()||metadata.title.length>200)confidence='review';
  metadata.recognition={confidence,reasons,kind:episodic?'episode':'movie'};
  return {kind:episodic?'episode':'movie',confidence,reasons,metadata};
}
