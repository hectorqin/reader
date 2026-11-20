/**
 * Builds small Kindle files for tests: MOBI 6, KF8 (`.azw3`) and hybrid `.mobi`.
 *
 * Real Kindle books are copyrighted or large, so the tests write their own. The
 * builder is deliberately plain — uncompressed or literal-only PalmDOC text, one
 * entry record per index — but every structure the reader walks is real: record
 * table, PalmDOC/MOBI/EXTH headers, trailing entries, INDX/TAGX/CNCX indexes,
 * FDST flows, skeletons and fragments.
 */

const NONE = 0xffffffff;
const enc = (text: string): Buffer => Buffer.from(text, 'utf8');
const u16 = (value: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(value);
  return b;
};
const u32 = (value: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value >>> 0);
  return b;
};

/** Forward variable-length number: 7 bits per byte, top bit set on the last. */
function varlen(value: number): Buffer {
  const bytes = [(value & 0x7f) | 0x80];
  for (let v = value >>> 7; v > 0; v >>>= 7) bytes.unshift(v & 0x7f);
  return Buffer.from(bytes);
}

/** PalmDOC with literal runs only: valid input that exercises the literal paths. */
export function palmDocLiterals(data: Buffer): Buffer {
  const out: number[] = [];
  for (let i = 0; i < data.length;) {
    const byte = data[i]!;
    if (byte >= 0x09 && byte <= 0x7f) {
      out.push(byte);
      i += 1;
      continue;
    }
    const run = data.subarray(i, i + 8);
    let n = 0;
    while (n < run.length && !(run[n]! >= 0x09 && run[n]! <= 0x7f)) n += 1;
    n = Math.max(1, n);
    out.push(n, ...data.subarray(i, i + n));
    i += n;
  }
  return Buffer.from(out);
}

interface Tag {
  tag: number;
  values: number;
  mask: number;
}
/** One INDX table as records: header (with TAGX), one entry record, one CNCX record. */
function indexRecords(
  tags: Tag[],
  entries: Array<{ name: string; tags: Map<number, number[]> }>,
  cncx: Buffer,
): Buffer[] {
  const tagx = Buffer.concat([
    enc('TAGX'),
    u32(12 + (tags.length + 1) * 4),
    u32(1),
    ...tags.map((t) => Buffer.from([t.tag, t.values, t.mask, 0])),
    Buffer.from([0, 0, 0, 1]),
  ]);
  const headerLength = 56;
  const head = Buffer.alloc(headerLength);
  head.write('INDX', 0, 'latin1');
  head.writeUInt32BE(headerLength, 4);
  head.writeUInt32BE(1, 24);
  head.writeUInt32BE(65001, 28);
  head.writeUInt32BE(1, 52);
  const bodies = entries.map((entry) => {
    let control = 0;
    const values: Buffer[] = [];
    for (const t of tags) {
      const list = entry.tags.get(t.tag);
      if (!list) continue;
      control |= t.mask;
      values.push(...list.map(varlen));
    }
    return Buffer.concat([
      Buffer.from([entry.name.length]),
      Buffer.from(entry.name, 'latin1'),
      Buffer.from([control]),
      ...values,
    ]);
  });
  const recordHeader = 28;
  const offsets: number[] = [];
  let at = recordHeader;
  for (const body of bodies) {
    offsets.push(at);
    at += body.length;
  }
  const idxt = at;
  const entryRecord = Buffer.concat([Buffer.alloc(recordHeader), ...bodies, enc('IDXT'), ...offsets.map(u16)]);
  entryRecord.write('INDX', 0, 'latin1');
  entryRecord.writeUInt32BE(idxt, 20);
  entryRecord.writeUInt32BE(entries.length, 24);
  return [Buffer.concat([head, tagx]), entryRecord, cncx];
}

/** A CNCX record and the offset of each string in it. */
function cncxOf(strings: string[]): { record: Buffer; offsets: number[] } {
  const parts: Buffer[] = [],
    offsets: number[] = [];
  let at = 0;
  for (const text of strings) {
    const bytes = enc(text),
      part = Buffer.concat([varlen(bytes.length), bytes]);
    offsets.push(at);
    parts.push(part);
    at += part.length;
  }
  return { record: Buffer.concat(parts.length ? parts : [Buffer.from([0x80])]), offsets };
}

function exthBlock(fields: Array<[number, Buffer]>): Buffer {
  const records = fields.map(([type, data]) => Buffer.concat([u32(type), u32(8 + data.length), data]));
  const body = Buffer.concat(records);
  const padding = (4 - ((12 + body.length) % 4)) % 4;
  return Buffer.concat([
    enc('EXTH'),
    u32(12 + body.length + padding),
    u32(records.length),
    body,
    Buffer.alloc(padding),
  ]);
}

export interface Record0Options {
  version: number;
  compression: number;
  textLength: number;
  textRecords: number;
  title: string;
  exth: Array<[number, Buffer]>;
  resourceStart: number;
  trailingFlags?: number;
  ncx?: number;
  fdst?: number;
  skel?: number;
  frag?: number;
  encryption?: number;
}

function record0(o: Record0Options): Buffer {
  const headerLength = o.version >= 8 ? 264 : 232;
  const mobi = Buffer.alloc(16 + headerLength);
  mobi.writeUInt16BE(o.compression, 0);
  mobi.writeUInt32BE(o.textLength, 4);
  mobi.writeUInt16BE(o.textRecords, 8);
  mobi.writeUInt16BE(4096, 10);
  mobi.writeUInt16BE(o.encryption ?? 0, 12);
  mobi.write('MOBI', 16, 'latin1');
  mobi.writeUInt32BE(headerLength, 20);
  mobi.writeUInt32BE(2, 24);
  mobi.writeUInt32BE(65001, 28);
  mobi.writeUInt32BE(1234, 32);
  mobi.writeUInt32BE(o.version, 36);
  mobi.writeUInt32BE(o.resourceStart, 108);
  mobi.writeUInt32BE(0, 112);
  mobi.writeUInt32BE(0, 116);
  mobi.writeUInt32BE(0x40, 128);
  mobi.writeUInt32BE(o.fdst ?? NONE, 0xc0);
  mobi.writeUInt32BE(1, 0xc4);
  mobi.writeUInt16BE(o.trailingFlags ?? 0, 0xf2);
  mobi.writeUInt32BE(o.ncx ?? NONE, 0xf4);
  if (o.version >= 8) {
    mobi.writeUInt32BE(o.frag ?? NONE, 0xf8);
    mobi.writeUInt32BE(o.skel ?? NONE, 0xfc);
    mobi.writeUInt32BE(NONE, 0x104);
  }
  const exth = exthBlock(o.exth);
  const name = enc(o.title);
  mobi.writeUInt32BE(mobi.length + exth.length, 84);
  mobi.writeUInt32BE(name.length, 88);
  return Buffer.concat([mobi, exth, name, Buffer.alloc(4)]);
}

/** Text split into records of at most 4096 bytes, with the trailers `flags` announces. */
function textRecords(text: Buffer, compression: number, flags: number): Buffer[] {
  const records: Buffer[] = [];
  for (let at = 0; at < text.length; at += 4096) {
    let record = text.subarray(at, at + 4096);
    if (compression === 2) record = palmDocLiterals(record);
    // Bit 0: one multibyte-overlap byte (low bits 0 = just itself). Bit 1: a 3-byte trailer.
    if (flags & 1) record = Buffer.concat([record, Buffer.from([0])]);
    if (flags & 2) record = Buffer.concat([record, enc('AB'), Buffer.from([0x83])]);
    records.push(record);
  }
  return records;
}

function palmDb(records: Buffer[]): Buffer {
  const header = Buffer.alloc(78);
  header.write('test-book', 0, 'latin1');
  header.write('BOOKMOBI', 60, 'latin1');
  header.writeUInt16BE(records.length, 76);
  let at = 78 + records.length * 8 + 2;
  const table = records.map((record) => {
    const entry = Buffer.concat([u32(at), u32(0)]);
    at += record.length;
    return entry;
  });
  return Buffer.concat([header, ...table, Buffer.alloc(2), ...records]);
}

/** A 1×1 PNG's signature is all the reader looks at. */
export const PNG = Buffer.concat([Buffer.from([0x89]), enc('PNG\r\n\x1a\n'), Buffer.alloc(16, 1)]);

export interface Mobi6Options {
  chapters: string[];
  title?: string;
  author?: string;
  compression?: 1 | 2;
  trailingFlags?: number;
  encryption?: number;
  /** Build an NCX naming each chapter (pointing at its first byte). */
  ncx?: boolean;
}

/**
 * A MOBI 6 book: one HTML body, chapters separated by `<mbp:pagebreak/>`, one image.
 * `{{img}}` in a chapter becomes an image reference; `{{link:N}}` a link to chapter N.
 */
export function buildMobi6(options: Mobi6Options): { file: Buffer; html: string } {
  const head = '<html><head><guide></guide></head><body>';
  const starts: number[] = [];
  let html = head;
  options.chapters.forEach((chapter, index) => {
    if (index) html += '<mbp:pagebreak/>';
    starts.push(Buffer.byteLength(html));
    // Links get a fixed-width placeholder now and their offsets last, so no offset moves.
    html += chapter
      .replace('{{img}}', '<img recindex="00001" />')
      .replace(/\{\{link:(\d+)\}\}/g, (_m, n: string) => `<a filepos=@@@@@@@@@${n}>to ${n}</a>`);
  });
  html += '</body></html>';
  html = html.replace(/@@@@@@@@@(\d)/g, (_m, n: string) => String(starts[Number(n)]).padStart(10, '0'));
  const text = enc(html);
  const compression = options.compression ?? 1,
    flags = options.trailingFlags ?? 0;
  const texts = textRecords(text, compression, flags);
  const resourceStart = 1 + texts.length;
  const records: Buffer[] = [Buffer.alloc(0), ...texts, PNG];
  let ncx: number | undefined;
  if (options.ncx) {
    const labels = cncxOf(options.chapters.map((_, i) => `Chapter ${i + 1}`));
    ncx = records.length;
    records.push(
      ...indexRecords(
        [
          { tag: 1, values: 1, mask: 1 },
          { tag: 3, values: 1, mask: 2 },
          { tag: 4, values: 1, mask: 4 },
        ],
        starts.map((offset, i) => ({
          name: String(i).padStart(3, '0'),
          tags: new Map([
            [1, [offset]],
            [3, [labels.offsets[i]!]],
            [4, [0]],
          ]),
        })),
        labels.record,
      ),
    );
  }
  records[0] = record0({
    version: 6,
    compression,
    textLength: text.length,
    textRecords: texts.length,
    title: options.title ?? 'Test Book',
    exth: [
      [100, enc(options.author ?? 'Ada Writer')],
      [503, enc(options.title ?? 'Test Book')],
      [101, enc('Test Press')],
      [104, enc('9780000000001')],
      [105, enc('Fiction')],
      [201, u32(0)],
    ],
    resourceStart,
    trailingFlags: flags,
    ...(ncx !== undefined ? { ncx } : {}),
    ...(options.encryption ? { encryption: options.encryption } : {}),
  });
  return { file: palmDb(records), html };
}

export interface Kf8Options {
  /** Each chapter's body content. `{{img}}` is an image, `{{link:N}}` a link to chapter N's anchor. */
  chapters: string[];
  title?: string;
  css?: string;
  /** Prefix a MOBI 6 copy, making a hybrid `.mobi`. */
  hybrid?: boolean;
}

/** A KF8 book: one skeleton and one fragment per chapter, a stylesheet flow, an NCX. */
export function buildKf8(options: Kf8Options): Buffer {
  const css = options.css ?? 'p { color: navy; background: url(kindle:embed:0001?mime=image/png); }';
  const skeletons: Buffer[] = [],
    fragments: Buffer[] = [];
  const skelEntries: Array<{ offset: number; length: number }> = [],
    fragEntries: Array<{ insertAt: number; offset: number; length: number; fid: number }> = [];
  let at = 0;
  options.chapters.forEach((chapter, index) => {
    const skeleton = enc(
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>c${index}</title><link rel="stylesheet" href="kindle:flow:0001?mime=text/css"/></head><body aid="${index * 10}"></body></html>`,
    );
    const body = chapter
      .replace('{{img}}', '<img src="kindle:embed:0001?mime=image/png"/>')
      .replace(
        /\{\{link:(\d+)\}\}/g,
        (_m, n: string) =>
          `<a href="kindle:pos:fid:${Number(n).toString(32).toUpperCase().padStart(4, '0')}:off:0000000000">to ${n}</a>`,
      );
    const fragment = enc(`<div aid="${index * 10 + 1}" id="ch${index}">${body}</div>`);
    const insertAt = at + skeleton.indexOf('</body>');
    skelEntries.push({ offset: at, length: skeleton.length });
    fragEntries.push({ insertAt, offset: 0, length: fragment.length, fid: index });
    skeletons.push(skeleton);
    fragments.push(fragment);
    at += skeleton.length + fragment.length;
  });
  const flow0 = Buffer.concat(skeletons.flatMap((s, i) => [s, fragments[i]!]));
  const flow1 = enc(css);
  const text = Buffer.concat([flow0, flow1]);
  const texts = textRecords(text, 2, 0);

  // Records relative to the KF8 header.
  const local: Buffer[] = [Buffer.alloc(0), ...texts];
  const fdst = local.length;
  local.push(
    Buffer.concat([enc('FDST'), u32(12), u32(2), u32(0), u32(flow0.length), u32(flow0.length), u32(text.length)]),
  );
  const skel = local.length;
  local.push(
    ...indexRecords(
      [
        { tag: 1, values: 1, mask: 1 },
        { tag: 6, values: 2, mask: 2 },
      ],
      skelEntries.map((e, i) => ({
        name: `SKEL${String(i).padStart(10, '0')}`,
        tags: new Map([
          [1, [1]],
          [6, [e.offset, e.length]],
        ]),
      })),
      cncxOf([]).record,
    ),
  );
  const selectors = cncxOf(fragEntries.map(() => "P-//*[@aid='0']"));
  const frag = local.length;
  local.push(
    ...indexRecords(
      [
        { tag: 2, values: 1, mask: 1 },
        { tag: 4, values: 1, mask: 2 },
        { tag: 6, values: 2, mask: 4 },
      ],
      fragEntries.map((e, i) => ({
        name: String(e.insertAt).padStart(10, '0'),
        tags: new Map([
          [2, [selectors.offsets[i]!]],
          [4, [e.fid]],
          [6, [e.offset, e.length]],
        ]),
      })),
      selectors.record,
    ),
  );
  const labels = cncxOf(options.chapters.map((_, i) => `第 ${i + 1} 章`));
  const ncx = local.length;
  local.push(
    ...indexRecords(
      [
        { tag: 3, values: 1, mask: 1 },
        { tag: 4, values: 1, mask: 2 },
        { tag: 6, values: 2, mask: 4 },
      ],
      options.chapters.map((_, i) => ({
        name: String(i).padStart(3, '0'),
        tags: new Map([
          [3, [labels.offsets[i]!]],
          [4, [0]],
          [6, [i, 0]],
        ]),
      })),
      labels.record,
    ),
  );

  const exth: Array<[number, Buffer]> = [
    [100, enc('Ada Writer')],
    [503, enc(options.title ?? 'KF8 Book')],
    [201, u32(0)],
  ];
  if (!options.hybrid) {
    const resourceStart = local.length;
    local[0] = record0({
      version: 8,
      compression: 2,
      textLength: text.length,
      textRecords: texts.length,
      title: options.title ?? 'KF8 Book',
      exth,
      resourceStart,
      ncx,
      fdst,
      skel,
      frag,
    });
    return palmDb([...local, PNG]);
  }
  // Hybrid: a MOBI 6 copy, its image, then the KF8 half starting at the boundary.
  const old = enc('<html><body><p>The old MOBI 6 copy.</p></body></html>');
  const oldTexts = textRecords(old, 1, 0);
  const resourceStart = 1 + oldTexts.length;
  const boundary = resourceStart + 1;
  local[0] = record0({
    version: 8,
    compression: 2,
    textLength: text.length,
    textRecords: texts.length,
    title: options.title ?? 'KF8 Book',
    exth,
    resourceStart: NONE,
    ncx,
    fdst,
    skel,
    frag,
  });
  const first = record0({
    version: 6,
    compression: 1,
    textLength: old.length,
    textRecords: oldTexts.length,
    title: 'old',
    exth: [...exth, [121, u32(boundary)]],
    resourceStart,
  });
  return palmDb([first, ...oldTexts, PNG, ...local]);
}
