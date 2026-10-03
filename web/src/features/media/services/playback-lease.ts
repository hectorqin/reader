import type { MediaApi, Playback } from '../api/media-api.ts';

const EARLY_RENEWAL = 2 * 60_000;
const RETRY_DELAY = 30_000;

/** Authenticated renewal retains the same stream URL, so decoding and seeking continue uninterrupted. */
export class PlaybackLease {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private request: AbortController | null = null;
  private pending: Promise<void> | null = null;
  private stopped = false;
  private retryAfter = 0;
  constructor(
    private readonly api: MediaApi,
    private readonly session: Playback,
    private readonly onFailure: (message: string, terminal: boolean) => void,
  ) {
    document.addEventListener('visibilitychange', this.wake);
    window.addEventListener('online', this.wake);
    this.schedule();
  }
  private wake = () => { if (!document.hidden) void this.ensure().catch(() => {}); };
  private schedule(delay = Math.max(1000, this.session.expiresAt - Date.now() - EARLY_RENEWAL)) {
    if (this.timer) clearTimeout(this.timer);
    if (!this.stopped) this.timer = setTimeout(() => { void this.ensure().catch(() => {}); }, delay);
  }
  async ensure(): Promise<void> {
    if (this.stopped) return;
    if (this.pending) return this.pending;
    if (this.session.expiresAt - Date.now() > EARLY_RENEWAL) return;
    if (Date.now() < this.retryAfter) {
      if (this.session.expiresAt <= Date.now()) throw new Error('播放连接已过期，正在等待重试');
      return;
    }
    const controller = new AbortController();
    this.request = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let onAbort!:()=>void;
    const cancelled=new Promise<never>((_resolve,reject)=>{
      onAbort=()=>reject(new Error('播放续期超时或已取消'));
      controller.signal.addEventListener('abort',onAbort,{once:true});
    });
    this.pending = (async () => {
      try {
        const response = await Promise.race([this.api.request<{ id: string; expiresAt: number }>(`playback/${this.session.id}/renew`, 'POST', {}, controller.signal),cancelled]);
        if (this.stopped) return;
        if (response.id !== this.session.id || !Number.isFinite(response.expiresAt) || response.expiresAt <= Date.now() + EARLY_RENEWAL) throw new Error('无效的播放续期响应');
        this.session.expiresAt = response.expiresAt;
        this.retryAfter = 0;
        this.schedule();
      } catch (error) {
        if (this.stopped) return;
        const status = (error as { status?: number }).status;
        const terminal = status === 401 || status === 403 || status === 404 || status === 409;
        this.onFailure(terminal ? '播放会话已失效或被其他设备接管，请重新选择播放。' : '播放连接续期失败，将自动重试。', terminal);
        if (terminal) this.stop();
        else { this.retryAfter = Date.now() + RETRY_DELAY; this.schedule(RETRY_DELAY); }
        throw error;
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener('abort',onAbort);
        if (this.request === controller) this.request = null;
        this.pending = null;
      }
    })();
    return this.pending;
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.request?.abort();
    document.removeEventListener('visibilitychange', this.wake);
    window.removeEventListener('online', this.wake);
  }
}
