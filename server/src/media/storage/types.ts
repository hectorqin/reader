import type { Readable } from 'node:stream';

/** Opaque to callers outside the adapter. Never a playback URL. */
export interface StorageEntry {
  ref: string;
  name: string;
  size: number;
  modifiedAt: number;
  /** A move hint, not a content hash or a work identity. */
  fileIdentity: string | null;
}

export interface ByteRange {
  start: number;
  end?: number;
}

/** Implementations must throw on incomplete enumeration, never return an empty success. */
export interface MediaStorage {
  list(signal?: AbortSignal): AsyncIterable<StorageEntry>;
  stat(ref: string): Promise<StorageEntry>;
  siblingNames(ref: string): Promise<Set<string> | undefined>;
  siblings(ref: string): Promise<StorageEntry[]>;
  /** Only local adapters expose a path to trusted local probing tools. */
  filePath?(ref: string): Promise<string>;
  open(ref: string, range?: ByteRange, signal?: AbortSignal): Promise<{
    stream: Readable;
    entry: StorageEntry;
    start: number;
    end: number;
  }>;
}

export class StorageError extends Error {
  constructor(readonly code: 'invalid-ref' | 'unsafe-path' | 'not-file' | 'invalid-range', message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

/** An interrupted remote snapshot must not replace previously published metadata. */
export function isRemoteStorageFailure(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && error.code.startsWith('MEDIA_OPENLIST_');
}
