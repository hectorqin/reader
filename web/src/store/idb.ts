/**
 * Minimal IndexedDB wrapper.
 *
 * Deliberately dependency-free and small: the client ships into a WebView where
 * bundle size and startup cost are felt, and the two stores it needs are a
 * string map and a byte map. No indexes, no cursors, no migrations beyond a
 * version bump that drops and recreates the caches.
 *
 * The in-memory fallback matters more than it looks: some Android WebView
 * configurations and Safari private windows expose `indexedDB` but throw on
 * first use. Without the fallback the reader would be unusable instead of
 * merely non-persistent, and losing the cache is recoverable while a blank
 * screen is not.
 */

const DB_NAME = 'reader';
const DB_VERSION = 1;
const KV_STORE = 'kv';
const BLOB_STORE = 'blobs';

function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
      if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('cannot open indexedDB'));
    request.onblocked = () => reject(new Error('indexedDB upgrade blocked by another tab'));
  });
  return dbPromise;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openDb();
  const transaction = db.transaction(store, mode);
  const objectStore = transaction.objectStore(store);
  const result = await fn(objectStore);
  // Wait for the transaction to actually commit: awaiting the request alone can
  // resolve before the write is durable.
  if (mode === 'readwrite') {
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('transaction failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('transaction aborted'));
    });
  }
  return result;
}

class MemoryKv {
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

class MemoryBlobs {
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

export interface Stores {
  kv: { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> };
  blobs: {
    get(key: string): Promise<Uint8Array | null>;
    put(key: string, bytes: Uint8Array): Promise<void>;
    remove(key: string): Promise<void>;
    list(): Promise<string[]>;
    usage(): Promise<number>;
  };
  /** True when the fallback in-memory store is in use. */
  ephemeral: boolean;
}

export async function createStores(): Promise<Stores> {
  if (!hasIndexedDb()) {
    return { kv: new MemoryKv(), blobs: new MemoryBlobs(), ephemeral: true };
  }
  try {
    // Probe with a real transaction: `indexedDB` existing does not imply it works.
    await tx(KV_STORE, 'readonly', async (store) => requestToPromise(store.get('__probe__')));
  } catch {
    return { kv: new MemoryKv(), blobs: new MemoryBlobs(), ephemeral: true };
  }

  const kv = {
    async get(key: string): Promise<string | null> {
      const value = await tx<string | undefined>(KV_STORE, 'readonly', async (store) =>
        requestToPromise<string | undefined>(store.get(key)),
      );
      return value ?? null;
    },
    async set(key: string, value: string): Promise<void> {
      await tx(KV_STORE, 'readwrite', async (store) => {
        await requestToPromise(store.put(value, key));
      });
    },
    async remove(key: string): Promise<void> {
      await tx(KV_STORE, 'readwrite', async (store) => {
        await requestToPromise(store.delete(key));
      });
    },
  };

  const blobs = {
    async get(key: string): Promise<Uint8Array | null> {
      const value = await tx<Uint8Array | ArrayBuffer | undefined>(BLOB_STORE, 'readonly', async (store) =>
        requestToPromise<Uint8Array | ArrayBuffer | undefined>(store.get(key)),
      );
      if (!value) return null;
      return value instanceof Uint8Array ? value : new Uint8Array(value);
    },
    async put(key: string, bytes: Uint8Array): Promise<void> {
      await tx(BLOB_STORE, 'readwrite', async (store) => {
        await requestToPromise(store.put(bytes, key));
      });
    },
    async remove(key: string): Promise<void> {
      await tx(BLOB_STORE, 'readwrite', async (store) => {
        await requestToPromise(store.delete(key));
      });
    },
    async list(): Promise<string[]> {
      const keys = await tx<IDBValidKey[]>(BLOB_STORE, 'readonly', async (store) =>
        requestToPromise<IDBValidKey[]>(store.getAllKeys()),
      );
      return keys.map((key) => String(key));
    },
    async usage(): Promise<number> {
      const values = await tx<Array<Uint8Array | ArrayBuffer>>(BLOB_STORE, 'readonly', async (store) =>
        requestToPromise<Array<Uint8Array | ArrayBuffer>>(store.getAll()),
      );
      let total = 0;
      for (const value of values) total += value instanceof Uint8Array ? value.byteLength : value.byteLength;
      return total;
    },
  };

  return { kv, blobs, ephemeral: false };
}
