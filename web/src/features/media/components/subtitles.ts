import type { MediaApi } from '../api/media-api.ts';

interface Subtitle { id: string; label: string; language: string; format: string; source?:'embedded'|'external' }

/** Embedded decoder tracks and fetched sidecars share one exclusive selector. */
export class SubtitleControls {
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
    const showingIndex = this.embedded.findIndex(track => track.mode === 'showing');
    if (showingIndex >= 0) { this.loading?.abort(); this.releaseTrack(); this.status.textContent = ''; }
    this.select.value = this.externalSelection || (showingIndex >= 0 ? `embedded:${showingIndex}` :
      this.items.some(item => item.id === selected) ? selected : '');
    this.select.hidden = this.items.length + this.embedded.length === 0;
    this.element.hidden = this.select.hidden && !this.listFailed;
  };

  constructor(private readonly api: MediaApi, private readonly video: HTMLVideoElement) {
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
    if (this.track) { this.track.track.mode = 'disabled'; this.track.remove(); this.track = null; }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = '';
  }
  private async choose(id: string) {
    this.externalSelection = this.items.some(item => item.id === id) ? id : '';
    this.loading?.abort(); this.releaseTrack(); this.status.textContent = '';
    const embedded = id.startsWith('embedded:') ? this.embedded[Number(id.slice(9))] : null;
    for (const track of this.embedded) track.mode = track === embedded ? 'showing' : 'disabled';
    if (embedded) return;
    if (!id) return;
    const item = this.items.find(candidate => candidate.id === id);
    if (!item) return;
    const controller = new AbortController(); this.loading = controller;
    this.status.textContent = '加载中…';
    try {
      const result = await this.api.request<{ webvtt: string }>(`assets/${encodeURIComponent(this.assetId)}/subtitles/${encodeURIComponent(id)}`, 'GET', undefined, controller.signal);
      if (controller.signal.aborted) return;
      this.url = URL.createObjectURL(new Blob([result.webvtt], { type: 'text/vtt' }));
      const track = document.createElement('track'); this.track = track;
      track.kind = 'subtitles'; track.label = item.label; track.srclang = item.language; track.src = this.url;
      track.addEventListener('load', () => {
        if (this.track !== track) return;
        track.track.mode = 'showing'; this.status.textContent = '';
      });
      track.addEventListener('error', () => {
        if (this.track === track) { this.externalSelection = ''; this.status.textContent = '字幕加载失败，可重新选择。'; this.select.value = ''; this.releaseTrack(); }
      });
      this.video.append(track); track.track.mode = 'showing';
    } catch (error) {
      if (!controller.signal.aborted) { this.externalSelection = ''; this.status.textContent = error instanceof Error ? error.message : '字幕加载失败，可重新选择。'; this.select.value = ''; }
    }
  }
  clear() {
    this.active = false;
    this.externalSelection = '';
    for (const event of ['addtrack', 'removetrack', 'change']) this.textTracks?.removeEventListener?.(event, this.refreshEmbedded);
    this.video.removeEventListener('loadedmetadata', this.refreshEmbedded);
    for (const track of this.embedded) track.mode = 'disabled';
    this.textTracks = null; this.embedded = []; this.listFailed = false;
    this.listing?.abort(); this.loading?.abort(); this.releaseTrack();
    this.items = []; this.assetId = ''; this.status.textContent = '';
    this.select.replaceChildren(); this.select.hidden = false; this.element.hidden = true;
  }
}
