import { createStores } from '../../src/store/idb.ts';
import { ApiError, errorForStatus } from '../../src/api/errors.ts';
import type { KeyValueStore, BlobStore, Platform, HttpRequest, HttpResponse } from '../../src/core/platform.ts';

/** In-memory key/value store, matching the interface the client depends on. */
export class MemoryKv implements KeyValueStore {
  private readonly map = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}

export class MemoryBlobs implements BlobStore {
  private readonly map = new Map<string, Uint8Array>();
  async get(key: string): Promise<Uint8Array | null> {
    return this.map.get(key) ?? null;
  }
  async put(key: string, bytes: Uint8Array): Promise<void> {
    this.map.set(key, bytes);
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
  async list(): Promise<string[]> {
    return [...this.map.keys()];
  }
  async usage(): Promise<number> {
    let total = 0;
    for (const bytes of this.map.values()) total += bytes.byteLength;
    return total;
  }
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export type Responder = (request: RecordedRequest) => HttpResponse | Promise<HttpResponse>;

/** Sentinel for "the server answered 200 with a body that is not JSON". */
export const NON_JSON_BODY = Symbol('non-json-body');

/**
 * A transport double that records every request.
 *
 * Used to assert on the *shape* of client-server traffic — that a refresh is
 * de-duplicated, that a stale offline batch is still sent — which is where the
 * subtle bugs in sync live, and which the server's own tests cannot see.
 */
export class FakeTransport {
  readonly requests: RecordedRequest[] = [];
  private responder: Responder = () => ({ status: 200, headers: {}, json: {} });

  respondWith(responder: Responder): void {
    this.responder = responder;
  }

  json(payload: unknown, status = 200): void {
    this.respondWith(() => ({ status, headers: {}, json: payload }));
  }

  /** A 200 whose body is not JSON, which is what a proxy or portal returns. */
  nonJson(status = 200): void {
    this.respondWith(() => {
      throw new ApiError('offline', 'server returned a non-JSON response', 'BAD_GATEWAY', status);
    });
  }

  failWith(error: Error): void {
    this.respondWith(() => {
      throw error;
    });
  }

  /**
   * Mirrors `FetchTransport`'s contract: a non-2xx response is a thrown
   * `ApiError`, and a thrown `TypeError` becomes an `offline` error.
   *
   * Reproducing that normalisation is not incidental. The client's retry, refresh
   * and offline logic is all keyed off `ApiError.kind`, so a double that hands
   * back raw failure responses would let all of it go untested.
   */
  async send(request: HttpRequest): Promise<HttpResponse> {
    const recorded: RecordedRequest = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      ...(request.body !== undefined ? { body: request.body } : {}),
    };
    this.requests.push(recorded);

    let response: HttpResponse;
    try {
      response = await this.responder(recorded);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError('offline', err instanceof Error ? err.message : 'network error');
    }

    if (response.status >= 200 && response.status < 300) return response;

    const body = response.json as { error?: { code?: string; message?: string } } | undefined;
    const code = body?.error?.code ?? '';
    const message = body?.error?.message ?? `request failed with status ${response.status}`;
    throw new ApiError(errorForStatus(response.status), message, code, response.status);
  }

  countMatching(predicate: (request: RecordedRequest) => boolean): number {
    return this.requests.filter(predicate).length;
  }
}

export interface TestPlatform extends Platform {
  kv: MemoryKv;
  blobs: MemoryBlobs;
  setOnline(next: boolean): void;
}

export function makePlatform(
  transport: FakeTransport,
  kv = new MemoryKv(),
  blobs = new MemoryBlobs(),
): TestPlatform {
  const listeners = new Set<(state: 'online' | 'offline') => void>();
  let online = true;
  return {
    name: 'web',
    deviceLabel: 'test-device',
    transport,
    kv,
    blobs,
    async connectivity() {
      return online ? 'online' : 'offline';
    },
    onConnectivityChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setOnline(next: boolean) {
      online = next;
      for (const listener of listeners) listener(next ? 'online' : 'offline');
    },
  };
}

export { createStores };
