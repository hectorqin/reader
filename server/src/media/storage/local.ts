import { constants } from 'node:fs';
import { lstat, open, opendir, readdir, realpath } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { StorageError } from './types.ts';
import type { ByteRange, MediaStorage, StorageEntry } from './types.ts';

/** Read-only local adapter. Symlink files/directories are deliberately excluded. */
export class LocalMediaStorage implements MediaStorage {
  private constructor(private readonly root: string) {}

  static async create(root: string): Promise<LocalMediaStorage> {
    const canonical = await realpath(root);
    if (!(await lstat(canonical)).isDirectory()) {
      throw new StorageError('unsafe-path', 'Media root must be an existing directory');
    }
    return new LocalMediaStorage(canonical);
  }

  private entry(ref: string, info: Stats): StorageEntry {
    return { ref, name: basename(ref), size: info.size, modifiedAt: info.mtimeMs,
      fileIdentity: info.ino ? `${info.dev}:${info.ino}` : null };
  }

  private async checkedPath(ref: string): Promise<string> {
    if (!ref || isAbsolute(ref) || ref.includes('\\') || ref.includes(':') || ref.includes('\0') ||
      ref.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new StorageError('invalid-ref', 'Invalid media resource reference');
    }
    let candidate = this.root;
    // Check the root again: a disconnected/replaced mount must fail enumeration.
    const rootInfo = await lstat(candidate);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
      throw new StorageError('unsafe-path', 'Media root is no longer a directory');
    }
    for (const part of ref.split('/')) {
      candidate = resolve(candidate, part);
      if ((await lstat(candidate)).isSymbolicLink()) {
        throw new StorageError('unsafe-path', 'Symbolic links are not media resources');
      }
    }
    const canonical = await realpath(candidate);
    const rel = relative(this.root, canonical);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new StorageError('unsafe-path', 'Media resource escapes its library');
    }
    return canonical;
  }

  async *list(signal?: AbortSignal): AsyncIterable<StorageEntry> {
    const walk = async function* (storage: LocalMediaStorage, prefix: string): AsyncIterable<StorageEntry> {
      signal?.throwIfAborted();
      const directory = prefix ? await storage.checkedPath(prefix) : storage.root;
      const info = await lstat(directory);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new StorageError('unsafe-path', 'Media directory is unavailable');
      }
      const children = await readdir(directory, { withFileTypes: true });
      children.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
      for (const child of children) {
        signal?.throwIfAborted();
        const ref = prefix ? `${prefix}/${child.name}` : child.name;
        if (child.isSymbolicLink()) continue;
        if (child.isDirectory()) yield* walk(storage, ref);
        else if (child.isFile()) yield await storage.stat(ref);
      }
    };
    yield* walk(this, '');
  }

  async stat(ref: string): Promise<StorageEntry> {
    const path = await this.checkedPath(ref);
    const info = await lstat(path);
    if (!info.isFile()) throw new StorageError('not-file', 'Media resource is not a regular file');
    return this.entry(ref, info);
  }

  /** Bounded sidecar hint; large directories fall back to fixed-name probes. */
  async siblingNames(ref:string):Promise<Set<string>|undefined> {
    await this.stat(ref);
    const slash=ref.lastIndexOf('/'),prefix=slash<0?'':ref.slice(0,slash);
    const directory=prefix?await this.checkedPath(prefix):this.root;
    // This is only a negative lookup hint. Existing candidates (including links
    // and directories) must still pass stat/open. Preserve spelling so sidecar
    // matching also opens the correct path on case-sensitive filesystems.
    const names=new Set<string>();let count=0;
    for await(const entry of await opendir(directory)){
      if(++count>256)return undefined;
      names.add(entry.name);
    }
    return names;
  }

  /** Immediate regular files for sidecars; every result passes the same containment checks. */
  async siblings(ref: string): Promise<StorageEntry[]> {
    await this.stat(ref);
    const slash = ref.lastIndexOf('/');
    const prefix = slash < 0 ? '' : ref.slice(0, slash);
    const directory = prefix ? await this.checkedPath(prefix) : this.root;
    const entries = await readdir(directory, { withFileTypes: true });
    const files: StorageEntry[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const child = prefix ? `${prefix}/${entry.name}` : entry.name;
      try { files.push(await this.stat(child)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return files;
  }

  /** Server-only path for local tools such as ffprobe; never expose it in a DTO. */
  async filePath(ref: string): Promise<string> {
    const path = await this.checkedPath(ref);
    if (!(await lstat(path)).isFile()) throw new StorageError('not-file', 'Media resource is not a regular file');
    return path;
  }

  async open(ref: string, range?: ByteRange, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const path = await this.checkedPath(ref);
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new StorageError('not-file', 'Media resource is not a regular file');
      // Detect replacement between validation and opening; use the opened handle for streaming.
      const current = await lstat(await this.checkedPath(ref));
      if (info.dev !== current.dev || info.ino !== current.ino) {
        throw new StorageError('unsafe-path', 'Media resource changed while opening');
      }
      const start = range?.start ?? 0;
      const end = range?.end ?? info.size - 1;
      if (range && (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < 0 || end < start || start >= info.size || end >= info.size)) {
        throw new StorageError('invalid-range', 'Byte range is outside the resource');
      }
      const stream = handle.createReadStream({ ...(info.size ? { start, end } : {}), autoClose: true, signal });
      return { stream, entry: this.entry(ref, info), start, end };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
}
