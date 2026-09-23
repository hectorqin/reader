import type { ExtensionField, PluginExtensions } from './extensions.ts';
import type { Readable } from 'node:stream';

/** Stable source capabilities exposed to the host and clients. */
export type SourceCapability =
  | 'browse'
  | 'search'
  | 'search.filters'
  | 'search.cancel'
  | 'search.session'
  | 'content.alternatives'
  | 'detail'
  | 'acquire.file'
  | 'acquire.chapters'
  | 'content.manifest'
  | 'content.resource'
  | 'content.update';

export interface SourceDescriptor {
  readonly extensions?: PluginExtensions;
  /** Stable source type id, e.g. `local`, `opds`, or a plugin-defined id. */
  readonly id: string;
  readonly label: string;
  readonly version: string;
  readonly capabilities: readonly SourceCapability[];
  /** JSON Schema for an instance's public configuration, when applicable. */
  readonly configSchema?: unknown;
  readonly credentialKeys?: readonly { key: string; label: string }[];
}

export interface SourceInstance {
  readonly id: string;
  readonly pluginId: string;
  readonly sourceType: string;
  readonly name: string;
  /** Configuration is owned by the host and never persisted by a provider. */
  readonly config: unknown;
  readonly enabled: boolean;
}

export interface SourceContext {
  readonly instance: SourceInstance;
  /** User id scopes cache and credential access. */
  readonly userId: string;
  readonly signal: AbortSignal;
  readonly http?: SourceHttpClient;
  readonly credentials?: CredentialStore;
  readonly storage?: SourceStorage;
  readonly log?: SourceLogger;
}

export interface SourceHttpRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string | Uint8Array;
}

export interface SourceHttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: Uint8Array;
  readonly url: string;
}

export interface SourceHttpClient {
  request(request: SourceHttpRequest, signal: AbortSignal): Promise<SourceHttpResponse>;
}

export interface CredentialStore {
  get(key: string, signal?: AbortSignal): Promise<string | undefined>;
  set(key: string, value: string, signal?: AbortSignal): Promise<void>;
  delete(key: string, signal?: AbortSignal): Promise<void>;
}

export interface SourceStorage {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface SourceLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface BrowseRequest {
  readonly ref?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface SearchRequest {
  /** Opt-in rolling search identity, scoped to the current user and instance. */
  readonly sessionId?: string;
  /** Total unique results across a session, distinct from a single page's limit. */
  readonly resultLimit?: number;
  readonly filters?: Record<string, string>;
  readonly query: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface CatalogPage {
  readonly limitReached?: boolean;
  readonly items: readonly CatalogEntry[];
  readonly navigation?: readonly NavigationEntry[];
  readonly nextCursor?: string;
  readonly title?: string;
  readonly errors?: readonly CatalogError[];
  /** Finite source progress. Session cursors also drain buffered results and heartbeats. */
  readonly batch?: { readonly completed: number; readonly total: number };
}

export interface CatalogError {
  readonly source: string;
  readonly code: string;
  readonly message: string;
}

export interface NavigationEntry {
  readonly ref: string;
  readonly title: string;
  readonly kind?: 'catalog' | 'search' | 'collection';
}

export interface CatalogEntry {
  readonly ref: string;
  readonly title: string;
  readonly authors?: readonly string[];
  readonly description?: string;
  readonly coverUrl?: string;
  readonly language?: string;
  readonly publishedAt?: string;
  readonly latestChapter?: string;
  readonly sourceName?: string;
  readonly options?: readonly AcquisitionOption[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AcquisitionOption {
  readonly id: string;
  readonly label: string;
  readonly mediaType?: string;
  readonly size?: number;
  readonly available?: boolean;
}

export interface AcquireRequest {
  readonly entryRef: string;
  readonly optionId?: string;
}

export type Acquisition =
  | {
      readonly kind: 'ready';
      readonly publicationId: string;
    }
  | {
      readonly kind: 'file';
      /** Provider-owned reference; host must call openFile rather than fetch arbitrary URLs. */
      readonly acquisitionRef: string;
      readonly mediaType: string;
      readonly filename?: string;
      readonly size?: number;
    }
  | {
      readonly kind: 'chapters';
      readonly publicationRef: string;
    }
  | {
      readonly kind: 'action-required';
      readonly action: AcquisitionAction;
    };

export interface AcquisitionAction {
  readonly type: 'login' | 'borrow' | 'external';
  readonly label: string;
  readonly url?: string;
  readonly fields?: readonly { name: string; label: string; secret?: boolean }[];
}

export interface ManifestSnapshot {
  readonly sourceName?: string;
  readonly publicationRef: string;
  readonly version?: string;
  readonly items: readonly ManifestItem[];
}

export interface ManifestItem {
  readonly sourceUrl?: string;
  readonly id: string;
  readonly seq: number;
  readonly title: string;
  readonly kind: 'chapter' | 'page';
  readonly mediaType: string;
  readonly ref: string;
}

export interface ResourceRequest {
  readonly publicationRef: string;
  readonly ref: string;
  readonly rendition?: 'text' | 'html' | 'binary';
}

export interface ResourceResponse {
  readonly mediaType: string;
  readonly data?: Uint8Array;
  readonly text?: string;
  readonly stream?: Readable;
  readonly size?: number;
  readonly filename?: string;
  readonly etag?: string;
}

export interface SourceProvider {
  readonly descriptor: SourceDescriptor;
  /** Dynamic select fields; keys and option values are opaque to the host. */
  searchFilters?(ctx: SourceContext): Promise<ExtensionField[]>;
  alternatives?(ctx: SourceContext, request: SearchRequest & { publicationRef: string; authors?: readonly string[] }): Promise<CatalogPage>;
  validateConfig?(config: unknown): void | Promise<void>;
  browse?(ctx: SourceContext, request: BrowseRequest): Promise<CatalogPage>;
  search?(ctx: SourceContext, request: SearchRequest): Promise<CatalogPage>;
  cancelSearch?(ctx: SourceContext, sessionId: string): Promise<void>;
  detail(ctx: SourceContext, entryRef: string): Promise<CatalogEntry>;
  acquire(ctx: SourceContext, request: AcquireRequest): Promise<Acquisition>;
  /** Resolve a file acquisition without exposing arbitrary network access to the host. */
  openFile?(ctx: SourceContext, acquisition: Extract<Acquisition, { kind: 'file' }>): Promise<ResourceResponse>;
  getManifest?(ctx: SourceContext, publicationRef: string): Promise<ManifestSnapshot>;
  readResource?(ctx: SourceContext, request: ResourceRequest): Promise<ResourceResponse>;
}

export interface SourceRegistration {
  readonly pluginId: string;
  readonly provider: SourceProvider;
  readonly builtin?: boolean;
}

export interface PluginSourceType {
  readonly extensions?: PluginExtensions;
  readonly id: string;
  readonly label: string;
  readonly capabilities: readonly SourceCapability[];
  readonly configSchema?: unknown;
  readonly credentialKeys?: readonly { key: string; label: string }[];
}

export interface PluginManifest {
  readonly extensions?: PluginExtensions;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly apiVersion: number;
  readonly runtime: 'node';
  readonly entry: string;
  readonly sourceTypes: readonly PluginSourceType[];
  readonly permissions?: {
    readonly network?: { readonly domains?: readonly string[] };
    readonly storage?: boolean;
    readonly credentials?: boolean;
  };
}

export type PluginRuntimeState = 'stopped' | 'running' | 'failed';

export interface PluginRuntimeStatus {
  readonly pluginId: string;
  readonly state: PluginRuntimeState;
  readonly pendingRequests: number;
}
