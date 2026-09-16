import { describe, expect, it } from 'vitest';
import { detectFormat } from '../src/formats/detect.ts';
import { BookArchive, dirnameOf, normalise, resolveHref } from '../src/formats/zip.ts';
import { makeCbz } from './helpers/fixtures.ts';

/**
 * The archive and resolution helpers.
 *
 * These are the lowest-level pieces of the format layer and the ones whose bugs
 * are hardest to see: a mis-resolved href does not throw, it silently produces a
 * broken image on one page of one book.
 */

describe('BookArchive', () => {
  it('lists files but not directory entries', async () => {
    const archive = await BookArchive.open(await makeCbz([{ name: 'a/001.png' }, { name: 'a/002.png' }]));
    expect(archive.names().sort()).toEqual(['a/001.png', 'a/002.png']);
  });

  it('reads an entry as bytes and as text', async () => {
    const archive = await BookArchive.open(await makeCbz([{ name: 'note.txt', bytes: new TextEncoder().encode('hello') }]));
    expect(await archive.text('note.txt')).toBe('hello');
    expect((await archive.bytes('note.txt'))?.byteLength).toBe(5);
  });

  it('finds an entry whose path differs only by case or leading slash', async () => {
    // Archives produced on Windows and by some comic tools carry either.
    const archive = await BookArchive.open(await makeCbz([{ name: 'Pages/001.png' }]));
    expect(await archive.bytes('pages/001.png')).not.toBeNull();
    expect(await archive.bytes('/Pages/001.png')).not.toBeNull();
  });

  it('returns null for a genuinely absent entry instead of throwing', async () => {
    const archive = await BookArchive.open(await makeCbz([{ name: 'a.png' }]));
    expect(await archive.bytes('missing.png')).toBeNull();
    expect(await archive.text('missing.png')).toBeNull();
  });
});

describe('normalise', () => {
  it('lowercases, strips a leading slash and percent-decodes', () => {
    expect(normalise('/Pages/%E4%B8%AD.png')).toBe('pages/中.png');
    expect(normalise('./a/b.png')).toBe('a/b.png');
  });
});

describe('dirnameOf', () => {
  it('returns an empty string for a root-level file', () => {
    expect(dirnameOf('a.png')).toBe('');
  });

  it('returns everything before the last slash', () => {
    expect(dirnameOf('a/b/c.png')).toBe('a/b');
  });
});

describe('resolveHref', () => {
  it('does not let a traversal escape above the archive root', () => {
    // '../../../etc/passwd' must resolve to a path inside the archive, never to
    // an absolute one. The result is looked up in a map either way, but a
    // resolver that can produce `../../` is the kind of thing that later becomes
    // a real file read.
    const resolved = resolveHref('a', '../../../etc/passwd');
    expect(resolved.startsWith('/')).toBe(false);
    expect(resolved.includes('..')).toBe(false);
  });

  it('treats a scheme-qualified href as absolute', () => {
    expect(resolveHref('a', 'mailto:x@example.com')).toBe('mailto:x@example.com');
    expect(resolveHref('a', 'https://x/y')).toBe('https://x/y');
  });

  it('drops a query string but keeps the fragment out of the path', () => {
    expect(resolveHref('a', 'b.png?v=2#frag')).toBe('a/b.png');
  });

  it('handles a dot-segment in the middle of a path', () => {
    expect(resolveHref('a/b', './c/./d.png')).toBe('a/b/c/d.png');
  });
});

describe('detectFormat edge cases', () => {
  it('prefers the extension when a zip could be either', () => {
    const zipMagic = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(detectFormat('x.cbz', zipMagic)).toBe('cbz');
    expect(detectFormat('x.epub', zipMagic)).toBe('epub');
  });

  it('does not mistake a plain zip of pages for an EPUB', () => {
    const zipMagic = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(detectFormat('pages.zip', zipMagic)).toBe('cbz');
  });

  it('returns unknown for an empty file with an unknown extension', () => {
    expect(detectFormat('x.dat', new Uint8Array())).toBe('unknown');
  });

  it('detects an image by extension when there are no bytes yet', () => {
    expect(detectFormat('scan.JPG')).toBe('image');
  });

  it('believes the bytes over an extension that cannot be right', () => {
    // The realistic case, not a hypothetical one: a batch conversion tool writes
    // a JPEG and names it after the source page. Trusting the extension means the
    // PNG loader runs on JPEG bytes and the reader sees a broken image.
    expect(detectFormat('page-012.png', jpeg())).toBe('image');
    expect(detectFormat('chapter.xhtml', png())).toBe('image');
  });

  it('refuses a non-book that happens to have a book extension', () => {
    // An audio file named `.txt` used to be handed to the text decoder, which
    // produced fifty thousand replacement characters rather than "this is not a
    // book". Naming it unknown is the honest answer.
    expect(detectFormat('track.txt', new Uint8Array([0x49, 0x44, 0x33, 0x03]))).toBe('unknown');
    expect(detectFormat('video.epub', new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBe('unknown');
  });

  it('still lets the extension break the tie between two plausible zip formats', () => {
    // The ZIP signature admits EPUB and CBZ, so this is the one case where the
    // name is still evidence rather than noise.
    const zipMagic = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(detectFormat('some-comic.cbz', zipMagic)).toBe('cbz');
    expect(detectFormat('some-book.epub', zipMagic)).toBe('epub');
  });
});

function png(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function jpeg(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
}
