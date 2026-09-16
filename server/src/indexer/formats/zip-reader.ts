import { open, type FileHandle } from 'node:fs/promises';
import { createInflateRaw } from 'node:zlib';
import { inflateRawSync } from 'node:zlib';
import { Readable, type ReadableOptions } from 'node:stream';

/**
 * Minimal read-only ZIP reader.
 *
 * The project already depends on JSZip (used for EPUB parsing), but JSZip
 * decompresses the entire archive into memory up front. A 40-volume comic
 * collection is hundreds of MB per book, and the scanner touches every book in
 * the library — using JSZip here would make a first scan of a real comic
 * collection exhaust memory and take minutes.
 *
 * This reader parses only the central directory and inflates one entry at a
 * time on demand. It uses nothing but node:zlib, so there is no new dependency.
 *
 * Deliberate limitations, all reported explicitly rather than guessed at:
 *   - ZIP64 (>4GB or >65535 entries)   -> ZIP64_UNSUPPORTED
 *   - encrypted entries                -> ENCRYPTED_UNSUPPORTED
 *   - compression methods other than stored/deflate -> METHOD_UNSUPPORTED
 * Guessing here would hand the reader silently corrupt pages.
 *
 * `openStream()` exists for the same reason the reader exists at all: a client
 * fetching one page of a comic must not make the server inflate the whole
 * archive. `read()` is fine for a cover or an EPUB chapter, but serving a
 * 300MB cbz page by page through it would hold the entire uncompressed book in
 * memory on every request.
 */

export class ZipError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'ZipError';
    this.code = code;
  }
}

export interface ZipEntry {
  name: string;
  isDirectory: boolean;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  encrypted: boolean;
  localHeaderOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT = 0xffff;

/** Cap a single inflated entry so one corrupt file cannot take the process down. */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

export class ZipArchive {
  private constructor(
    private readonly path: string,
    private readonly index: Map<string, ZipEntry>,
    readonly entries: readonly ZipEntry[],
  ) {}

  /**
   * Open an archive that is already in memory.
   *
   * Used by the scanner, which has just read the file to hash it: re-opening it
   * by path would double the I/O on every book in the library for no benefit.
   */
  static async openBuffer(buf: Buffer): Promise<ZipArchive> {
    const entries = readCentralDirectoryFromBuffer(buf);
    return new ZipArchive('', new Map(entries.map((entry) => [entry.name, entry])), entries);
  }

  static async open(absPath: string): Promise<ZipArchive> {
    let handle: FileHandle;
    try {
      handle = await open(absPath, 'r');
    } catch (err) {
      throw new ZipError(
        `cannot open archive: ${err instanceof Error ? err.message : String(err)}`,
        'OPEN_FAILED',
      );
    }

    try {
      const { size } = await handle.stat();
      if (size < EOCD_MIN_SIZE) throw new ZipError('file is too small to be a zip', 'INVALID');

      // The end-of-central-directory record sits at the tail, after a comment
      // of up to 64KiB, so scan backwards for its signature.
      const tailSize = Math.min(size, EOCD_MIN_SIZE + MAX_COMMENT);
      const tail = Buffer.alloc(tailSize);
      await handle.read(tail, 0, tailSize, size - tailSize);

      let eocd = -1;
      for (let i = tail.length - EOCD_MIN_SIZE; i >= 0; i -= 1) {
        if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
          eocd = i;
          break;
        }
      }
      if (eocd < 0) throw new ZipError('no zip central directory found', 'INVALID');

      const entryCount = tail.readUInt16LE(eocd + 10);
      const centralSize = tail.readUInt32LE(eocd + 12);
      const centralOffset = tail.readUInt32LE(eocd + 16);

      // Only the offset/size sentinels indicate ZIP64. The entry count field can
      // legitimately read 0xFFFF for a 65535-entry archive, so treating it as a
      // ZIP64 marker would reject perfectly ordinary libraries.
      if (centralOffset === 0xffffffff || centralSize === 0xffffffff) {
        throw new ZipError('ZIP64 archives are not supported', 'ZIP64_UNSUPPORTED');
      }
      if (centralOffset + centralSize > size) {
        throw new ZipError('central directory is out of bounds', 'INVALID');
      }

      const central = Buffer.alloc(centralSize);
      if (centralSize > 0) await handle.read(central, 0, centralSize, centralOffset);

      void entryCount;
      const entries = parseCentralDirectory(central, entryCount);
      const index = new Map(entries.map((entry) => [entry.name, entry]));
      return new ZipArchive(absPath, index, entries);
    } finally {
      await handle.close();
    }
  }

  /** Entries that hold file data, in archive order. */
  files(): ZipEntry[] {
    return this.entries.filter((entry) => !entry.isDirectory && !entry.encrypted);
  }

  has(name: string): boolean {
    return this.index.has(name);
  }

  get(name: string): ZipEntry | undefined {
    return this.index.get(name);
  }

  /** Inflate one entry. Only the requested bytes are ever held in memory. */
  async read(name: string, maxBytes = MAX_ENTRY_BYTES): Promise<Buffer> {
    if (!this.path) {
      // The buffer-backed form exists so the scanner can avoid re-reading a file
      // it already has; serving requests from it never happens, and silently
      // returning wrong bytes would be worse than saying so.
      throw new ZipError('this archive was opened from memory and has no file to read', 'NO_PATH');
    }
    const entry = this.index.get(name);
    if (!entry) throw new ZipError(`entry not found: ${name}`, 'ENTRY_NOT_FOUND');
    if (entry.encrypted) throw new ZipError('encrypted entries are not supported', 'ENCRYPTED_UNSUPPORTED');
    if (entry.uncompressedSize > maxBytes) {
      throw new ZipError(`entry is too large: ${entry.uncompressedSize} bytes`, 'ENTRY_TOO_LARGE');
    }

    const handle = await open(this.path, 'r');
    try {
      const header = Buffer.alloc(30);
      await handle.read(header, 0, 30, entry.localHeaderOffset);
      if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
        throw new ZipError('corrupt local header', 'INVALID');
      }
      // The local header repeats name/extra lengths and they may differ from the
      // central values, so always trust the local ones when locating the data.
      const nameLength = header.readUInt16LE(26);
      const extraLength = header.readUInt16LE(28);
      const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;

      const payload = Buffer.alloc(entry.compressedSize);
      if (entry.compressedSize > 0) {
        await handle.read(payload, 0, entry.compressedSize, dataOffset);
      }

      if (entry.method === 0) return payload;
      if (entry.method === 8) {
        const inflated = inflateRawSync(payload);
        if (inflated.byteLength > maxBytes) {
          throw new ZipError('inflated entry is too large', 'ENTRY_TOO_LARGE');
        }
        return inflated;
      }
      throw new ZipError(`unsupported compression method: ${entry.method}`, 'METHOD_UNSUPPORTED');
    } finally {
      await handle.close();
    }
  }

  /**
   * Stream one entry without ever holding the whole entry in memory.
   *
   * A comic archive is routinely hundreds of megabytes; unpacking a single page
   * is bounded, but the stored entries still go through the same path and the
   * caller does not have to know which is which.
   *
   * The descriptor is opened up front on purpose. The response has already been
   * sent by the time the stream is consumed, so a failure discovered inside
   * `_read` could only truncate the body silently; failing before the first
   * byte reaches the wire lets the normal error handler return a real status.
   */
  async openStream(name: string): Promise<ZipEntryStream> {
    if (!this.path) {
      throw new ZipError('this archive was opened from memory and has no file to stream', 'NO_PATH');
    }
    const entry = this.index.get(name);
    if (!entry) throw new ZipError(`entry not found: ${name}`, 'ENTRY_NOT_FOUND');
    if (entry.encrypted) throw new ZipError('encrypted entries are not supported', 'ENCRYPTED_UNSUPPORTED');
    if (entry.method !== 0 && entry.method !== 8) {
      throw new ZipError(`unsupported compression method: ${entry.method}`, 'METHOD_UNSUPPORTED');
    }

    const handle = await open(this.path, 'r');
    try {
      const header = Buffer.alloc(30);
      await handle.read(header, 0, 30, entry.localHeaderOffset);
      if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
        throw new ZipError('corrupt local header', 'INVALID');
      }
      const nameLength = header.readUInt16LE(26);
      const extraLength = header.readUInt16LE(28);
      const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
      return new ZipEntryStream(handle, dataOffset, entry);
    } catch (err) {
      await handle.close();
      throw err;
    }
  }
}

function parseCentralDirectory(buffer: Buffer, expectedCount: number): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;

  while (offset + 46 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) break;

    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);

    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLength);
    // Bit 11 marks UTF-8 names. Without it the name is in the archive's code
    // page, which for Chinese-made comics is routinely GBK — decoding that as
    // latin1 would give mojibake page names that never match a client request.
    const name = (flags & 0x800) !== 0 ? rawName.toString('utf8') : decodeLegacyName(rawName);

    entries.push({
      name,
      isDirectory: name.endsWith('/'),
      compressedSize,
      uncompressedSize,
      method,
      encrypted: (flags & 0x1) !== 0,
      localHeaderOffset,
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  // A mismatch means the archive was appended to after creation (common when a
  // cbz is mail-attached). Whatever parsed cleanly is still usable, so only the
  // caller of a wholly empty result needs to care.
  void expectedCount;
  return entries;
}

function decodeLegacyName(raw: Buffer): string {
  // GB18030 can decode any byte sequence, so "success" is not proof of
  // correctness; replacement characters are the only usable signal.
  const decoded = new TextDecoder('gb18030').decode(raw);
  if (decoded.includes('\uFFFD')) return raw.toString('latin1');
  return decoded;
}

/**
 * Reads one ZIP entry lazily.
 *
 * `stored` entries are already raw bytes, so the file is read directly. A
 * `deflate` entry is inflated entry by entry through a transform, which is
 * where the streaming actually pays off: nothing larger than a chunk of the
 * entry is ever resident.
 */
class ZipEntryStream extends Readable {
  private position: number;
  private remaining: number;
  private inflater: ReturnType<typeof createInflateRaw> | null = null;
  private source: FileHandle | null;

  constructor(
    handle: FileHandle,
    private readonly dataOffset: number,
    private readonly entry: ZipEntry,
    options?: ReadableOptions,
  ) {
    super(options);
    this.source = handle;
    this.position = dataOffset;
    this.remaining = entry.compressedSize;
    if (entry.method === 8 && entry.compressedSize > 0) {
      // A single source of truth for the response bytes: whether the entry was
      // stored or deflated, the consumer sees the same plain data.
      const inflater = createInflateRaw();
      inflater.on('error', (err) => this.destroy(err));
      this.inflater = inflater;
      this.pipeThrough(inflater);
    }
  }

  override _read(size: number): void {
    if (this.inflater) {
      // The inflater drives the pushed data; forward its reads.
      this.inflater.resume();
      return;
    }
    void this.pushStored(size);
  }

  private pipeThrough(transform: ReturnType<typeof createInflateRaw>): void {
    const handle = this.source;
    if (!handle) return;
    const pump = async (): Promise<void> => {
      while (this.remaining > 0) {
        const chunk = Buffer.alloc(Math.min(CHUNK, this.remaining));
        const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, this.position);
        if (bytesRead <= 0) throw new ZipError('unexpected end of archive', 'TRUNCATED');
        this.position += bytesRead;
        this.remaining -= bytesRead;
        if (!transform.write(chunk.subarray(0, bytesRead))) {
          await new Promise<void>((resolve) => transform.once('drain', resolve));
        }
      }
      transform.end();
    };
    pump().catch((err: unknown) => transform.destroy(err instanceof Error ? err : new Error(String(err))));
    transform.on('data', (chunk: Buffer) => {
      if (!this.push(chunk)) transform.pause();
    });
    transform.on('end', () => {
      void this.closeHandle().finally(() => this.push(null));
    });
    transform.on('error', () => {
      void this.closeHandle();
    });
  }

  private async pushStored(size: number): Promise<void> {
    if (this.remaining <= 0) {
      await this.closeHandle();
      this.push(null);
      return;
    }
    const length = Math.min(size || CHUNK, this.remaining);
    const chunk = Buffer.alloc(length);
    try {
      const handle = this.source;
      if (!handle) throw new ZipError('stream already closed', 'CLOSED');
      const { bytesRead } = await handle.read(chunk, 0, length, this.position);
      if (bytesRead <= 0) throw new ZipError('unexpected end of archive', 'TRUNCATED');
      this.position += bytesRead;
      this.remaining -= bytesRead;
      this.push(chunk.subarray(0, bytesRead));
    } catch (err) {
      this.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    const handle = this.source;
    this.source = null;
    this.inflater?.destroy();
    if (!handle) {
      callback(error);
      return;
    }
    handle.close().then(
      () => callback(error),
      () => callback(error),
    );
  }

  private async closeHandle(): Promise<void> {
    const handle = this.source;
    this.source = null;
    if (handle) await handle.close();
  }
}

/** Chunk size for reading an entry off disk. Small enough to stay off the heap. */
const CHUNK = 128 * 1024;

/**
 * Locate and parse the central directory of an in-memory archive.
 *
 * Shares `parseCentralDirectory` with the file-backed path so the two can never
 * disagree about entry offsets — a divergence there would surface as pages
 * reading from the wrong position, which is the kind of bug that only shows up
 * on one user's book.
 */
function readCentralDirectoryFromBuffer(buf: Buffer): ZipEntry[] {
  if (buf.length < EOCD_MIN_SIZE) throw new ZipError('file is too small to be a zip', 'INVALID');

  const tailStart = Math.max(0, buf.length - (EOCD_MIN_SIZE + MAX_COMMENT));
  const tail = buf.subarray(tailStart);
  let eocd = -1;
  for (let i = tail.length - EOCD_MIN_SIZE; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('no zip central directory found', 'INVALID');

  const entryCount = tail.readUInt16LE(eocd + 10);
  const centralSize = tail.readUInt32LE(eocd + 12);
  const centralOffset = tail.readUInt32LE(eocd + 16);

  if (centralOffset === 0xffffffff || centralSize === 0xffffffff) {
    throw new ZipError('ZIP64 archives are not supported', 'ZIP64_UNSUPPORTED');
  }
  if (centralOffset + centralSize > buf.length) {
    throw new ZipError('central directory is out of bounds', 'INVALID');
  }
  return parseCentralDirectory(buf.subarray(centralOffset, centralOffset + centralSize), entryCount);
}
