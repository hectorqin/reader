import { posix } from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { MediaStorage, StorageEntry } from './storage/types.ts';
import { isRemoteStorageFailure } from './storage/types.ts';
import type { ProbeResult } from './probe.ts';
import type { ArtistProfile } from './artist-metadata.ts';

export interface LocalMediaMetadata {
  artistProfile?:ArtistProfile;
  title: string;
  year?: number;
  plot?: string;
  show?: string;
  season?: number;
  episode?: number;
  artist?: string;
  albumArtist?: string;
  album?: string;
  author?: string;
  narrator?: string;
  edition?: string;
  track?: number;
  disc?: number;
  externalIds: Record<string, string>;
  sources: Record<string, 'filename' | 'tag' | 'nfo'>;
  coverRef?: string;
  embeddedCoverAssetId?: string;
  warnings: string[];
}

const text = (value: unknown): string | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const result = String(value).trim();
  return result ? result.slice(0, 32_000) : undefined;
};
const integer = (value: unknown): number | undefined => {
  const raw = text(value)?.split('/')[0];
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const number = Number(raw);
  return Number.isSafeInteger(number) && number <= 100_000 ? number : undefined;
};

/** Local sidecars are bounded, parsed without entities, and read through storage checks. */
export async function readLocalMetadata(storage: MediaStorage, ref: string, probe: ProbeResult): Promise<LocalMediaMetadata> {
  const dir = posix.dirname(ref);
  const sibling = (name: string) => dir === '.' ? name : `${dir}/${name}`;
  const stem = posix.basename(ref, posix.extname(ref));
  // Remote listings are scoped to one scan; local candidates still go through
  // fresh containment checks. Resolve remote URLs only when opening a sidecar.
  let names:Set<string>|undefined;
  let entries:Map<string,StorageEntry>|undefined;
  try{
    if(storage.filePath)names=await storage.siblingNames(ref);
    else{const listed=await storage.siblings(ref);entries=new Map(listed.map(entry=>[entry.ref,entry]));names=new Set(listed.map(entry=>entry.name));}
  }catch(error){if(isRemoteStorageFailure(error))throw error;/* Preserve individual local read errors. */}
  const stat=async(ref:string)=>entries?.get(ref)??await storage.stat(ref);
  const actualName=(name:string)=>!names||names.has(name)?name:[...names].find(value=>value.toLowerCase()===name.toLowerCase());
  const match = /^(.*?)(?:[ ._-]|^)S(\d{1,3})E(\d{1,4})(?=[ ._-]|$)/i.exec(stem);
  const year = /(?:^|[ ._(])(19\d{2}|20\d{2})(?:[ ._) ]|$)/.exec(stem);
  const metadata: LocalMediaMetadata = { title: stem.replace(/[._]/g, ' ').trim(), externalIds: {}, sources: {title:'filename'}, warnings: [] };
  if (match) {
    metadata.show = match[1]!.replace(/[._]/g, ' ').trim() || (dir === '.' ? undefined : posix.basename(dir));
    metadata.season = Number(match[2]); metadata.episode = Number(match[3]);
    metadata.sources.show = metadata.sources.season = metadata.sources.episode = 'filename';
  }
  if (year) { metadata.year = Number(year[1]); metadata.sources.year = 'filename'; }
  const tags = probe.info?.tags || {};
  for (const [field, value] of Object.entries({title:tags.title,artist:tags.artist,albumArtist:tags.album_artist || tags.albumartist,album:tags.album,author:tags.author,narrator:tags.narrator,edition:tags.edition,plot:tags.description})) {
    const parsed = text(value);
    if (parsed) { (metadata as unknown as Record<string,unknown>)[field] = parsed; metadata.sources[field] = 'tag'; }
  }
  for (const [field, value] of Object.entries({track:tags.track,disc:tags.disc,year:tags.date?.slice(0,4)})) {
    const parsed = integer(value);
    if (parsed !== undefined) { (metadata as unknown as Record<string,unknown>)[field] = parsed; metadata.sources[field] = 'tag'; }
  }
  for (const name of [`${stem}.nfo`, 'movie.nfo', 'tvshow.nfo', 'album.nfo', 'audiobook.nfo']) {
    const actual=actualName(name);if(!actual)continue;
    const sidecar = sibling(actual);
    try {
      const entry = await stat(sidecar);
      if (entry.size > 1024 * 1024) { metadata.warnings.push('nfo-too-large'); continue; }
      const {stream} = await storage.open(sidecar);
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > 1024 * 1024) { stream.destroy(); throw new Error('nfo-too-large'); }
        chunks.push(Buffer.from(chunk));
      }
      const xml = Buffer.concat(chunks).toString('utf8');
      if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('invalid-nfo');
      const parsed = new XMLParser({ignoreAttributes:false,processEntities:false,parseTagValue:false}).parse(xml);
      const node = parsed.movie || parsed.episodedetails || parsed.tvshow || parsed.album || parsed.audiobook;
      if (!node || typeof node !== 'object') continue;
      const showOnly = !!parsed.tvshow && !!match;
      for (const [field, value] of Object.entries({title:showOnly?undefined:node.title,plot:node.plot,show:showOnly?node.title:node.showtitle,artist:node.artist,albumArtist:node.albumartist,album:node.album,author:node.author,narrator:node.narrator,edition:node.edition})) {
        const valueText = text(value);
        if (valueText) { (metadata as unknown as Record<string,unknown>)[field] = valueText; metadata.sources[field] = 'nfo'; }
      }
      for (const field of ['year','season','episode','track','disc'] as const) {
        const value = integer(node[field]);
        if (value !== undefined) { metadata[field] = value; metadata.sources[field] = 'nfo'; }
      }
      const ids = Array.isArray(node.uniqueid) ? node.uniqueid : node.uniqueid ? [node.uniqueid] : [];
      for (const id of ids) {
        const namespace = text(id?.['@_type']), value = text(id?.['#text']);
        if (namespace && value && /^[a-z0-9_-]{1,40}$/i.test(namespace)) metadata.externalIds[namespace] = value;
      }
      break;
    } catch (error) {
      if (isRemoteStorageFailure(error)) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') metadata.warnings.push('nfo-unreadable');
    }
  }
  for (const name of [`${stem}-poster.jpg`, `${stem}.jpg`, 'poster.jpg', 'cover.jpg', 'folder.jpg', 'cover.png', `${stem}-poster.png`, `${stem}.png`, 'poster.png', 'folder.png', 'cover.webp', 'poster.webp']) {
    const actual=actualName(name);if(!actual)continue;
    try { const entry = await stat(sibling(actual)); if (entry.size <= 20 * 1024 * 1024) { metadata.coverRef = entry.ref; break; } }
    catch (error) { if (isRemoteStorageFailure(error)) throw error; /* Missing or unsafe local cover does not block import. */ }
  }
  return metadata;
}
