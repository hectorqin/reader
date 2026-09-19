// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renditionRef } from '../src/ui/rendition.ts';

/**
 * Which reference the reader asks the server for.
 *
 * It is a *rename* that these pin, and a rename is the kind of change that either
 * breaks a shipped client silently or is a no-op. Two halves have to hold:
 *
 *  - a TXT chapter keeps being asked for as one *whole* chapter (not the streaming
 *    `chapter:` window), under the new name; and
 *  - every other format is passed through untouched, because the reference is the
 *    server's own and is also the identity an offline cache is keyed on — a client
 *    that renamed an EPUB's href would ask for a chapter that does not exist.
 *
 * The old name (`chapter-html:`) is what shipped clients ask for; the server still
 * answers it. Nothing here asserts on the old spelling beyond the fact that this
 * client no longer produces it, which is what the rename is.
 */
describe('the reference a section is fetched under', () => {
  it('asks for the whole chapter, under the name that says so', () => {
    // The name is the point: this reference stopped being HTML when the server
    // stopped typesetting, and a reference whose name lies about its content is how
    // the next change reasons wrongly about it.
    expect(renditionRef({ href: 'chapter:12', format: 'html' })).toBe('chapter-full:12');
  });

  it('never asks for the old spelling', () => {
    // A regression that "works" — the server answers both — and leaves every
    // offline cache keyed under a name the client no longer reads. The assertion is
    // on the string because that is what the cache key and the request are.
    expect(renditionRef({ href: 'chapter:0', format: 'html' })).not.toContain('chapter-html');
  });

  it('passes every other format through unchanged', () => {
    // The reference is opaque and server-owned for everything but this one case.
    // Renaming an EPUB href here is the bug this branch exists to prevent: the href
    // is a file path inside the archive, and `xhtml:OEBPS/ch1.xhtml` is not a
    // `chapter:<n>` anyone can prefix.
    expect(renditionRef({ href: 'xhtml:OEBPS/ch1.xhtml', format: 'html' })).toBe('xhtml:OEBPS/ch1.xhtml');
    expect(renditionRef({ href: 'chapter:3' })).toBe('chapter:3');
    expect(renditionRef({ href: 'page:0', format: 'image' })).toBe('page:0');
    expect(renditionRef({ href: 'chunk:4096' })).toBe('chunk:4096');
  });
});
