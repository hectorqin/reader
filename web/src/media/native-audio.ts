interface NativePort {
  postMessage(message: string): void;
  onmessage: ((event: { data: string }) => void) | null;
}
export interface NativeAudioTrack {id:string;groupId:string;label:string;supported:boolean;selected:boolean}
export interface NativeAudioState {video?:boolean;queueRevision?:number;duration?:number}
export interface NativeAudioState { currentQueue?:Array<{title:string;partId?:string}>; audioTracks?:NativeAudioTrack[];tracksVersion?:number; itemId?:string; canPrevious?:boolean;canNext?:boolean;queueSwitching?:boolean; speed?:number;sleepAt?:number; sessionId: string; playing: boolean; paused: boolean; position: number; ended: boolean; error: string; queueId?:string; queueIndex?:number;title?:string;partId?:string;start?:number;end?:number|null;userId?:string;baseUrl?:string }
declare global { interface Window { ReaderMedia?: NativePort } }

/** AndroidX WebMessageListener restricts this port to the bundled top-level origin. */
export class NativeAudio extends EventTarget {
  state: NativeAudioState = { sessionId: '', playing: false, paused: true, position: 0, ended: false, error: '' };
  private constructor(private readonly port: NativePort) {
    super();
    port.onmessage = event => {
      try {
        const state = JSON.parse(event.data) as NativeAudioState;
        if (typeof state.sessionId !== 'string' || typeof state.paused !== 'boolean' || !Number.isFinite(state.position) || state.position < 0) return;
        if(typeof state.duration!=='number'||!Number.isFinite(state.duration)||state.duration<0)delete state.duration;
        if (state.currentQueue !== undefined && (!Array.isArray(state.currentQueue) || state.currentQueue.length > 2000 || state.currentQueue.some(entry=>!entry || typeof entry.title !== 'string'))) return;
        if(state.currentQueue===undefined&&state.queueId===this.state.queueId&&this.state.currentQueue)state.currentQueue=this.state.currentQueue;
        this.state = state; this.dispatchEvent(new Event('change'));
      } catch { /* A malformed host message must not break reading. */ }
    };
  }
  static available(): NativeAudio | null {
    return window.ReaderMedia && typeof window.ReaderMedia.postMessage === 'function' ? new NativeAudio(window.ReaderMedia) : null;
  }
  command(action: string, payload: Record<string, unknown> = {}) { this.port.postMessage(JSON.stringify({ ...payload, action })); }
}
