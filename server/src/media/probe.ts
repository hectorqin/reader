import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const MEDIA_PROBE_VERSION=2;
export interface MediaStreamInfo {
  index: number; type: string; codec: string; language?: string; title?: string;
  width?: number; height?: number; channels?: number;
  attachedPicture?: boolean;
  profile?:string;level?:number;pixelFormat?:string;sampleRate?:number;
}
export interface MediaTechnicalInfo {
  schemaVersion?:number;
  duration: number | null; format: string; streams: MediaStreamInfo[];
  tags: Record<string, string>;
  chapters: Array<{start: number; end: number; title: string}>;
}
export interface ProbeResult {
  status: 'ready' | 'unavailable' | 'failed';
  info: MediaTechnicalInfo | null;
}
export type MediaProbe = (path: string, signal?: AbortSignal) => Promise<ProbeResult>;
const finite = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};
const tags = (value: unknown): Record<string,string> => {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([,v]) => typeof v === 'string').map(([k,v])=>[k.toLowerCase(),String(v).slice(0,32_000)]));
};

/** No shell, bounded output/time, no transcoding. Failure does not reject the asset. */
export const probeMedia: MediaProbe = async (path, signal) => {
  signal?.throwIfAborted();
  try {
    const { stdout } = await run(process.env.MEDIA_FFPROBE_PATH || 'ffprobe', [
      '-v', 'error', '-protocol_whitelist', 'file', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', path,
    ], { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, signal });
    const data = JSON.parse(stdout) as {format?: {duration?:unknown;format_name?:string;tags?:unknown}; streams?: Array<Record<string,unknown>>;chapters?:Array<Record<string,unknown>>};
    if (!data || typeof data !== 'object') return {status:'failed',info:null};
    const info: MediaTechnicalInfo = {
      schemaVersion:MEDIA_PROBE_VERSION,
      duration: finite(data.format?.duration), format: String(data.format?.format_name || ''),
      tags: tags(data.format?.tags),
      streams: (Array.isArray(data.streams) ? data.streams : []).map(s => {
        const t = tags(s.tags);
        return { index: finite(s.index) ?? 0, type: String(s.codec_type || ''), codec: String(s.codec_name || ''),
          attachedPicture: (s.disposition as {attached_pic?:unknown}|undefined)?.attached_pic === 1,
          language: t.language, title: t.title,
          profile: typeof s.profile==='string'?s.profile.slice(0,100):undefined,
          level: finite(s.level)??undefined,
          pixelFormat: typeof s.pix_fmt==='string'?s.pix_fmt.slice(0,100):undefined,
          sampleRate: finite(s.sample_rate)??undefined,
          width: finite(s.width) ?? undefined, height: finite(s.height) ?? undefined, channels: finite(s.channels) ?? undefined };
      }),
      chapters: (Array.isArray(data.chapters) ? data.chapters : []).flatMap(c => {
        const start = finite(c.start_time), end = finite(c.end_time);
        return start !== null && end !== null && end >= start ? [{start,end,title:tags(c.tags).title || ''}] : [];
      }),
    };
    return {status:'ready',info};
  } catch (error) {
    signal?.throwIfAborted();
    return {status:(error as NodeJS.ErrnoException).code === 'ENOENT'?'unavailable':'failed',info:null};
  }
};
