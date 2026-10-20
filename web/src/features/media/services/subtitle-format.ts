/**
 * Local subtitle files (添加外挂字幕) to text-only WebVTT, in the browser.
 *
 * The same normalisation as the server's `subtitleToVtt` (server/src/media/subtitles.ts):
 * cue timing and plain text survive; source styles, markup, scripts and ASS drawings do
 * not. A file picked from the device never leaves it, so the conversion happens here.
 */
export const LOCAL_SUBTITLE_MAX_BYTES = 5 * 1024 * 1024;
export const localSubtitleFormats = ['srt', 'vtt', 'ass', 'ssa'] as const;
export type LocalSubtitleFormat = typeof localSubtitleFormats[number];

export class SubtitleFormatError extends Error {
  constructor(message = '无法读取这个字幕文件，请选择 SRT、VTT 或 ASS 字幕。') { super(message); this.name = 'SubtitleFormatError'; }
}

export function subtitleFormatOf(name: string): LocalSubtitleFormat | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return localSubtitleFormats.includes(ext as LocalSubtitleFormat) ? ext as LocalSubtitleFormat : null;
}

/** UTF-16 by BOM, then strict UTF-8, then GB18030 — the encodings Chinese subtitle files come in. */
export function decodeSubtitleBytes(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > LOCAL_SUBTITLE_MAX_BYTES) throw new SubtitleFormatError();
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try { return new TextDecoder('gb18030', { fatal: true }).decode(bytes); }
    catch { throw new SubtitleFormatError('字幕文件的编码不受支持。'); }
  }
}

function seconds(value: string): number | null {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(value.trim());
  if (!match) return null;
  const [, h = '0', m, s, fraction = '0'] = match;
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(fraction.padEnd(3, '0'));
}
function stamp(ms: number): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

/** Throws SubtitleFormatError for an unknown format, an empty or oversized file, or no cues. */
export function subtitleTextToVtt(text: string, format: LocalSubtitleFormat): string {
  if (!text || text.length > LOCAL_SUBTITLE_MAX_BYTES) throw new SubtitleFormatError();
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (source.includes('\0')) throw new SubtitleFormatError();
  const cues: Array<{ start: number; end: number; text: string }> = [];
  const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
  function add(start: number | null, end: number | null, body: string) {
    if (start === null || end === null || end <= start || end > 24 * 3600 * 1000) return;
    const plain = body.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|nbsp);/g, entity => entities[entity]!)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
    if (plain) cues.push({ start, end, text: plain });
    if (cues.length > 20000) throw new SubtitleFormatError('字幕文件过大。');
  }
  if (format === 'ass' || format === 'ssa') {
    let events = false, columns: string[] = [];
    for (const line of source.split('\n')) {
      if (/^\[/.test(line.trim())) { events = /^\[events\]$/i.test(line.trim()); continue; }
      if (!events) continue;
      if (/^format:/i.test(line)) { columns = line.slice(line.indexOf(':') + 1).split(',').map(value => value.trim().toLowerCase()); continue; }
      if (!/^dialogue:/i.test(line) || columns.at(-1) !== 'text') continue;
      const values = line.slice(line.indexOf(':') + 1).split(',');
      if (values.length < columns.length) continue;
      const body = values.slice(columns.length - 1).join(',');
      if (/\{[^}]*\\p[1-9]/i.test(body)) continue;
      add(seconds(values[columns.indexOf('start')] || ''), seconds(values[columns.indexOf('end')] || ''), body.replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' '));
    }
  } else {
    for (const block of source.split(/\n[ \t]*\n/)) {
      const lines = block.trim().split('\n');
      if (/^(?:WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0] || '')) continue;
      const index = lines.findIndex(line => line.includes('-->'));
      if (index < 0 || index > 1) continue;
      const timing = /^(\S+)\s+-->\s+(\S+)/.exec(lines[index]!);
      if (timing) add(seconds(timing[1]!), seconds(timing[2]!), lines.slice(index + 1).join('\n'));
    }
  }
  if (!cues.length) throw new SubtitleFormatError();
  return 'WEBVTT\n\n' + cues.map((cue, index) => `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}\n`).join('\n');
}
