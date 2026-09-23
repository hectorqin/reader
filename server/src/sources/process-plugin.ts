import { createHash } from 'node:crypto';
import { searchFilterFields } from './extensions.ts';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile, realpath, stat, mkdir } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { AppError } from '../lib/errors.ts';
import { validatePluginManifest } from './registry.ts';
import { decodeCatalogEntry, decodeCatalogPage, decodeChapterAcquisition, decodeManifest } from './protocol.ts';
import type {
  PluginManifest,
  PluginRuntimeState,
  PluginRuntimeStatus,
  ResourceResponse,
  SourceContext,
  SourceProvider,
} from './types.ts';

export class PluginError extends AppError {
  constructor(code: string, message: string) {
    super(code === 'PLUGIN_TIMEOUT' ? 504 : code === 'PLUGIN_UNAVAILABLE' ? 503 : 502, code, message);
    this.name = 'PluginError';
  }
}

export interface ProcessPluginOptions {
  readonly dataRoot?: string;
  readonly timeoutMs?: number;
  /** Applies to each JSON line and limits the first version's inline resource payloads. */
  readonly maxMessageBytes?: number;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
  cleanup(): void;
}

/**
 * Trusted Node plugins speak newline-delimited JSON-RPC over stdio. This is
 * fault isolation, not a sandbox: installed code has this OS user's privileges.
 */
export class ProcessPlugin {
  private process: ChildProcessWithoutNullStreams | undefined;
  private state: PluginRuntimeState = 'stopped';
  private sequence = 0;
  private buffer = Buffer.alloc(0);
  private readonly pending = new Map<number, PendingRequest>();
  private readonly exits = new Set<Promise<void>>();
  private readonly timeoutMs: number;
  private dataDir?: string;
  private readonly maxMessageBytes: number;

  private constructor(
    readonly manifest: PluginManifest,
    private readonly directory: string,
    private readonly entry: string,
    options: ProcessPluginOptions,
  ) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxMessageBytes = options.maxMessageBytes ?? 2 * 1024 * 1024;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new Error('plugin timeoutMs must be a positive integer');
    }
    if (!Number.isSafeInteger(this.maxMessageBytes) || this.maxMessageBytes < 256) {
      throw new Error('plugin maxMessageBytes must be at least 256');
    }
  }

  static async load(directory: string, options: ProcessPluginOptions = {}): Promise<ProcessPlugin> {
    const root = await realpath(directory);
    const manifest = validatePluginManifest(JSON.parse(await readFile(resolve(root, 'plugin.json'), 'utf8')));
    if (manifest.apiVersion !== 1) {
      throw new PluginError('PLUGIN_INCOMPATIBLE', `unsupported plugin API version: ${manifest.apiVersion}`);
    }
    if (isAbsolute(manifest.entry)) {
      throw new PluginError('PLUGIN_INVALID', 'plugin entry must be relative to its directory');
    }
    const entry = await realpath(resolve(root, manifest.entry));
    const rel = relative(root, entry);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new PluginError('PLUGIN_INVALID', 'plugin entry must be inside its directory');
    }
    if (!(await stat(entry)).isFile()) {
      throw new PluginError('PLUGIN_INVALID', 'plugin entry must be a file');
    }
    const plugin = new ProcessPlugin(manifest, root, entry, options);
    if (options.dataRoot && manifest.permissions?.storage) {
      plugin.dataDir = resolve(options.dataRoot, createHash('sha256').update(manifest.id).digest('hex'));
      await mkdir(plugin.dataDir, { recursive: true });
    }
    return plugin;
  }

  status(): PluginRuntimeStatus {
    return { pluginId: this.manifest.id, state: this.state, pendingRequests: this.pending.size };
  }

  providers(): readonly SourceProvider[] {
    return this.manifest.sourceTypes.map((type) => {
      const call = async <T>(method: string, ctx: SourceContext, args: Record<string, unknown>): Promise<T> => {
        const credentials: Record<string, string> = Object.create(null);
        if (this.manifest.permissions?.credentials) {
          for (const { key } of type.credentialKeys ?? []) {
            const value = await ctx.credentials?.get(key, ctx.signal);
            if (value !== undefined) credentials[key] = value;
          }
        }
        return this.request(method, {
          sourceType: type.id, context: { instance: ctx.instance, userId: ctx.userId, credentials }, ...args,
        }, ctx.signal) as Promise<T>;
      };
      const provider: SourceProvider = {
        descriptor: { ...type, version: this.manifest.version },
        validateConfig: async (config) => {
          await this.request('validateConfig', { sourceType: type.id, config });
        },
        detail: async (ctx, entryRef) => decodeCatalogEntry(await call('detail', ctx, { entryRef })),
        acquire: async (ctx, request) => decodeChapterAcquisition(await call('acquire', ctx, { request })),
      };
      if (type.capabilities.includes('search.filters')) provider.searchFilters = async (ctx) => searchFilterFields(await call('searchFilters', ctx, {}));
      if (type.capabilities.includes('search.session')) provider.cancelSearch = async (ctx, sessionId) => { await call('searchCancel', ctx, { sessionId }); };
      if (type.capabilities.includes('content.alternatives')) provider.alternatives = async (ctx, request) => decodeCatalogPage(await call('alternatives', ctx, { request }));
      if (type.capabilities.includes('browse')) {
        provider.browse = async (ctx, request) => decodeCatalogPage(await call('browse', ctx, { request }));
      }
      if (type.capabilities.includes('search')) {
        provider.search = async (ctx, request) => decodeCatalogPage(await call('search', ctx, { request }));
      }
      if (type.capabilities.includes('content.manifest')) {
        provider.getManifest = async (ctx, publicationRef) => decodeManifest(await call('getManifest', ctx, { publicationRef }), publicationRef);
      }
      if (type.capabilities.includes('content.resource')) {
        provider.readResource = async (ctx, request) => decodeResource(await call('readResource', ctx, { request }));
      }
      // File transfer through this bounded JSON channel is intentionally unsupported.
      if (type.capabilities.includes('acquire.file')) {
        throw new PluginError('PLUGIN_INCOMPATIBLE', 'process plugins currently support chapter resources only');
      }
      return provider;
    });
  }

  invoke(method: 'extension.page' | 'extension.action' | 'extension.task', params: Record<string, unknown>): Promise<unknown> {
    return this.request(method, params);
  }

  async close(): Promise<void> {
    const child = this.process;
    this.process = undefined;
    this.state = 'stopped';
    this.buffer = Buffer.alloc(0);
    this.rejectAll(new PluginError('PLUGIN_UNAVAILABLE', 'plugin stopped'));
    child?.kill('SIGKILL');
    await Promise.all([...this.exits]);
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.process) return this.process;
    if (this.state === 'failed') throw new PluginError('PLUGIN_UNAVAILABLE', 'plugin failed; reload it to retry');
    const child = spawn(process.execPath, [this.entry], {
      cwd: this.directory,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Do not automatically copy server API tokens and other configuration.
      env: pluginEnvironment(),
    });
    this.process = child;
    this.state = 'running';
    const exit = new Promise<void>((done) => child.once('close', () => done()));
    this.exits.add(exit);
    void exit.then(() => this.exits.delete(exit));
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.process === child) this.onData(chunk);
    });
    child.stderr.resume();
    child.stdin.on('error', () => {
      if (this.process === child) this.fail(new PluginError('PLUGIN_UNAVAILABLE', 'plugin input pipe failed'));
    });
    child.on('error', () => {
      if (this.process === child) this.fail(new PluginError('PLUGIN_UNAVAILABLE', 'plugin could not start'));
    });
    child.on('close', () => {
      if (this.process === child) this.fail(new PluginError('PLUGIN_UNAVAILABLE', 'plugin process exited'));
    });
    return child;
  }

  private request(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const abortError = () => signal?.reason?.name === 'TimeoutError'
      ? new PluginError('PLUGIN_TIMEOUT', 'plugin request exceeded its execution deadline')
      : new PluginError('PLUGIN_CANCELLED', 'plugin request cancelled');
    if (signal?.aborted) return Promise.reject(abortError());
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.start();
    } catch (error) {
      return Promise.reject(error);
    }
    const id = ++this.sequence;
    const instanceId = (params.context as { instance?: { id?: string } } | undefined)?.instance?.id;
    const instanceDataDir = this.dataDir && instanceId
      ? resolve(this.dataDir, 'sources', createHash('sha256').update(instanceId).digest('hex')) : undefined;
    const line = JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, host: { dataDir: this.dataDir, instanceDataDir } } }) + '\n';
    if (Buffer.byteLength(line) > this.maxMessageBytes) {
      return Promise.reject(new PluginError('PLUGIN_MESSAGE_TOO_LARGE', 'plugin request exceeds the message limit'));
    }
    return new Promise((resolveRequest, reject) => {
      const type = this.manifest.sourceTypes.find(type => type.id === params.sourceType);
      const cancellationRequest = method === 'searchCancel' && type?.capabilities.includes('search.session');
      const cancelRequest = (error: PluginError) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.cleanup();
        // A stop command may still finish late: keep it running so it can release
        // the search session, but never let its deadline kill unrelated work.
        if (!cancellationRequest) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id } }) + '\n');
        pending.reject(error);
      };
      const cancel = () => {
        cancelRequest(abortError());
      };
      const timer = setTimeout(() => {
        // Deadlines belong to individual calls, not the shared plugin process.
        // Cooperation is best-effort; late responses are discarded by request ID.
        cancelRequest(new PluginError('PLUGIN_TIMEOUT', 'plugin request exceeded its execution deadline'));
      }, this.timeoutMs);
      timer.unref();
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      };
      this.pending.set(id, { resolve: resolveRequest, reject, cleanup });
      signal?.addEventListener('abort', cancel, { once: true });
      child.stdin.write(line);
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const end = this.buffer.indexOf(10);
      if (end < 0) {
        if (this.buffer.length > this.maxMessageBytes) {
          this.fail(new PluginError('PLUGIN_MESSAGE_TOO_LARGE', 'plugin response exceeds the message limit'));
        }
        return;
      }
      if (end > this.maxMessageBytes) {
        this.fail(new PluginError('PLUGIN_MESSAGE_TOO_LARGE', 'plugin response exceeds the message limit'));
        return;
      }
      const line = this.buffer.subarray(0, end).toString('utf8');
      this.buffer = this.buffer.subarray(end + 1);
      try {
        this.onMessage(JSON.parse(line));
      } catch {
        this.fail(new PluginError('PLUGIN_PROTOCOL_ERROR', 'plugin returned an invalid JSON-RPC message'));
        return;
      }
    }
  }

  private onMessage(input: unknown): void {
    if (!input || typeof input !== 'object') throw new Error('invalid response');
    const value = input as Record<string, unknown>;
    if (value.jsonrpc !== '2.0' || !Number.isSafeInteger(value.id)) throw new Error('invalid response');
    if (('result' in value) === ('error' in value)) throw new Error('invalid response');
    const pending = this.pending.get(value.id as number);
    if (!pending) return; // Cancelled or timed out calls can still return late.
    this.pending.delete(value.id as number);
    pending.cleanup();
    if ('error' in value) {
      const error = value.error as { code?: unknown; message?: unknown } | null;
      const code = typeof error?.code === 'string' ? error.code : 'PLUGIN_ERROR';
      pending.reject(new PluginError(code, typeof error?.message === 'string' ? error.message : 'plugin request failed'));
    } else {
      pending.resolve(value.result);
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
  }

  private fail(error: PluginError): void {
    const child = this.process;
    this.process = undefined;
    this.state = 'failed';
    this.buffer = Buffer.alloc(0);
    this.rejectAll(error);
    child?.kill('SIGKILL');
  }
}

function pluginEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG']) {
    if (process.env[key] !== undefined) result[key] = process.env[key];
  }
  return result;
}

function decodeResource(input: unknown): ResourceResponse {
  if (!input || typeof input !== 'object') throw new PluginError('PLUGIN_PROTOCOL_ERROR', 'invalid plugin resource');
  const value = input as Record<string, unknown>;
  if (typeof value.mediaType !== 'string' || !value.mediaType.trim()) {
    throw new PluginError('PLUGIN_PROTOCOL_ERROR', 'plugin resource has no media type');
  }
  const hasText = typeof value.text === 'string';
  const hasBase64 = typeof value.base64 === 'string';
  if (hasText === hasBase64) {
    throw new PluginError('PLUGIN_PROTOCOL_ERROR', 'plugin resource must contain exactly one of text or base64');
  }
  if (hasText) return { mediaType: value.mediaType, text: value.text as string };
  const encoded = value.base64 as string;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new PluginError('PLUGIN_PROTOCOL_ERROR', 'plugin resource contains invalid base64');
  }
  const data = Buffer.from(encoded, 'base64');
  return { mediaType: value.mediaType, data, size: data.length };
}
