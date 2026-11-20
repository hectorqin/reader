import { inflateSync } from 'node:zlib';

/**
 * The Kindle container, read from bytes (docs/kindle-formats.zh-CN.md).
 *
 * A `.mobi`/`.azw3` file is a Palm database: a list of records. Record 0 holds the
 * headers; the book's text follows as compressed records; images, fonts and the
 * indexes that describe the text's structure come after. Two generations share the
 * container:
 *
 *  - MOBI 6 (old `.mobi`, `.azw`): one long HTML document with Kindle extensions —
 *    `<mbp:pagebreak/>` between chapters, `recindex` for images, byte offsets
 *    (`filepos`) for links.
 *  - KF8 (`.azw3`, and the second half of a "hybrid" `.mobi`): real XHTML split into
 *    skeletons and fragments, with stylesheets as separate flows and `kindle:` URIs
 *    for everything that points elsewhere.
 *
 * This module only reads the container. Turning either generation into chapters a
 * browser can render is `mobi.ts`'s job.
 *
 * Written against the structure documented by the MobileRead wiki and by calibre
 * and foliate-js's readers; no code is shared with them.
 */

export class MobiError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_MOBI' | 'DRM' | 'UNSUPPORTED' | 'CORRUPT',
  ) {
    super(message);
  }
}

/** "No such record", as the headers spell it. */
export const NONE = 0xffffffff;

export interface Exth {
  title?: string;
  creators: string[];
  publisher?: string;
  description?: string;
  isbn?: string;
  subjects: string[];
  date?: string;
  asin?: string;
  languages: string[];
  /** Record index (relative to the first resource) of the cover and of its thumbnail. */
  coverOffset?: number;
  thumbnailOffset?: number;
  /** PDB record where a hybrid file's KF8 half begins. */
  kf8Boundary?: number;
}

export interface MobiHeader {
  compression: number;
  numTextRecords: number;
  encryption: number;
  headerLength: number;
  encoding: number;
  version: number;
  fullName: string;
  /** Absolute PDB index of the first resource record (images, fonts…). */
  resourceStart: number;
  huffRecord: number;
  huffCount: number;
  trailingFlags: number;
  /** NCX index record, relative to the book's first record. */
  ncx: number;
  /** KF8 only, relative to the book's first record. */
  fdst: number;
  skel: number;
  frag: number;
  exth: Exth;
}

/** The records of a Palm database, sliced out of one buffer without copying. */
export class PalmDb {
  readonly offsets: number[];
  readonly type: string;

  constructor(readonly buf: Buffer) {
    if (buf.length < 78) throw new MobiError('文件太短，不是 Kindle 电子书', 'NOT_MOBI');
    this.type = buf.toString('latin1', 60, 68);
    if (this.type !== 'BOOKMOBI') throw new MobiError('不是 Kindle（MOBI/AZW3）电子书', 'NOT_MOBI');
    const count = buf.readUInt16BE(76);
    if (78 + count * 8 > buf.length) throw new MobiError('记录表超出文件长度', 'CORRUPT');
    this.offsets = Array.from({ length: count }, (_, i) => buf.readUInt32BE(78 + i * 8));
    for (let i = 0; i < count; i += 1) {
      const start = this.offsets[i]!,
        end = i + 1 < count ? this.offsets[i + 1]! : buf.length;
      if (start > end || end > buf.length) throw new MobiError(`第 ${i} 条记录越界`, 'CORRUPT');
    }
  }

  get count(): number {
    return this.offsets.length;
  }

  record(index: number): Buffer {
    if (!Number.isInteger(index) || index < 0 || index >= this.offsets.length)
      throw new MobiError(`记录 ${index} 不存在`, 'CORRUPT');
    const end = index + 1 < this.offsets.length ? this.offsets[index + 1]! : this.buf.length;
    return this.buf.subarray(this.offsets[index]!, end);
  }
}

/** Reads the headers in a book's record 0. Throws on DRM: there is nothing to read. */
export function readHeader(record0: Buffer): MobiHeader {
  if (record0.length < 24 || record0.toString('latin1', 16, 20) !== 'MOBI')
    throw new MobiError('缺少 MOBI 头', 'NOT_MOBI');
  const u32 = (at: number): number => (at + 4 <= record0.length ? record0.readUInt32BE(at) : NONE);
  const encryption = record0.readUInt16BE(12);
  if (encryption !== 0) throw new MobiError('这本 Kindle 书带有 DRM 加密，无法打开', 'DRM');
  const headerLength = u32(20);
  const encoding = u32(28);
  const version = u32(36);
  const nameOffset = u32(84),
    nameLength = u32(88);
  const name =
    nameOffset !== NONE && nameOffset + nameLength <= record0.length
      ? record0.subarray(nameOffset, nameOffset + nameLength)
      : Buffer.alloc(0);
  const exthFlags = u32(128);
  const exth =
    exthFlags !== NONE && exthFlags & 0x40
      ? readExth(record0.subarray(16 + headerLength), encoding)
      : { creators: [], subjects: [], languages: [] };
  return {
    compression: record0.readUInt16BE(0),
    numTextRecords: record0.readUInt16BE(8),
    encryption,
    headerLength,
    encoding,
    version,
    fullName: decodeText(name, encoding),
    resourceStart: u32(108),
    huffRecord: u32(112),
    huffCount: u32(116),
    // Present only in headers long enough to carry it; older files have no trailing entries.
    trailingFlags: headerLength >= 0xe4 ? record0.readUInt16BE(0xf2) : 0,
    ncx: headerLength >= 0xe8 ? u32(0xf4) : NONE,
    fdst: version >= 8 ? u32(0xc0) : NONE,
    frag: version >= 8 ? u32(0xf8) : NONE,
    skel: version >= 8 ? u32(0xfc) : NONE,
    exth,
  };
}

function readExth(buf: Buffer, encoding: number): Exth {
  const exth: Exth = { creators: [], subjects: [], languages: [] };
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'EXTH') return exth;
  const count = buf.readUInt32BE(8);
  let at = 12;
  for (let i = 0; i < count && at + 8 <= buf.length; i += 1) {
    const type = buf.readUInt32BE(at),
      length = buf.readUInt32BE(at + 4);
    if (length < 8 || at + length > buf.length) break;
    const data = buf.subarray(at + 8, at + length);
    const text = (): string => decodeText(data, encoding).trim();
    const uint = (): number | undefined => (data.length >= 4 ? data.readUInt32BE(0) : undefined);
    switch (type) {
      case 100:
        if (text()) exth.creators.push(text());
        break;
      case 101:
        exth.publisher = text();
        break;
      case 103:
        exth.description = text();
        break;
      case 104:
        exth.isbn = text();
        break;
      case 105:
        if (text()) exth.subjects.push(text());
        break;
      case 106:
        exth.date = text();
        break;
      case 113:
        exth.asin = text();
        break;
      case 121: {
        const value = uint();
        if (value !== undefined) exth.kf8Boundary = value;
        break;
      }
      case 201: {
        const value = uint();
        if (value !== undefined) exth.coverOffset = value;
        break;
      }
      case 202: {
        const value = uint();
        if (value !== undefined) exth.thumbnailOffset = value;
        break;
      }
      case 503:
        exth.title = text();
        break;
      case 524:
        if (text()) exth.languages.push(text());
        break;
      default:
        break;
    }
    at += length;
  }
  return exth;
}

export function decodeText(bytes: Uint8Array, encoding: number): string {
  // 65001 is UTF-8; 1252 is the only other encoding Kindle files use.
  return new TextDecoder(encoding === 1252 ? 'windows-1252' : 'utf-8').decode(bytes);
}

/** PalmDOC's LZ77 variant (compression 2). */
export function decompressPalmDoc(input: Uint8Array): Buffer {
  const out = Buffer.alloc(Math.max(4096, input.length * 8));
  let length = 0;
  const push = (byte: number): void => {
    if (length >= out.length) throw new MobiError('PalmDOC 解压结果超出预期', 'CORRUPT');
    out[length++] = byte;
  };
  for (let i = 0; i < input.length; i += 1) {
    const byte = input[i]!;
    if (byte === 0 || (byte >= 0x09 && byte <= 0x7f)) push(byte);
    else if (byte <= 0x08) {
      // The next `byte` bytes are literals.
      for (let n = 0; n < byte && i + 1 < input.length; n += 1) push(input[++i]!);
    } else if (byte <= 0xbf) {
      // A back-reference: 11 bits of distance, 3 bits of length (+3).
      const pair = (byte << 8) | (input[++i] ?? 0);
      const distance = (pair & 0x3fff) >> 3,
        count = (pair & 0x07) + 3;
      if (distance === 0 || distance > length) throw new MobiError('PalmDOC 回溯越界', 'CORRUPT');
      for (let n = 0; n < count; n += 1) push(out[length - distance]!);
    } else {
      // A space followed by a character.
      push(0x20);
      push(byte ^ 0x80);
    }
  }
  return out.subarray(0, length);
}

/**
 * HUFF/CDIC (compression 17480): a Huffman code over a dictionary of phrases that
 * may themselves be compressed. Rare, but some publishers' MOBI 6 files use it.
 */
export function huffCdicDecompressor(
  load: (index: number) => Buffer,
  huffRecord: number,
  huffCount: number,
): (input: Uint8Array) => Buffer {
  const huff = load(huffRecord);
  if (huff.toString('latin1', 0, 4) !== 'HUFF') throw new MobiError('缺少 HUFF 记录', 'CORRUPT');
  const offset1 = huff.readUInt32BE(8),
    offset2 = huff.readUInt32BE(12);
  const table1 = Array.from({ length: 256 }, (_, i) => {
    const value = huff.readUInt32BE(offset1 + i * 4);
    return { found: (value & 0x80) !== 0, codeLength: value & 0x1f, term: value >>> 8 };
  });
  const minCode: number[] = [0],
    maxCode: number[] = [0];
  for (let i = 0; i < 32; i += 1) {
    minCode.push(huff.readUInt32BE(offset2 + i * 8));
    maxCode.push(huff.readUInt32BE(offset2 + i * 8 + 4));
  }
  const dictionary: Array<{ bytes: Buffer; done: boolean }> = [];
  for (let r = 1; r < huffCount; r += 1) {
    const cdic = load(huffRecord + r);
    if (cdic.toString('latin1', 0, 4) !== 'CDIC') throw new MobiError('缺少 CDIC 记录', 'CORRUPT');
    const headerLength = cdic.readUInt32BE(4),
      entries = cdic.readUInt32BE(8),
      codeLength = cdic.readUInt32BE(12);
    const body = cdic.subarray(headerLength);
    const n = Math.min(1 << codeLength, entries - dictionary.length);
    for (let i = 0; i < n; i += 1) {
      const at = body.readUInt16BE(i * 2);
      const head = body.readUInt16BE(at);
      dictionary.push({ bytes: body.subarray(at + 2, at + 2 + (head & 0x7fff)), done: (head & 0x8000) !== 0 });
    }
  }
  const decompress = (input: Uint8Array, depth: number): Buffer => {
    if (depth > 32) throw new MobiError('HUFF 字典嵌套过深', 'CORRUPT');
    const parts: Buffer[] = [];
    const bits = input.length * 8;
    // Read 32 bits at a time from an arbitrary bit position, padding past the end with zeros.
    const peek = (position: number): number => {
      let value = 0;
      for (let k = 0; k < 5; k += 1) value = value * 256 + (input[(position >> 3) + k] ?? 0);
      return Math.floor(value / 2 ** (8 - (position & 7))) % 2 ** 32;
    };
    for (let position = 0; position < bits;) {
      const word = peek(position);
      const entry = table1[word >>> 24]!;
      let codeLength = entry.codeLength,
        term = entry.term;
      if (!entry.found) {
        while (codeLength < 32 && Math.floor(word / 2 ** (32 - codeLength)) < minCode[codeLength]!) codeLength += 1;
        term = maxCode[codeLength]!;
      }
      if (codeLength === 0) throw new MobiError('HUFF 编码无效', 'CORRUPT');
      position += codeLength;
      if (position > bits) break;
      const index = term - Math.floor(word / 2 ** (32 - codeLength));
      const phrase = dictionary[index];
      if (!phrase) throw new MobiError('HUFF 字典越界', 'CORRUPT');
      if (!phrase.done) {
        phrase.bytes = decompress(phrase.bytes, depth + 1);
        phrase.done = true;
      }
      parts.push(phrase.bytes);
    }
    return Buffer.concat(parts);
  };
  return (input) => decompress(input, 0);
}

/** Strips the per-record trailers that `trailingFlags` announces. */
export function trimTrailingEntries(record: Buffer, flags: number): Buffer {
  let end = record.length;
  // Bits 1..15: each is a trailer whose size is a backwards variable-length number at the very end.
  for (let bit = 1; bit < 16; bit += 1) {
    if (!(flags & (1 << bit))) continue;
    let size = 0;
    for (let k = Math.max(0, end - 4); k < end; k += 1) {
      const byte = record[k]!;
      if (byte & 0x80) size = 0;
      size = (size << 7) | (byte & 0x7f);
    }
    end = Math.max(0, end - size);
  }
  // Bit 0: multibyte overlap, whose length is in the low two bits of the last byte, plus that byte.
  if (flags & 1 && end > 0) end = Math.max(0, end - ((record[end - 1]! & 0x03) + 1));
  return record.subarray(0, end);
}

/** A forward variable-length number: 7 bits per byte, the last byte has its top bit set. */
export function readVarLen(buf: Uint8Array, at: number): { value: number; length: number } {
  let value = 0,
    length = 0;
  while (length < 4 && at + length < buf.length) {
    const byte = buf[at + length]!;
    value = (value << 7) | (byte & 0x7f);
    length += 1;
    if (byte & 0x80) break;
  }
  return { value, length };
}

export interface IndexEntry {
  name: string;
  tags: Map<number, number[]>;
}
export interface IndexData {
  entries: IndexEntry[];
  cncx: Map<number, string>;
}

/**
 * An INDX table: the header record (with its TAGX tag description), the entry
 * records, then CNCX records holding the strings entries refer to by offset.
 */
export function readIndex(load: (index: number) => Buffer, first: number, encoding: number): IndexData {
  const head = load(first);
  if (head.toString('latin1', 0, 4) !== 'INDX') throw new MobiError('索引记录无效', 'CORRUPT');
  const headerLength = head.readUInt32BE(4),
    recordCount = head.readUInt32BE(24),
    cncxCount = head.readUInt32BE(52);
  const tagx = head.subarray(headerLength);
  if (tagx.toString('latin1', 0, 4) !== 'TAGX') throw new MobiError('缺少 TAGX', 'CORRUPT');
  const tagxLength = tagx.readUInt32BE(4),
    controlBytes = tagx.readUInt32BE(8);
  const tagTable: Array<{ tag: number; values: number; mask: number; end: boolean }> = [];
  for (let at = 12; at + 4 <= tagxLength; at += 4) {
    tagTable.push({ tag: tagx[at]!, values: tagx[at + 1]!, mask: tagx[at + 2]!, end: (tagx[at + 3]! & 1) === 1 });
  }
  const cncx = new Map<number, string>();
  for (let c = 0; c < cncxCount; c += 1) {
    const record = load(first + recordCount + 1 + c);
    for (let at = 0; at < record.length;) {
      const start = at;
      const { value, length } = readVarLen(record, at);
      if (length === 0) break;
      at += length;
      cncx.set(c * 0x10000 + start, decodeText(record.subarray(at, at + value), encoding));
      at += value;
    }
  }
  const entries: IndexEntry[] = [];
  for (let r = 0; r < recordCount; r += 1) {
    const record = load(first + 1 + r);
    if (record.toString('latin1', 0, 4) !== 'INDX') throw new MobiError('索引记录无效', 'CORRUPT');
    const idxt = record.readUInt32BE(20),
      count = record.readUInt32BE(24);
    for (let e = 0; e < count; e += 1) {
      const offset = record.readUInt16BE(idxt + 4 + e * 2);
      const nameLength = record[offset]!;
      const name = record.toString('latin1', offset + 1, offset + 1 + nameLength);
      const controlAt = offset + 1 + nameLength;
      let at = controlAt + controlBytes,
        controlIndex = 0;
      const present: Array<{ tag: number; valueCount: number; valueBytes: number; values: number }> = [];
      for (const { tag, values, mask, end } of tagTable) {
        if (end) {
          controlIndex += 1;
          continue;
        }
        const masked = record[controlAt + controlIndex]! & mask;
        if (masked === 0) continue;
        if (masked === mask && bitCount(mask) > 1) {
          // All bits set means "the byte count follows as a variable-length number".
          const { value, length } = readVarLen(record, at);
          at += length;
          present.push({ tag, valueCount: 0, valueBytes: value, values });
        } else {
          present.push({ tag, valueCount: masked >> trailingZeros(mask), valueBytes: 0, values });
        }
      }
      const tags = new Map<number, number[]>();
      for (const { tag, valueCount, valueBytes, values } of present) {
        const list: number[] = [];
        if (valueCount > 0) {
          for (let k = 0; k < valueCount * values; k += 1) {
            const v = readVarLen(record, at);
            list.push(v.value);
            at += v.length;
          }
        } else {
          for (let consumed = 0; consumed < valueBytes;) {
            const v = readVarLen(record, at);
            list.push(v.value);
            at += v.length;
            consumed += v.length;
          }
        }
        tags.set(tag, list);
      }
      entries.push({ name, tags });
    }
  }
  return { entries, cncx };
}

function bitCount(value: number): number {
  let n = 0;
  for (let v = value; v; v >>= 1) n += v & 1;
  return n;
}
function trailingZeros(value: number): number {
  let n = 0;
  for (let v = value; v && !(v & 1); v >>= 1) n += 1;
  return n;
}

/** An embedded font: optionally XOR-obfuscated, optionally zlib-compressed. */
export function readFontRecord(record: Buffer): Buffer {
  const flags = record.readUInt32BE(8),
    dataStart = record.readUInt32BE(12),
    keyLength = record.readUInt32BE(16),
    keyStart = record.readUInt32BE(20);
  let data = Buffer.from(record.subarray(dataStart));
  if (flags & 2 && keyLength > 0) {
    const key = record.subarray(keyStart, keyStart + keyLength);
    const span = Math.min(keyLength === 16 ? 1024 : 1040, data.length);
    for (let i = 0; i < span; i += 1) data[i] = data[i]! ^ key[i % keyLength]!;
  }
  if (flags & 1) data = inflateSync(data);
  return data;
}

/** The media type of a resource, from its first bytes. */
export function sniffResource(data: Buffer): string {
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  if (data.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (data.toString('latin1', 0, 3) === 'GIF') return 'image/gif';
  if (data.toString('latin1', 0, 2) === 'BM') return 'image/bmp';
  if (data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (data.toString('latin1', 0, 4) === 'OTTO') return 'font/otf';
  if (data.readUInt32BE(0) === 0x00010000 || data.toString('latin1', 0, 4) === 'true') return 'font/ttf';
  if (data.toString('latin1', 0, 4) === 'wOFF') return 'font/woff';
  if (data.toString('latin1', 0, 4) === 'wOF2') return 'font/woff2';
  if (/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(data.toString('utf8', 0, 256))) return 'image/svg+xml';
  return 'application/octet-stream';
}
