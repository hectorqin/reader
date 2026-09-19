// @vitest-environment jsdom
/**
 * The reverse of the server's chapter-link rewrite.
 *
 * The server turns a chapter's own cross-reference (`<a href="ch2.xhtml">`) into an
 * absolute asset URL, because a relative href resolves to nothing once the document
 * is served from outside the archive. The client has to read that URL back as *a
 * chapter* — otherwise a tap on an EPUB's own table of contents downloads another
 * document and renders it as an asset, which is the reported "点击章节没有反应" in
 * its most literal form.
 */
import { describe, expect, it } from 'vitest';
import { BOOK_RESOURCE_MARKER, chapterRefFromLink } from '../src/formats/book-resource.ts';

const BASE = 'http://reader.local/';

function assetUrl(ref: string, fragment = ''): string {
  return `/api/v1/books/b1/assets?${BOOK_RESOURCE_MARKER}=1&ref=${encodeURIComponent(ref)}${fragment}`;
}

describe('chapterRefFromLink', () => {
  it('reads the server-ref of a chapter document back as a section id', () => {
    expect(chapterRefFromLink(assetUrl('OEBPS/ch2.xhtml'), BASE)).toBe('xhtml:OEBPS/ch2.xhtml');
    expect(chapterRefFromLink(assetUrl('OEBPS/ch2.htm'), BASE)).toBe('xhtml:OEBPS/ch2.htm');
    expect(chapterRefFromLink(assetUrl('OEBPS/ch2.html'), BASE)).toBe('xhtml:OEBPS/ch2.html');
    expect(chapterRefFromLink(assetUrl('OEBPS/nav.xml'), BASE)).toBe('xhtml:OEBPS/nav.xml');
  });

  it('keeps a fragment out of the section id', () => {
    // The fragment is "a position *inside* that chapter" — the chapter is the
    // destination, and the id has to be exactly what the manifest publishes or the
    // jump cannot find the window it lives in.
    expect(chapterRefFromLink(assetUrl('OEBPS/ch2.xhtml', '#note3'), BASE)).toBe('xhtml:OEBPS/ch2.xhtml');
  });

  it('answers null for an image the book linked to', () => {
    // An image is not a chapter: the browser's own preview of it is the honest
    // answer to "open this picture", and pretending it is a chapter would jump the
    // reader somewhere arbitrary.
    expect(chapterRefFromLink(assetUrl('OEBPS/pic.png'), BASE)).toBeNull();
  });

  it('answers null for a footnote fragment and for links it does not own', () => {
    expect(chapterRefFromLink('#note3', BASE)).toBeNull();
    expect(chapterRefFromLink('', BASE)).toBeNull();
    expect(chapterRefFromLink('https://example.com/ch2.xhtml', BASE)).toBeNull();
    // A same-origin URL without the marker is not the book's: the marker is the
    // only thing that says "the server wrote this address".
    expect(chapterRefFromLink('/whatever/ch2.xhtml', BASE)).toBeNull();
  });
});
