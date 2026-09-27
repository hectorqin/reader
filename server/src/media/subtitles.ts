import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { MediaDatabase } from './read-database.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { MediaLibraries } from './libraries.ts';
import type { MediaActor } from './libraries.ts';
import { extractEmbeddedSubtitle } from './embedded-subtitles.ts';
import type { MediaTechnicalInfo } from './probe.ts';

const MAX_BYTES = 2 * 1024 * 1024;
interface Cue { start: number; end: number; text: string }
interface Asset { id: string; library_id: string; ref: string; available: number; technical_json:string|null }
const invalid = () => badRequest('字幕格式无效或编码不受支持', 'MEDIA_SUBTITLE_INVALID');
const stamp = (seconds: number) => {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
};
function seconds(value: string): number | null {
  const match = /^(?:(\d{1,3}):)?(\d{2}):(\d{2})[.,](\d{2,3})$/.exec(value.trim());
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) return null;
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / (match[4]!.length === 2 ? 100 : 1000);
}
function decode(bytes: Uint8Array): string {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try { return new TextDecoder('gb18030', { fatal: true }).decode(bytes); }
    catch { throw invalid(); }
  }
}

/** Normalize sidecars into text-only WebVTT; no source styles, scripts or ASS drawings survive. */
export function subtitleToVtt(bytes: Uint8Array, format: string): string {
  if (!bytes.length || bytes.length > MAX_BYTES) throw invalid();
  const source = decode(bytes).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (source.includes('\0')) throw invalid();
  const cues: Cue[] = [];
  function add(start: number | null, end: number | null, text: string) {
    if (start === null || end === null || end <= start || end > 3600 * 1000) return;
    const entities:Record<string,string>={'&amp;':'&','&lt;':'<','&gt;':'>','&nbsp;':' '};
    const plain = text.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|nbsp);/g, entity=>entities[entity]!)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
    if (plain) cues.push({ start, end, text: plain });
    if (cues.length > 10000) throw invalid();
  }
  if (format === 'ass' || format === 'ssa') {
    let events = false, columns: string[] = [];
    for (const line of source.split('\n')) {
      if (/^\[/.test(line.trim())) { events = /^\[events\]$/i.test(line.trim()); continue; }
      if (!events) continue;
      if (/^format:/i.test(line)) { columns = line.slice(line.indexOf(':') + 1).split(',').map(v => v.trim().toLowerCase()); continue; }
      if (!/^dialogue:/i.test(line) || columns.at(-1) !== 'text') continue;
      const values = line.slice(line.indexOf(':') + 1).split(',');
      if (values.length < columns.length) continue;
      const text = values.slice(columns.length - 1).join(',');
      if (/\{[^}]*\\p[1-9]/i.test(text)) continue;
      add(seconds(values[columns.indexOf('start')] || ''), seconds(values[columns.indexOf('end')] || ''), text.replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' '));
    }
  } else if (format === 'srt' || format === 'vtt') {
    for (const block of source.split(/\n[ \t]*\n/)) {
      const lines = block.trim().split('\n');
      if (/^(?:WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0] || '')) continue;
      const index = lines.findIndex(line => line.includes('-->'));
      if (index < 0 || index > 1) continue;
      const timing = /^(\S+)\s+-->\s+(\S+)/.exec(lines[index]!);
      if (timing) add(seconds(timing[1]!), seconds(timing[2]!), lines.slice(index + 1).join('\n'));
    }
  } else throw invalid();
  if (!cues.length) throw invalid();
  return 'WEBVTT\n\n' + cues.map((cue, index) => `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}\n`).join('\n');
}

/** Subtitle IDs are derived from an authorized asset's matching sidecars, not arbitrary paths. */
export class MediaSubtitles {
  constructor(private readonly db:MediaDatabase, private readonly libraries: MediaLibraries, private readonly extract=extractEmbeddedSubtitle) {}
  private asset(actor: MediaActor, id: string): Asset {
    const asset = this.db.get<Asset>('SELECT id,library_id,ref,available,technical_json FROM media_assets WHERE id=?', id);
    if (!asset) throw notFound('media asset not found');
    this.libraries.get(actor, asset.library_id);
    if (!asset.available) throw notFound('media resource is missing');
    return asset;
  }
  private embedded(asset:Asset) {
    const info:MediaTechnicalInfo|null=asset.technical_json?JSON.parse(asset.technical_json):null;
    if(!['.mp4','.m4v','.mov','.mkv','.webm'].includes(posix.extname(asset.ref).toLowerCase()))return [];
    return (info?.streams??[]).filter(stream=>stream.type==='subtitle'&&Number.isSafeInteger(stream.index)&&stream.index>=0&&
      ['subrip','srt','ass','ssa','webvtt','mov_text','text'].includes(stream.codec)).slice(0,100).map(stream=>({
        id:`stream:${stream.index}`,index:stream.index,label:stream.title||stream.language||`字幕 ${stream.index+1}`,
        language:stream.language||'und',format:'vtt',source:'embedded' as const,
      }));
  }
  private async sidecars(actor: MediaActor, asset: Asset) {
    const storage = await this.libraries.storage(actor, asset.library_id);
    const stem = posix.basename(asset.ref, posix.extname(asset.ref));
    const files = await storage.siblings(asset.ref);
    const matches = files.flatMap(file => {
      const format = posix.extname(file.name).slice(1).toLowerCase();
      if (!['srt', 'vtt', 'ass', 'ssa'].includes(format) || file.size > MAX_BYTES) return [];
      const base = posix.basename(file.name, posix.extname(file.name));
      if (base !== stem && !base.startsWith(stem + '.')) return [];
      const suffix = base === stem ? '' : base.slice(stem.length + 1);
      const language = /^(?:zh|en|ja|ko|fr|de|es|it|ru|pt|ar)(?:-[a-zA-Z]{2,8})?(?=\.|$)/.exec(suffix)?.[0] || 'und';
      return [{ id: createHash('sha256').update(asset.id + '\0' + file.ref).digest('hex'), label: suffix || '外置字幕', language, format, ref: file.ref }];
    }).sort((a, b) => a.label.localeCompare(b.label)).slice(0, 100);
    return { storage, matches };
  }
  async list(actor: MediaActor, assetId: string) {
    const asset = this.asset(actor, assetId);
    const { matches } = await this.sidecars(actor, asset);
    this.asset(actor, assetId);
    return { items: [...matches.map(({ ref: _ref, ...dto }) => ({...dto,source:'external' as const})),...this.embedded(asset).map(({index:_index,...dto})=>dto)] };
  }
  async read(actor: MediaActor, assetId: string, subtitleId: string) {
    const asset = this.asset(actor, assetId);
    if(subtitleId.startsWith('stream:')){
      const selected=this.embedded(asset).find(track=>track.id===subtitleId);
      if(!selected)throw notFound('subtitle not found');
      const storage=await this.libraries.storage(actor,asset.library_id),before=await storage.stat(asset.ref);
      if(!storage.filePath)throw notFound('embedded subtitle is unavailable for this storage');
      const bytes=await this.extract(await storage.filePath(asset.ref),selected.index);
      const current=this.asset(actor,assetId),after=await storage.stat(asset.ref);
      if(current.ref!==asset.ref||current.technical_json!==asset.technical_json||before.size!==after.size||before.modifiedAt!==after.modifiedAt||before.fileIdentity!==after.fileIdentity)
        throw badRequest('资源已变化，请重新扫描后选择字幕','MEDIA_SUBTITLE_CHANGED');
      return {webvtt:subtitleToVtt(bytes,'vtt')};
    }
    const { storage, matches } = await this.sidecars(actor, asset);
    const selected = matches.find(match => match.id === subtitleId);
    if (!selected) throw notFound('subtitle not found');
    const { stream } = await storage.open(selected.ref);
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > MAX_BYTES) { stream.destroy(); throw invalid(); }
      chunks.push(Buffer.from(chunk));
    }
    const webvtt = subtitleToVtt(Buffer.concat(chunks), selected.format);
    this.asset(actor, assetId);
    return { webvtt };
  }
}
