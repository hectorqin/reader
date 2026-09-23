import { badRequest } from '../lib/errors.ts';
import type { AppConfig } from '../config/index.ts';
import type { AppContext } from '../http/context.ts';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/**
 * Server-side speech synthesis, for a client that has no engine of its own.
 *
 * ## Why this is here at all
 *
 * The web client synthesises with the device's own `speechSynthesis`, which is
 * free, offline and already installed. That works on Chrome, Edge and Android's
 * WebView — and does not work at all in a browser without the API, or when the
 * device has no Chinese voice installed, which is the normal case on a Linux
 * desktop. An HTTP engine is the only way for those readers to listen to a book
 * without shipping a neural model in the container.
 *
 * ## What this server will and will not do
 *
 * It **proxies**, it does not synthesise. `TTS_URL` points at any service that
 * accepts the classic `?text=...&speed=...` shape — edge-tts, a local Piper
 * wrapper, a commercial API with a compatibility shim — and the bytes are
 * streamed straight back. Bundling a synthesizer would multiply the image size
 * and the CPU budget of a NAS, which is exactly the trade the client side of
 * this project refuses to make.
 *
 * The proxy is opt-in (`TTS_URL` unset means "no HTTP engine") and it is
 * authenticated like the rest of the API: an open relay from a self-hosted
 * server to a third-party TTS service is someone else's bill.
 */

/** Longest utterance the client is allowed to ask for, in characters. */
const MAX_TEXT_LENGTH = 800;

/** What the client is told this instance supports. */
export interface TtsCapabilities {
  /** True when `TTS_URL` is configured, i.e. this instance can synthesise. */
  http: boolean;
  /** Content types the proxy may answer with, for the client's own checks. */
  formats: string[];
  /** Longest single utterance, so the client can split before asking. */
  maxLength: number;
  /** The service's own voice list, when it publishes one. */
  voices: TtsVoice[];
}

export interface TtsVoice {
  id: string;
  name: string;
  lang: string;
}

interface TtsConfig {
  url: string;
  token: string;
  voicesUrl: string;
  timeoutMs: number;
  cacheDir: string;
  cacheMaxBytes: number;
}

/**
 * Disk cache of synthesised audio.
 *
 * The same sentence is spoken more than once in real use — pausing and resuming
 * re-speaks, "上一句" re-speaks, and a re-open of the same chapter re-speaks the
 * whole queue — and every one of those would otherwise be a fresh round trip to
 * a remote service. A hash-addressed file is the whole implementation.
 *
 * Size is bounded by evicting oldest-first, because a self-hosted box's data
 * directory is shared with the database and the cover cache.
 */
export class TtsService {
  private readonly config: TtsConfig | null;
  private cacheBytes = 0;
  private cacheFiles: string[] = [];

  constructor(config: AppConfig) {
    const url = (process.env.TTS_URL ?? '').trim().replace(/\/+$/, '');
    this.config = url
      ? {
          url,
          token: (process.env.TTS_TOKEN ?? '').trim(),
          voicesUrl: (process.env.TTS_VOICES_URL ?? '').trim(),
          timeoutMs: Number.parseInt(process.env.TTS_TIMEOUT_MS ?? '20000', 10) || 20_000,
          cacheDir: join(config.dataDir, 'tts-cache'),
          cacheMaxBytes: Number.parseInt(process.env.TTS_CACHE_BYTES ?? String(256 * 1024 * 1024), 10) || 0,
        }
      : null;
    if (this.config) this.loadCacheIndex();
  }

  /** Whether this instance can synthesise at all. */
  get enabled(): boolean {
    return this.config !== null;
  }

  capabilities(): TtsCapabilities {
    return {
      http: this.enabled,
      formats: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4'],
      maxLength: MAX_TEXT_LENGTH,
      voices: [],
    };
  }

  /**
   * Synthesises one utterance.
   *
   * Returns the audio bytes and their content type. A voice is passed through
   * opaquely: what a "voice id" means is the upstream service's business, and
   * this server has no business pretending to know.
   */
  async synthesize(input: {
    text: string;
    voice?: string;
    speed?: number;
    format?: string;
  }): Promise<{ bytes: Uint8Array; contentType: string; cached: boolean }> {
    const config = this.config;
    if (!config) {
      throw badRequest('this instance has no HTTP TTS engine configured (set TTS_URL)', 'TTS_DISABLED');
    }
    const text = (input.text ?? '').trim();
    if (!text) throw badRequest('text is required');
    if (text.length > MAX_TEXT_LENGTH) {
      throw badRequest(`text is longer than ${MAX_TEXT_LENGTH} characters`, 'TEXT_TOO_LONG');
    }
    // A speed outside this range is not a preference, it is a mistake that would
    // make the service either chipmunk or unusable.
    const speed = input.speed === undefined ? 1 : clamp(input.speed, 0.25, 4);
    const voice = (input.voice ?? '').slice(0, 120);

    const key = hashKey({ text, voice, speed, format: input.format ?? '', url: config.url });
    const cached = this.readCache(key);
    if (cached) return { ...cached, cached: true };

    const target = this.buildUrl({ text, voice, speed, ...(input.format ? { format: input.format } : {}) });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let bytes: Uint8Array, contentType: string;
    try {
      const response = await fetch(target, {
        method: 'GET', headers: { accept: 'audio/*', ...(config.token ? { authorization: 'Bearer ' + config.token } : {}) },
        signal: controller.signal,
      });
      if (!response.ok) throw badRequest('HTTP TTS service answered ' + response.status,
        response.status === 401 || response.status === 403 ? 'TTS_AUTH' : 'TTS_UPSTREAM');
      contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
      if (!contentType.startsWith('audio/')) throw badRequest('HTTP TTS service returned non-audio content', 'TTS_CONTENT');
      bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length) throw badRequest('HTTP TTS service returned empty audio', 'TTS_EMPTY');
    } catch (error) {
      if (controller.signal.aborted) throw badRequest('HTTP TTS service timed out', 'TTS_TIMEOUT');
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw badRequest('HTTP TTS service unreachable', 'TTS_UPSTREAM');
    } finally { clearTimeout(timer); }

    this.writeCache(key, bytes, contentType);
    return { bytes, contentType, cached: false };
  }

  /** The upstream voice list, when the service publishes one. */
  async voices(): Promise<TtsVoice[]> {
    const config = this.config;
    if (!config) return [];
    // `/voices` is the convention edge-tts and its clones use; anything else is
    // configured explicitly rather than guessed.
    const url = config.voicesUrl || `${config.url}/voices`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 5000));
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
        },
        signal: controller.signal,
      });
      if (!response.ok) return [];
      const body = (await response.json()) as unknown;
      const rows = Array.isArray(body) ? body : ((body as { voices?: unknown[] }).voices ?? []);
      return rows
        .map((row) => normaliseVoice(row))
        .filter((voice): voice is TtsVoice => voice !== null)
        .slice(0, 400);
    } catch {
      // A missing voice list is not an error: the client falls back to whatever
      // the reader typed or to the service's own default.
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The upstream URL.
   *
   * `text` is sent as a query parameter because that is what the compatible
   * services expect. `URLSearchParams` handles the encoding, which matters
   * immediately: a Chinese sentence in a URL is a percent-encoded byte sequence
   * that a hand-built string would mangle.
   */
  private buildUrl(input: { text: string; voice: string; speed: number; format?: string }): string {
    const config = this.config!;
    const params = new URLSearchParams();
    params.set('text', input.text);
    if (input.voice) params.set('voice', input.voice);
    params.set('speed', String(input.speed));
    if (input.format) params.set('format', input.format);
    // `TTS_URL` may already carry its own query (an API key, a model name), so
    // the separator is chosen rather than assumed.
    const separator = config.url.includes('?') ? '&' : '?';
    return `${config.url}${separator}${params.toString()}`;
  }

  // ---- cache ----

  private loadCacheIndex(): void {
    const dir = this.config!.cacheDir;
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      this.cacheFiles = [];
      this.cacheBytes = 0;
      for (const name of readdirSync(dir)) {
        const stat = statSync(join(dir, name));
        this.cacheFiles.push(name);
        this.cacheBytes += stat.size;
      }
    } catch {
      this.cacheFiles = [];
      this.cacheBytes = 0;
    }
  }

  private readCache(key: string): { bytes: Uint8Array; contentType: string } | null {
    const config = this.config;
    if (!config) return null;
    const meta = join(config.cacheDir, `${key}.meta`);
    const data = join(config.cacheDir, `${key}.bin`);
    try {
      if (!existsSync(data) || !existsSync(meta)) return null;
      // Touching the mtime on every hit is what makes "oldest first" eviction a
      // least-recently-*used* policy rather than a least-recently-written one.
      const now = Date.now() / 1000;
      try {
        utimesSync(data, now, now);
      } catch {
        // Best effort: an unreadable mtime only makes eviction less accurate.
      }
      return { bytes: new Uint8Array(readFileSync(data)), contentType: readFileSync(meta, 'utf8') || 'audio/mpeg' };
    } catch {
      return null;
    }
  }

  private writeCache(key: string, bytes: Uint8Array, contentType: string): void {
    const config = this.config;
    if (!config || config.cacheMaxBytes <= 0) return;
    try {
      writeFileSync(join(config.cacheDir, `${key}.bin`), bytes);
      writeFileSync(join(config.cacheDir, `${key}.meta`), contentType);
      this.cacheBytes += bytes.byteLength;
      this.cacheFiles.push(`${key}.bin`, `${key}.meta`);
      this.evict();
    } catch {
      // A full disk must not fail the request that was already answered.
    }
  }

  private evict(): void {
    const config = this.config!;
    if (this.cacheBytes <= config.cacheMaxBytes) return;
    let entries: Array<{ name: string; size: number; mtime: number }> = [];
    try {
      entries = readdirSync(config.cacheDir).map((name) => {
        const stat = statSync(join(config.cacheDir, name));
        return { name, size: stat.size, mtime: stat.mtimeMs };
      });
    } catch {
      return;
    }
    entries.sort((a, b) => a.mtime - b.mtime);
    for (const entry of entries) {
      if (this.cacheBytes <= config.cacheMaxBytes * 0.8) break;
      try {
        unlinkSync(join(config.cacheDir, entry.name));
        this.cacheBytes -= entry.size;
      } catch {
        // Already gone.
      }
    }
  }
}

function normaliseVoice(row: unknown): TtsVoice | null {
  if (typeof row === 'string') return { id: row, name: row, lang: '' };
  if (typeof row !== 'object' || row === null) return null;
  const record = row as Record<string, unknown>;
  const id = String(record['id'] ?? record['ShortName'] ?? record['name'] ?? '');
  if (!id) return null;
  return {
    id,
    name: String(record['name'] ?? record['FriendlyName'] ?? id),
    lang: String(record['lang'] ?? record['locale'] ?? record['Language'] ?? ''),
  };
}

function hashKey(input: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 32);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(min, Math.min(max, value));
}

/** Wired in `main.ts`; kept out of `AppContext` so tests can build one freely. */
export function createTtsService(ctx: AppContext): TtsService {
  return new TtsService(ctx.config);
}
