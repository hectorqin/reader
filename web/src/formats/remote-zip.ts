/**
 * Read-only ZIP access over HTTP byte ranges.
 *
 * The whole point of windowed loading is that a reader of a 1200-chapter omnibus
 * downloads one chapter, not a 50MB archive. That only holds if the client can
 * read the archive without having all of it, so this is the client-side half of
 * the server's `Accept-Ranges`.
 *
 * Two decisions carry the design:
 *
 * 1. **The central directory is read once, then reused.** A ZIP's index is at the
 *    end of the file; every entry lookup after that is arithmetic on buffers
 *    already held. Re-reading the directory per chapter would turn one range
 *    request into two per turn.
 * 2. **`deflate` entries are inflated per read, `stored` entries are sliced.**
 *    A `stored` page can be handed to the browser as a subrange (which is why
 *    `resourceUrl` reports the offset rather than the bytes); a `deflate` entry
 *    has to be inflated in JavaScript before anything can look at it, and the
 *    server says honestly which is which so we never guess.
 *
 * The fallback matters as much as the fast path: a server (or a proxy) that
 * ignores `Range` must not break the reader, so every read verifies it got the
 * bytes it asked for and falls back to a whole-file download when it did not.
 */

const EOCD_SIGNATURE = 0x06054b50;
const EOCD64_LOCATOR_SIGNATURE = 0x07064b50;
const EOCD64_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

/** How much of the tail to search for the end-of-central-directory record. */
const EOCD_SEARCH_LIMIT = 66_000;

export interface ZipEntry {
  path: string;
  /** Compression method; only `store` (0) and `deflate` (8) are understood. */
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  /**
   * Offset of the entry's *local header*, not its data.
   *
   * The data offset is only knowable after reading that header (it carries its
   * own name/extra lengths, which the central directory does not repeat), so it
   * is resolved lazily in `dataRange`. Storing a guessed offset here was the
   * first version of this file, and it silently served the wrong bytes on any
   * archive whose local extra fields differed from its central ones.
   */
  headerOffset: number;
}

/** Bytes fetched from a URL, with the ability to ask for subranges. */
export interface RangeSource {
  size(): Promise<number>;
  /** Reads `[start, end]` inclusive. Rejects when the server cannot serve it. */
  read(start: number, end: number): Promise<Uint8Array>;
  /** Reads the whole file. Used only when ranges are unavailable. */
  whole(): Promise<Uint8Array>;
}

export class HttpRangeSource implements RangeSource {
  private knownSize: number | null = null;
  private wholeFile: Uint8Array | null = null;

  constructor(
    private readonly fetchBytes: (range?: { start: number; end: number }) => Promise<{
      bytes: Uint8Array;
      total?: number;
      ranged: boolean;
    }>,
  ) {}

  async size(): Promise<number> {
    if (this.knownSize !== null) return this.knownSize;
    if (this.wholeFile) return this.wholeFile.byteLength;
    const probe = await this.fetchBytes({ start: 0, end: 0 });
    if (!probe.ranged || probe.total === undefined) {
      // No range support: the only honest answer is to hold the file.
      await this.whole();
      return this.knownSize ?? 0;
    }
    this.knownSize = probe.total;
    return probe.total;
  }

  async read(start: number, end: number): Promise<Uint8Array> {
    if (end < start) return new Uint8Array();
    if (this.wholeFile) return this.wholeFile.subarray(start, end + 1);
    const result = await this.fetchBytes({ start, end });
    if (!result.ranged) {
      // A server that answered a range request with the whole body. Correct, if
      // wasteful; keep it and satisfy every later read from memory.
      this.wholeFile = result.bytes;
      this.knownSize = result.bytes.byteLength;
      return result.bytes.subarray(start, end + 1);
    }
    if (result.total !== undefined) this.knownSize = result.total;
    // A short read is not something to paper over: it means the range was
    // ignored, and returning fewer bytes than asked would corrupt the inflate.
    if (result.bytes.byteLength !== end - start + 1) {
      throw new Error(`range ${start}-${end} returned ${result.bytes.byteLength} bytes`);
    }
    return result.bytes;
  }

  async whole(): Promise<Uint8Array> {
    if (this.wholeFile) return this.wholeFile;
    const result = await this.fetchBytes();
    this.wholeFile = result.bytes;
    this.knownSize = result.bytes.byteLength;
    return result.bytes;
  }
}

/**
 * A ZIP archive read over a `RangeSource`.
 *
 * Entries are addressable by path and by the order they appear in the central
 * directory (which is the archive's own order, not sorted).
 */
export class RemoteZip {
  /** Local headers already parsed, so a chapter read does not repeat the work. */
  private readonly dataOffsets = new Map<string, number>();

  private constructor(
    private readonly source: RangeSource,
    private readonly entries: Map<string, ZipEntry>,
    private readonly order: ZipEntry[],
  ) {}

  static async open(source: RangeSource): Promise<RemoteZip> {
    const size = await source.size();
    if (size === 0) throw new Error('empty archive');
    const tailLength = Math.min(size, EOCD_SEARCH_LIMIT);
    const tail = await source.read(size - tailLength, size - 1);
    const eocdOffset = findEocd(tail);
    if (eocdOffset < 0) throw new Error('not a zip archive: no end-of-central-directory record');

    const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let centralSize = view.getUint32(eocdOffset + 12, true);
    let centralOffset = view.getUint32(eocdOffset + 16, true);

    // ZIP64 stores sizes that do not fit in 32 bits in a separate record; the
    // locator in front of the EOCD points at it. A self-hosted comic library is
    // exactly where a >4GB archive turns up.
    const locatorOffset = eocdOffset - 20;
    if (locatorOffset >= 0 && view.getUint32(locatorOffset, true) === EOCD64_LOCATOR_SIGNATURE) {
      const eocd64 = await source.read(
        Number(view.getBigUint64(locatorOffset + 8, true)),
        Number(view.getBigUint64(locatorOffset + 8, true)) + 55,
      );
      const view64 = new DataView(eocd64.buffer, eocd64.byteOffset, eocd64.byteLength);
      if (view64.getUint32(0, true) === EOCD64_SIGNATURE) {
        centralSize = Number(view64.getBigUint64(40, true));
        centralOffset = Number(view64.getBigUint64(48, true));
      }
    }

    const directory = await source.read(centralOffset, centralOffset + centralSize - 1);
    const entries = parseCentralDirectory(directory);
    if (entries.length === 0) throw new Error('zip central directory is empty');
    return new RemoteZip(
      source,
      new Map(entries.map((entry) => [entry.path, entry])),
      entries,
    );
  }

  /**
   * Absolute file offset of an entry's data.
   *
   * Reads the 30-byte local header to learn its variable-length fields. Cached
   * per path: a page turn should not cost a round trip to recompute an offset
   * that cannot change while the file is open.
   */
  async dataOffset(path: string): Promise<number | null> {
    const cached = this.dataOffsets.get(path);
    if (cached !== undefined) return cached;
    const entry = this.entry(path);
    if (!entry) return null;
    const header = await this.source.read(entry.headerOffset, entry.headerOffset + 29);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (view.getUint32(0, true) !== LOCAL_SIGNATURE) {
      throw new Error(`bad local header for ${path}`);
    }
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const offset = entry.headerOffset + 30 + nameLength + extraLength;
    this.dataOffsets.set(path, offset);
    return offset;
  }

  /** Entry paths in archive order. */
  names(): string[] {
    return this.order.map((entry) => entry.path);
  }

  entry(path: string): ZipEntry | undefined {
    return this.entries.get(path) ?? this.entries.get(normaliseZipPath(path));
  }

  /** Whether the entry's bytes are byte-addressable inside the file. */
  isSeekable(path: string): boolean {
    return this.entry(path)?.method === STORED;
  }

  /**
   * The raw byte range of a `stored` entry.
   *
   * This is what lets a native host or a plain `<img>` fetch one page with a
   * range request instead of having the whole page copied through JavaScript.
   */
  async resourceUrl(path: string, url: string): Promise<string | null> {
    const entry = this.entry(path);
    if (!entry || entry.method !== STORED) return null;
    const start = await this.dataOffset(path);
    if (start === null) return null;
    return `${url}#bytes=${start}-${start + entry.compressedSize - 1}`;
  }

  /** Entry contents, inflating when the entry is compressed. */
  async bytes(path: string, limit = Number.POSITIVE_INFINITY): Promise<Uint8Array | null> {
    const entry = this.entry(path);
    if (!entry) return null;
    if (entry.uncompressedSize > limit) {
      throw new Error(`entry ${path} exceeds the read limit`);
    }
    const start = await this.dataOffset(path);
    if (start === null) return null;
    const compressed = await this.source.read(start, start + entry.compressedSize - 1);
    if (entry.method === STORED) return compressed;
    if (entry.method !== DEFLATED) throw new Error(`unsupported zip compression method ${entry.method}`);
    return inflateRaw(compressed, entry.uncompressedSize);
  }

  async text(path: string): Promise<string | null> {
    const bytes = await this.bytes(path);
    return bytes ? new TextDecoder('utf-8').decode(bytes) : null;
  }
}

function findEocd(tail: Uint8Array): number {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let offset = tail.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function parseCentralDirectory(directory: Uint8Array): ZipEntry[] {
  const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset + 46 <= directory.byteLength) {
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) break;
    const method = view.getUint16(offset + 10, true);
    let compressedSize = view.getUint32(offset + 20, true);
    let uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    let localOffset = view.getUint32(offset + 42, true);

    const nameBytes = directory.subarray(offset + 46, offset + 46 + nameLength);
    const path = new TextDecoder('utf-8').decode(nameBytes);

    // ZIP64 escape values: the real numbers live in the extra field.
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      const extraStart = offset + 46 + nameLength;
      const extra = directory.subarray(extraStart, extraStart + extraLength);
      const zip64 = readZip64Extra(extra);
      compressedSize = zip64.compressedSize ?? compressedSize;
      uncompressedSize = zip64.uncompressedSize ?? uncompressedSize;
      localOffset = zip64.localOffset ?? localOffset;
    }

    // The data offset needs the local header's own name/extra lengths, which are
    // only in the local header — so this is stored as the header offset and
    // resolved on read by `dataOffset`, computed here from the local header we
    // are allowed to read lazily. Reading it eagerly would cost one request per
    // entry; a local header is read only for the entries actually opened.
    entries.push({
      path,
      method,
      compressedSize,
      uncompressedSize,
      headerOffset: localOffset,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZip64Extra(extra: Uint8Array): {
  compressedSize?: number;
  uncompressedSize?: number;
  localOffset?: number;
} {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let offset = 0;
  while (offset + 4 <= extra.byteLength) {
    const id = view.getUint16(offset, true);
    const size = view.getUint16(offset + 2, true);
    if (id === 0x0001) {
      let cursor = offset + 4;
      const result: { uncompressedSize?: number; compressedSize?: number; localOffset?: number } = {};
      if (cursor + 8 <= offset + 4 + size - 4) {
        result.uncompressedSize = Number(view.getBigUint64(cursor, true));
        cursor += 8;
      }
      if (cursor + 8 <= offset + 4 + size - 2) {
        result.compressedSize = Number(view.getBigUint64(cursor, true));
        cursor += 8;
      }
      if (cursor + 8 <= offset + 4 + size) {
        result.localOffset = Number(view.getBigUint64(cursor, true));
      }
      return result;
    }
    offset += 4 + size;
  }
  return {};
}

/** Inflates a raw-deflate stream with the platform's own decompressor. */
async function inflateRaw(data: Uint8Array, expectedSize: number): Promise<Uint8Array> {
  const format = 'deflate-raw';
  const stream = new Blob([toArrayBuffer(data)]).stream().pipeThrough(
    new DecompressionStream(format as CompressionFormat),
  );
  const buffer = await new Response(stream).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (expectedSize > 0 && bytes.byteLength !== expectedSize) {
    throw new Error(`inflated ${bytes.byteLength} bytes, expected ${expectedSize}`);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function normaliseZipPath(path: string): string {
  return decodeURIComponent(path).replace(/^\.?\//, '');
}

export { STORED, DEFLATED, LOCAL_SIGNATURE };
