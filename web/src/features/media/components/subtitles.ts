import type { MediaApi } from '../api/media-api.ts';
import { decodeSubtitleBytes, subtitleFormatOf, subtitleTextToVtt, SubtitleFormatError } from '../services/subtitle-format.ts';

interface Subtitle { id: string; label: string; language: string; format: string; source?:'embedded'|'external' }
interface LocalSubtitle { id: string; label: string; format: string; webvtt: string }

/** One row of the 字幕 list: what it is, and where it came from (外挂 · srt, 内嵌). */
export interface SubtitleOption { value: string; label: string; note: string }

/**
 * Embedded decoder tracks, fetched sidecars and files picked from this device share one
 * exclusive selector. The `<select>` is the imperative control (kept for the Android
 * shell and the tests); the 字幕与音轨 sheet draws the same state from `options` and
 * listens for `change`.
 */
export class SubtitleControls extends EventTarget {
  readonly element = document.createElement('label');
  private readonly select = document.createElement('select');
  private readonly status = document.createElement('span');
  private listing: AbortController | null = null;
  private loading: AbortController | null = null;
  private assetId = '';
  private items: Subtitle[] = [];
  private track: HTMLTrackElement | null = null;
  private url = '';
  private active = false;
  private listFailed = false;
  private embedded: TextTrack[] = [];
  private textTracks: TextTrackList | null = null;
  private externalSelection = '';
  private locals: LocalSubtitle[] = [];
  private delayMs = 0;
  /** Each cue's own timing, so a delay is always an offset from the file, never cumulative. */
  private readonly originals = new WeakMap<TextTrackCue, [number, number]>();
  private revision = 0;
  private notify() { this.revision += 1; this.dispatchEvent(new Event('change')); }
  private readonly refreshEmbedded = () => {
    if (!this.active) return;
    const selected = this.select.value;
    this.embedded = Array.from(this.video.textTracks).filter(track =>
      track !== this.track?.track && (track.kind === 'subtitles' || track.kind === 'captions'));
    // Browsers may automatically re-enable an in-band track when a sidecar is
    // appended. An explicit sidecar choice owns selection until changed here.
    if (this.externalSelection) for (const track of this.embedded) if (track.mode !== 'disabled') track.mode = 'disabled';
    const off = document.createElement('option'); off.value = ''; off.textContent = '关闭';
    this.select.replaceChildren(off);
    this.embedded.forEach((track, index) => {
      const option = document.createElement('option'); option.value = `embedded:${index}`;
      option.textContent = `${track.label || track.language || `字幕 ${index + 1}`} · 内嵌`;
      this.select.append(option);
    });
    for (const item of this.items) {
      const option = document.createElement('option'); option.value = item.id;
      option.textContent = `${item.label} · ${item.format.toUpperCase()} · ${item.source==='embedded'?'内嵌提取':'外置'}`; this.select.append(option);
    }
    for (const local of this.locals) {
      const option = document.createElement('option'); option.value = local.id;
      option.textContent = `${local.label} · ${local.format.toUpperCase()} · 本机`; this.select.append(option);
    }
    const showingIndex = this.embedded.findIndex(track => track.mode === 'showing');
    if (showingIndex >= 0) { this.loading?.abort(); this.releaseTrack(); this.status.textContent = ''; }
    this.select.value = this.externalSelection || (showingIndex >= 0 ? `embedded:${showingIndex}` :
      [...this.items, ...this.locals].some(item => item.id === selected) ? selected : '');
    this.select.hidden = this.items.length + this.embedded.length + this.locals.length === 0;
    this.element.hidden = this.select.hidden && !this.listFailed;
    this.notify();
  };

  constructor(private readonly api: MediaApi, private readonly video: HTMLVideoElement) {
    super();
    this.element.className = 'media-subtitle-controls';
    this.element.hidden = true;
    this.element.append(document.createTextNode('字幕 '), this.select, this.status);
    this.select.setAttribute('aria-label', '字幕');
    this.status.setAttribute('role', 'status');
    this.select.addEventListener('change', () => { void this.choose(this.select.value); });
  }
  async load(assetId: string) {
    this.clear(); this.assetId = assetId; this.active = true;
    this.textTracks = this.video.textTracks;
    for (const event of ['addtrack', 'removetrack', 'change']) this.textTracks.addEventListener?.(event, this.refreshEmbedded);
    this.video.addEventListener('loadedmetadata', this.refreshEmbedded);
    this.refreshEmbedded();
    const controller = new AbortController(); this.listing = controller;
    try {
      const result = await this.api.request<{ items: Subtitle[] }>(`assets/${encodeURIComponent(assetId)}/subtitles`, 'GET', undefined, controller.signal);
      if (controller.signal.aborted) return;
      if (!Array.isArray(result.items)) throw new Error('Invalid subtitle list');
      this.items = result.items;
      this.refreshEmbedded();
    } catch {
      if (!controller.signal.aborted) { this.listFailed = true; this.status.textContent = '外置字幕列表读取失败，请重新播放后重试。'; this.refreshEmbedded(); }
    }
  }
  private releaseTrack() {
    if (this.track) { if (this.track.track) this.track.track.mode = 'disabled'; this.track.remove(); this.track = null; }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = '';
  }
  private async choose(id: string) {
    this.externalSelection = [...this.items, ...this.locals].some(item => item.id === id) ? id : '';
    this.loading?.abort(); this.releaseTrack(); this.status.textContent = '';
    const embedded = id.startsWith('embedded:') ? this.embedded[Number(id.slice(9))] : null;
    for (const track of this.embedded) track.mode = track === embedded ? 'showing' : 'disabled';
    this.notify();
    if (embedded) return;
    if (!id) return;
    const local = this.locals.find(candidate => candidate.id === id);
    if (local) { this.attach(local.label, 'und', local.webvtt); return; }
    const item = this.items.find(candidate => candidate.id === id);
    if (!item) return;
    const controller = new AbortController(); this.loading = controller;
    this.status.textContent = '加载中…'; this.notify();
    try {
      const result = await this.api.request<{ webvtt: string }>(`assets/${encodeURIComponent(this.assetId)}/subtitles/${encodeURIComponent(id)}`, 'GET', undefined, controller.signal);
      if (controller.signal.aborted) return;
      this.attach(item.label, item.language, result.webvtt);
    } catch (error) {
      if (!controller.signal.aborted) { this.externalSelection = ''; this.status.textContent = error instanceof Error ? error.message : '字幕加载失败，可重新选择。'; this.select.value = ''; this.notify(); }
    }
  }
  /** Shows WebVTT as a sidecar `<track>` on the video; the delay is applied once its cues load. */
  private attach(label: string, language: string, webvtt: string) {
    this.url = URL.createObjectURL(new Blob([webvtt], { type: 'text/vtt' }));
    const track = document.createElement('track'); this.track = track;
    track.kind = 'subtitles'; track.label = label; track.srclang = language; track.src = this.url;
    track.addEventListener('load', () => {
      if (this.track !== track) return;
      track.track.mode = 'showing'; this.status.textContent = ''; this.shiftCues(); this.notify();
    });
    track.addEventListener('error', () => {
      if (this.track === track) { this.externalSelection = ''; this.status.textContent = '字幕加载失败，可重新选择。'; this.select.value = ''; this.releaseTrack(); this.notify(); }
    });
    this.video.append(track); if (track.track) track.track.mode = 'showing';
    this.notify();
  }
  private shiftCues() {
    const cues = this.track?.track?.cues;
    if (!cues) return;
    for (const cue of Array.from(cues)) {
      let original = this.originals.get(cue);
      if (!original) { original = [cue.startTime, cue.endTime]; this.originals.set(cue, original); }
      const start = Math.max(0, original[0] + this.delayMs / 1000);
      cue.startTime = start; cue.endTime = Math.max(start, original[1] + this.delayMs / 1000);
    }
  }

  // ---- the 字幕与音轨 sheet ----

  /** Changes whenever the list, the selection or the status does (for useSyncExternalStore). */
  get version(): number { return this.revision; }
  get value(): string { return this.select.value; }
  get message(): string { return this.status.textContent ?? ''; }
  get options(): SubtitleOption[] {
    return [
      { value: '', label: '关闭', note: '' },
      ...this.embedded.map((track, index) => ({ value: `embedded:${index}`, label: track.label || track.language || `字幕 ${index + 1}`, note: '内嵌' })),
      ...this.items.map(item => ({ value: item.id, label: item.label, note: item.source === 'embedded' ? '内嵌' : `外挂 · ${item.format.toLowerCase()}` })),
      ...this.locals.map(local => ({ value: local.id, label: local.label, note: `本机 · ${local.format}` })),
    ];
  }
  /** Picks a row, exactly as choosing it in the `<select>` would. */
  pick(value: string) { this.select.value = value; void this.choose(value); }
  /** 添加外挂字幕: converts a device file to WebVTT here and selects it. Session-only. */
  async addLocal(file: { name: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<void> {
    if (!this.active) throw new SubtitleFormatError('开始播放视频后才能添加字幕。');
    const format = subtitleFormatOf(file.name);
    if (!format) throw new SubtitleFormatError('请选择 SRT、VTT 或 ASS 字幕文件。');
    const webvtt = subtitleTextToVtt(decodeSubtitleBytes(new Uint8Array(await file.arrayBuffer())), format);
    if (!this.active) return;
    const local: LocalSubtitle = { id: `local:${this.locals.length + 1}`, label: file.name.replace(/\.[^.]+$/, '') || '本机字幕', format, webvtt };
    this.locals.push(local);
    this.refreshEmbedded();
    this.pick(local.id);
  }
  /** Seconds the subtitles are moved by: positive shows them later. Sidecar and local files only. */
  get delay(): number { return this.delayMs / 1000; }
  get canDelay(): boolean { return this.track !== null; }
  setDelay(seconds: number) {
    if (!Number.isFinite(seconds)) return;
    this.delayMs = Math.round(Math.max(-60, Math.min(60, seconds)) * 10) * 100;
    this.shiftCues(); this.notify();
  }
  clear() {
    this.active = false;
    this.externalSelection = '';
    for (const event of ['addtrack', 'removetrack', 'change']) this.textTracks?.removeEventListener?.(event, this.refreshEmbedded);
    this.video.removeEventListener('loadedmetadata', this.refreshEmbedded);
    for (const track of this.embedded) track.mode = 'disabled';
    this.textTracks = null; this.embedded = []; this.listFailed = false;
    this.listing?.abort(); this.loading?.abort(); this.releaseTrack();
    this.items = []; this.locals = []; this.delayMs = 0; this.assetId = ''; this.status.textContent = '';
    this.select.replaceChildren(); this.select.hidden = false; this.element.hidden = true;
    this.notify();
  }
}
