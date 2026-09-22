import type { ApiError } from '../api/errors.ts';

/**
 * The seam between the shared rendering layer and the two hosts that run it.
 *
 * The browser/H5 build implements this with `fetch` + IndexedDB. The Android
 * shell overrides the pieces it can do better natively (durable book cache,
 * reachability, device label) and leaves the rest alone. Everything above this
 * interface — formats, layout, sync — is written once against the interface.
 */
export interface HttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /**
   * Request body.
   *
   * A string for the JSON calls, a `FormData` for an upload. The two are genuinely
   * different things and the transport must not guess: a `FormData` carries its
   * own `content-type` with the multipart boundary in it, and setting a header
   * that says `application/json` over one leaves a body the server cannot parse.
   */
  body?: string | FormData;
  /** Binary response mode: used for book bodies and covers. */
  binary?: boolean;
  /** Return the response body without buffering it (Streamable HTTP). */
  stream?: boolean;
  /**
   * Called with `loaded / total` while the body is being sent.
   *
   * A request *property* rather than a second transport method, because there is
   * exactly one kind of request anyone wants progress on — a body the user's own
   * connection has to carry — and a host that cannot report it simply never calls
   * this. `fetch` is the case that matters: no shipping browser reports upload
   * progress, so the browser host reports nothing and the UI falls back to
   * "上传中…" rather than to a progress bar that never moves.
   */
  onUploadProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  /** Present for JSON responses. */
  json?: unknown;
  /** Present for `binary` requests. */
  bytes?: Uint8Array;
  stream?: ReadableStream<Uint8Array>;
  /** Raw text, used to build a useful error when JSON parsing fails. */
  text?: string;
}

export interface Transport {
  send(request: HttpRequest): Promise<HttpResponse>;
}

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * Durable byte cache for downloaded book files.
 *
 * Kept separate from `KeyValueStore` because the two have very different size
 * profiles: credentials and sync cursors are tiny strings, whereas a PDF can be
 * hundreds of megabytes and belongs in whatever bulk storage the host offers
 * (IndexedDB blobs in the browser, the app's files directory on Android).
 */
export interface BlobStore {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  remove(key: string): Promise<void>;
  list(): Promise<string[]>;
  /** Total bytes currently stored, for the storage-usage screen. */
  usage(): Promise<number>;
}

export type Connectivity = 'online' | 'offline';

export interface Platform {
  readonly name: 'web' | 'android';
  /** Device label recorded on progress rows, so the UI can say "read on Pixel". */
  readonly deviceLabel: string;
  readonly transport: Transport;
  readonly kv: KeyValueStore;
  readonly blobs: BlobStore;
  /** Current connectivity, best effort. Never throws. */
  connectivity(): Promise<Connectivity>;
  onConnectivityChange(listener: (state: Connectivity) => void): () => void;
  /** Notified whenever a request has been attempted and its outcome. */
  reportError?(error: ApiError): void;
}
