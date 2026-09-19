// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { adoptWindow, createStagedDoc, isMarkupMediaType, windowIndexOf } from '../src/formats/windowed.ts';
import { HttpRangeSource, RemoteZip, type RangeSource } from '../src/formats/remote-zip.ts';
import type { BookContent, ContentItem } from '../src/net/api.ts';

/**
 * Staged, one-window-at-a-time reading.
 *
 * The property being protected is the product's own hard requirement: opening a
 * book must not download the book. These tests pin the two things that decide
 * whether it holds — that a section's body is fetched only when it is displayed,
 * and that a position survives crossing a window boundary.
 */

function item(index: number): ContentItem {
  return {
    id: `c${index}`,
    seq: index,
    title: `第 ${index + 1} 章`,
    kind: 'chapter',
    mediaType: 'application/xhtml+xml',
    href: `xhtml:ch${index}.xhtml`,
  };
}

/** A plain-text chapter, as the server's manifest declares one. */
function textItem(index: number): ContentItem {
  return {
    id: `c${index}`,
    seq: index,
    title: `第 ${index + 1} 章`,
    kind: 'chapter',
    // The declaration the reader typesets from. `format: 'html'` and a `text/plain`
    // media type are the pair the server actually sends for a TXT.
    mediaType: 'text/plain; charset=utf-8',
    href: `chapter:${index}`,
    format: 'html',
  };
}

function windowOf(from: number, count: number, total: number): BookContent {
  return {
    kind: 'reflowable',
    total,
    groups: [
      { id: `spine:${from}`, seq: from / count, title: `${from}..`, count, offset: from },
    ],
    items: Array.from({ length: count }, (_, i) => item(from + i)),
    group: from / count,
  };
}

describe('staged documents', () => {
  it('carries the manifest\'s plain-text declaration onto the section', async () => {
    // The declaration has to reach the *section*, because that is what the reader
    // asks when it decides whether to typeset. It cannot be re-derived from the body:
    // the server sends a TXT chapter as bare characters with no wrapper, so a body
    // that is nothing but plain text carries nothing to recognise it by — and a
    // reader that answers "not plain text" draws the novel as an unstyled slab.
    const doc = createStagedDoc({
      kind: 'reflowable',
      toc: [],
      content: {
        kind: 'reflowable',
        total: 2,
        groups: [{ id: 'g', seq: 0, title: '', count: 2, offset: 0 }],
        items: [textItem(0), item(1)],
      },
      loader: { async read() { return { html: '第一章\n\n正文。' }; } },
    });

    expect(doc.sections[0]?.plainText).toBe(true);
    // An EPUB chapter in the same window is not swept up by it: the decision is per
    // section, and an EPUB's own markup must survive untouched.
    expect(doc.sections[1]?.plainText).toBeUndefined();
  });

  it('keeps the declaration across a window swap', async () => {
    // A jump to chapter 900 replaces every section. Losing the flag there would turn
    // the rest of the book into an EPUB — paragraphs gone, stylesheet gone — and only
    // after the reader had navigated, which is the hardest kind of defect to report.
    const doc = createStagedDoc({
      kind: 'reflowable',
      toc: [],
      content: {
        kind: 'reflowable',
        total: 4,
        groups: [{ id: 'g', seq: 0, title: '', count: 2, offset: 0 }],
        items: [textItem(0), textItem(1)],
        group: 0,
      },
      loader: { async read() { return { html: '第一章\n\n正文。' }; } },
    });
    expect(doc.sections[0]?.plainText).toBe(true);

    doc.setWindow({
      kind: 'reflowable',
      total: 4,
      groups: [{ id: 'g', seq: 1, title: '', count: 2, offset: 2 }],
      items: [textItem(2), textItem(3)],
      group: 1,
    }, 2);

    expect(doc.sections[0]?.plainText).toBe(true);
  });

  it('separates "typeset this" from "parse this", which is what a TXT needs', async () => {
    // The report: a TXT chapter's paragraphs were all rendered as one. The two
    // questions were one field — `plainText` — and the renderer used it to decide
    // both whether to typeset *and* whether to parse the body as markup. A TXT
    // chapter answers "typeset it" and "it is not markup", so reading the second
    // answer off the first sent the paragraphs the client had just built down the
    // text path, where their tags were stripped and they were joined back into one
    // slab.
    //
    // Answered from the manifest's `mediaType`, which is the server's own statement
    // about its own bytes, and asserted *separately* from `plainText` because it is
    // precisely their disagreement that a TXT is.
    const doc = createStagedDoc({
      kind: 'reflowable',
      toc: [],
      content: {
        kind: 'reflowable',
        total: 2,
        groups: [{ id: 'g', seq: 0, title: '', count: 2, offset: 0 }],
        items: [textItem(0), item(1)],
      },
      loader: { async read() { return { html: '第一章\n正文。' }; } },
    });

    expect(doc.sections[0]?.plainText).toBe(true);
    expect(doc.sections[0]?.bodyIsMarkup).toBe(false);
    // The EPUB chapter in the same window is the mirror image: markup to parse, and
    // not the reader's own text to typeset.
    expect(doc.sections[1]?.plainText).toBeUndefined();
    expect(doc.sections[1]?.bodyIsMarkup).toBe(true);
  });

  it('re-derives the markup answer for a window swap, and forgets nothing', async () => {
    // The answer is a statement about a *chapter's bytes*, so a jump to a different
    // window is a different set of chapters. Carried over from the old window it
    // would be a statement about the wrong chapters — an EPUB window read as text,
    // or a TXT window parsed as markup.
    const doc = createStagedDoc({
      kind: 'reflowable',
      toc: [],
      content: {
        kind: 'reflowable',
        total: 4,
        groups: [{ id: 'g', seq: 0, title: '', count: 2, offset: 0 }],
        items: [textItem(0), textItem(1)],
        group: 0,
      },
      loader: { async read() { return { html: '第一章\n正文。' }; } },
    });
    expect(doc.sections[0]?.bodyIsMarkup).toBe(false);

    doc.setWindow({
      kind: 'reflowable',
      total: 4,
      groups: [{ id: 'g', seq: 1, title: '', count: 2, offset: 2 }],
      items: [item(2), textItem(3)],
      group: 1,
    }, 2);

    expect(doc.sections[0]?.bodyIsMarkup).toBe(true);
    expect(doc.sections[1]?.bodyIsMarkup).toBe(false);
  });

  it('reads the markup answer from the media type, not from the body', () => {
    // A book that *discusses* markup must not be parsed as markup. Deciding from
    // the body means a novel with a `<` in it gets an HTML parser run over it, which
    // is how a paragraph is silently eaten — so the answer comes from the one field
    // that is the server's own statement about its own bytes.
    expect(isMarkupMediaType('application/xhtml+xml')).toBe(true);
    expect(isMarkupMediaType('text/html; charset=utf-8')).toBe(true);
    expect(isMarkupMediaType('text/plain; charset=utf-8')).toBe(false);
    expect(isMarkupMediaType(undefined)).toBe(false);
  });

  it('does not read a section until it is asked for', async () => {
    const read: string[] = [];
    const doc = createStagedDoc({
      kind: 'reflowable',
      toc: [{ id: 'xhtml:ch0.xhtml', label: '第一章', depth: 0 }],
      content: windowOf(0, 40, 1200),
      loader: {
        async read(it) {
          read.push(it.href);
          return { html: `<p>${it.title}</p>` };
        },
      },
    });

    expect(doc.sections).toHaveLength(40);
    expect(read).toEqual([]);

    const section = await doc.loadSection(3);
    expect(read).toEqual(['xhtml:ch3.xhtml']);
    expect(section?.html).toBe('<p>第 4 章</p>');
  });

  it('reads a section once, however often it is displayed', async () => {
    // Re-styling and resizing both re-render the current chapter, so a loader
    // that re-fetched on every call would make a font-size change a network
    // round trip.
    let calls = 0;
    const doc = createStagedDoc({
      kind: 'reflowable',
      toc: [],
      content: windowOf(0, 4, 4),
      loader: {
        async read() {
          calls += 1;
          return { html: '<p>x</p>' };
        },
      },
    });
    await doc.loadSection(0);
    await doc.loadSection(0);
    await doc.loadSection(0);
    expect(calls).toBe(1);
  });

  it('keeps the table of contents whole while the window is not', async () => {
    // The failure this guards against is visible in the UI: a 1200-chapter book
    // whose contents panel reads "第 1 章 – 第 40 章" because that is where the
    // window ended.
    const doc = createStagedDoc({
      kind: 'reflowable',
      toc: Array.from({ length: 1200 }, (_, i) => ({
        id: `xhtml:ch${i}.xhtml`,
        label: `第 ${i + 1} 章`,
        depth: 0,
      })),
      content: windowOf(0, 40, 1200),
      loader: { async read() { return { html: '' }; } },
    });
    expect(doc.sections).toHaveLength(40);
    expect(doc.toc).toHaveLength(1200);
    expect(doc.toc[1199]?.label).toBe('第 1200 章');
  });

  it('swaps a window through either method name it might answer to', async () => {
    // The regression this pins is the reason the 目录 looked dead on a long book:
    // the screen duck-typed a `loadWindow` method off the document, the document
    // answered to `setWindow`, and the check therefore never succeeded — so a
    // jump to a chapter outside the loaded window was a silent no-op. One helper
    // now knows both names, and it is tested with a document that uses *only* the
    // other one.
    const plain = createStagedDoc({
      kind: 'reflowable',
      toc: [],
      content: windowOf(0, 40, 1200),
      loader: { async read() { return { html: '' }; } },
    });
    expect(adoptWindow(plain, windowOf(880, 40, 1200), 900)).toBe(20);
    expect(plain.windowOffset()).toBe(880);

    const legacy = {
      sections: [],
      toc: [],
      loadWindow: (_content: unknown, spine: number) => (spine === 900 ? 20 : -1),
    } as unknown as import('../src/formats/types.ts').BookDoc;
    expect(adoptWindow(legacy, windowOf(880, 40, 1200), 900)).toBe(20);
    expect(adoptWindow(legacy, windowOf(880, 40, 1200), 1)).toBe(-1);
  });

  it('answers -1 for a document that has no window at all', () => {
    // A book read whole (the fallback for a server with no addressable structure)
    // must say so rather than throw, because the caller's next move is to report
    // "this chapter cannot be reached" rather than to crash the reader.
    const whole = { sections: [], toc: [] } as unknown as import('../src/formats/types.ts').BookDoc;
    expect(adoptWindow(whole, windowOf(0, 40, 1200), 0)).toBe(-1);
  });

  it('computes the window from the groups, not from a chapter constant', () => {
    // A comic windows by *volume*, and a volume is not forty pages. Deriving the
    // window from `spine / 40` asks for a group that does not exist and the jump
    // lands nowhere; the manifest's own group sizes are the only authority.
    const volumes: BookContent = {
      kind: 'paged',
      total: 900,
      groups: [
        { id: 'v0', seq: 0, title: '卷一', count: 500, offset: 0 },
        { id: 'v1', seq: 1, title: '卷二', count: 400, offset: 500 },
      ],
      items: [],
    };
    expect(windowIndexOf(volumes, 0)).toBe(0);
    expect(windowIndexOf(volumes, 499)).toBe(0);
    expect(windowIndexOf(volumes, 500)).toBe(1);
    expect(windowIndexOf(volumes, 899)).toBe(1);
    // Past the end clamps to the last group rather than to a nonexistent one.
    expect(windowIndexOf(volumes, 9000)).toBe(1);
  });

  it('falls back to the chapter window when a manifest ships no groups', () => {
    const bare: BookContent = { kind: 'text', total: 120, groups: [], items: [] };
    expect(windowIndexOf(bare, 0)).toBe(0);
    expect(windowIndexOf(bare, 39)).toBe(0);
    expect(windowIndexOf(bare, 40)).toBe(1);
    expect(windowIndexOf(bare, 119)).toBe(2);
  });

  it('finds a whole-book position inside a newly loaded window', async () => {
    const doc = createStagedDoc({
      kind: 'reflowable',
      toc: [],
      content: windowOf(0, 40, 1200),
      loader: { async read() { return { html: '' }; } },
    });
    expect(doc.windowOffset()).toBe(0);

    // Jump to chapter 900: window 22 (900/40), local index 20.
    const local = doc.setWindow(windowOf(880, 40, 1200), 900);
    expect(local).toBe(20);
    expect(doc.windowOffset()).toBe(880);
    expect(doc.sections[20]?.id).toBe('xhtml:ch900.xhtml');
  });

  it('loads a page image for a fixed-layout window', async () => {
    const doc = createStagedDoc({
      kind: 'paged',
      toc: [],
      content: {
        kind: 'paged',
        total: 3,
        groups: [{ id: 'v0', seq: 0, title: '卷', count: 3, offset: 0 }],
        items: [
          { id: '0', seq: 0, title: '001.jpg', kind: 'page', mediaType: 'image/jpeg', href: 'page:0' },
          { id: '1', seq: 1, title: '002.jpg', kind: 'page', mediaType: 'image/jpeg', href: 'page:1' },
          { id: '2', seq: 2, title: '003.jpg', kind: 'page', mediaType: 'image/jpeg', href: 'page:2' },
        ],
        group: 0,
      },
      loader: {
        async read(it) {
          return { image: { mediaType: 'image/jpeg', bytes: new Uint8Array([it.seq]) } };
        },
      },
    });

    expect(doc.layout).toBe('fixed');
    expect(doc.render).toBe('image');
    const section = await doc.loadSection(1);
    expect(section?.image?.bytes[0]).toBe(1);
  });
});

/** A byte source backed by an in-memory buffer, with range accounting. */
function memorySource(bytes: Uint8Array): RangeSource & { reads: Array<[number, number]> } {
  const reads: Array<[number, number]> = [];
  return {
    reads,
    async size() {
      return bytes.byteLength;
    },
    async read(start, end) {
      reads.push([start, end]);
      return bytes.subarray(start, end + 1);
    },
    async whole() {
      return bytes;
    },
  };
}

describe('remote zip', () => {
  it('reads only the central directory and the requested entry', async () => {
    // The whole point: opening an archive must not read it. A test that only
    // checked the returned bytes would pass even if the implementation slurped
    // the file, so this asserts on the ranges that were actually requested.
    const zip = buildStoredZip([
      ['META-INF/container.xml', '<container/>'],
      ['OEBPS/ch1.xhtml', '<html><body>一</body></html>'],
    ]);
    const source = memorySource(zip);
    const remote = await RemoteZip.open(source);
    const beforeEntryReads = source.reads.length;

    const chapter = await remote.bytes('OEBPS/ch1.xhtml');
    expect(new TextDecoder().decode(chapter!)).toContain('一');

    const entryReads = source.reads.slice(beforeEntryReads);
    const requested = entryReads.reduce((sum, [start, end]) => sum + (end - start + 1), 0);
    // Well under the archive, and more than zero: it read something, but not
    // everything.
    expect(requested).toBeLessThan(zip.byteLength);
    expect(requested).toBeGreaterThan(0);
  });

  it('reports a stored entry as byte-addressable and a deflated one as not', async () => {
    const zip = buildStoredZip([['page.jpg', 'raw-bytes']]);
    const remote = await RemoteZip.open(memorySource(zip));
    expect(remote.isSeekable('page.jpg')).toBe(true);
    const url = await remote.resourceUrl('page.jpg', 'https://host/api/v1/books/x/content');
    expect(url).toContain('#bytes=');
  });

  it('falls back to a whole-file read when ranges are ignored', async () => {
    // A proxy that strips Range is not an exotic case, and a client that trusted
    // the range response would then inflate the wrong bytes and show garbage.
    const zip = buildStoredZip([['a.txt', 'hello']]);
    let servedWhole = false;
    const source: RangeSource = {
      async size() {
        servedWhole = true;
        return zip.byteLength;
      },
      async read(start, end) {
        return zip.subarray(start, end + 1);
      },
      async whole() {
        return zip;
      },
    };
    const remote = await RemoteZip.open(source);
    expect(servedWhole).toBe(true);
    expect(new TextDecoder().decode((await remote.bytes('a.txt'))!)).toBe('hello');
  });

  it('asks for the last byte once and remembers the size', async () => {
    const zip = buildStoredZip([['a.txt', 'hello']]);
    let probes = 0;
    const source = new HttpRangeSource(async (range) => {
      if (range) {
        probes += 1;
        return { bytes: zip.subarray(range.start, range.end + 1), total: zip.byteLength, ranged: true };
      }
      return { bytes: zip, total: zip.byteLength, ranged: false };
    });
    const size = await source.size();
    await source.size();
    expect(size).toBe(zip.byteLength);
    expect(probes).toBe(1);
  });
});

/** Minimal `stored` ZIP writer, so the tests do not depend on a zip library. */
function buildStoredZip(entries: Array<[string, string]>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const [name, body] of entries) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(body);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, 0, true); // stored
    localView.setUint32(18, data.byteLength, true);
    localView.setUint32(22, data.byteLength, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    chunks.push(local, data);

    const record = new Uint8Array(46 + nameBytes.length);
    const recordView = new DataView(record.buffer);
    recordView.setUint32(0, 0x02014b50, true);
    recordView.setUint16(4, 20, true);
    recordView.setUint16(6, 20, true);
    recordView.setUint16(10, 0, true);
    recordView.setUint32(20, data.byteLength, true);
    recordView.setUint32(24, data.byteLength, true);
    recordView.setUint16(28, nameBytes.length, true);
    recordView.setUint32(42, offset, true);
    record.set(nameBytes, 46);
    central.push(record);

    offset += local.byteLength + data.byteLength;
  }

  const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const all = [...chunks, ...central, end];
  const total = all.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of all) {
    out.set(part, cursor);
    cursor += part.byteLength;
  }
  return out;
}
