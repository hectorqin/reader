// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICON_CODEPOINTS } from '../src/ui/icon-names.ts';
import { GLYPHS } from '../tools/icons/paths.mjs';

/**
 * The icon set's contract with the font.
 *
 * These are the parts that cannot be caught by the type system and would fail
 * *silently* in the browser: a code point the font does not define renders as a
 * missing-glyph box, and a glyph name in the table that has no path in the source
 * means the font and the table were built from different inputs. Both look like a
 * stray square in a toolbar, which is easy to miss and impossible to trace back.
 *
 * The font is parsed here by reading its `cmap` directly rather than by embedding a
 * font parser: the table is small, and a test that depends on a font library is a
 * test that breaks when the library does.
 */

/** Reads the format-4 `cmap` of the bundled font and returns the code points it maps. */
function fontCodePoints(): Set<number> {
  const font = readFileSync(join(process.cwd(), 'src/styles/reader-icons.ttf'));
  const numTables = font.readUInt16BE(4);
  let cmapOffset = 0;
  for (let i = 0; i < numTables; i++) {
    const entry = 12 + i * 16;
    if (font.toString('ascii', entry, entry + 4) === 'cmap') cmapOffset = font.readUInt32BE(entry + 8);
  }
  expect(cmapOffset).toBeGreaterThan(0);

  // Only one encoding record is written: Windows / Unicode BMP.
  const subtable = cmapOffset + font.readUInt32BE(cmapOffset + 8);
  expect(font.readUInt16BE(subtable)).toBe(4); // format 4

  const segCount = font.readUInt16BE(subtable + 6) / 2;
  const endBase = subtable + 14;
  const startBase = endBase + segCount * 2 + 2;
  const deltaBase = startBase + segCount * 2;

  const mapped = new Set<number>();
  for (let segment = 0; segment < segCount; segment++) {
    const end = font.readUInt16BE(endBase + segment * 2);
    const start = font.readUInt16BE(startBase + segment * 2);
    const delta = font.readInt16BE(deltaBase + segment * 2);
    for (let code = start; code <= end && code !== 0xffff; code++) {
      // Every segment here maps one code to one glyph by addition.
      if (((code + delta) & 0xffff) !== 0) mapped.add(code);
    }
  }
  return mapped;
}

describe('the icon font and its code point table', () => {
  const mapped = fontCodePoints();
  const table = Object.values(ICON_CODEPOINTS).map((value) => value.codePointAt(0)!);

  it('maps every code point the table declares', () => {
    // A code point in the table that the font does not map is a missing-glyph box.
    for (const code of table) {
      expect(mapped.has(code), `0x${code.toString(16)} is not in the font cmap`).toBe(true);
    }
  });

  it('does not map anything outside the private use area', () => {
    // The set has to be unreachable by typing: a font that also mapped ASCII would
    // turn ordinary text into icons wherever the family is applied.
    for (const code of mapped) {
      expect(code, `0x${code.toString(16)} is outside the private use area`).toBeGreaterThanOrEqual(0xe000);
      expect(code).toBeLessThanOrEqual(0xf8ff);
    }
  });

  it('has one code point per icon, with no duplicates', () => {
    expect(new Set(table).size).toBe(table.length);
    expect(mapped.size).toBe(table.length);
  });

  it('was built from the same glyph names as the table', () => {
    // Catches the case where the font is rebuilt from edited paths but the table is
    // stale (or the reverse): the names are the join between the two.
    const tableNames = Object.keys(ICON_CODEPOINTS).sort();
    const sourceNames = Object.keys(GLYPHS).sort();
    expect(tableNames).toEqual(sourceNames);
  });

  it('assigns code points in the same order as the source, starting at 0xE900', () => {
    const names = Object.keys(GLYPHS);
    names.forEach((name, index) => {
      const expected = 0xe900 + index;
      expect((ICON_CODEPOINTS as Record<string, string>)[name]!.codePointAt(0)).toBe(expected);
    });
  });
});

describe('the Icon component', () => {
  it('renders the glyph and hides it from assistive technology when decorative', async () => {
    const { Icon } = await import('../src/ui/icon.tsx');
    const { render } = await import('../src/ui/vendor/preact.ts');
    const host = document.createElement('div');
    render(Icon({ name: 'close' }), host);
    const span = host.querySelector('.icon')!;
    expect(span.textContent).toBe(ICON_CODEPOINTS.close);
    expect(span.getAttribute('aria-hidden')).toBe('true');
    expect(span.hasAttribute('aria-label')).toBe(false);
  });

  it('exposes a label as its accessible name when it is not decorative', async () => {
    const { Icon } = await import('../src/ui/icon.tsx');
    const { render } = await import('../src/ui/vendor/preact.ts');
    const host = document.createElement('div');
    render(Icon({ name: 'close', label: '关闭' }), host);
    const span = host.querySelector('.icon')!;
    // `role="img"` is what makes a labelled span announce as an image rather than
    // as a stray character, which is what a bare span containing a PUA code point
    // would do.
    expect(span.getAttribute('role')).toBe('img');
    expect(span.getAttribute('aria-label')).toBe('关闭');
    expect(span.hasAttribute('aria-hidden')).toBe(false);
  });
});

describe('icon buttons', () => {
  it('carries the label as the accessible name and hides the glyph', async () => {
    const { IconButton } = await import('../src/ui/toolkit.tsx');
    const { render } = await import('../src/ui/vendor/preact.ts');
    const host = document.createElement('div');
    render(IconButton({ label: '目录', icon: 'menu' }), host);
    const button = host.querySelector('button')!;
    // The name must be on the *button*: a glyph inside an aria-labelled button is
    // read by some screen readers as well, which is why the glyph is aria-hidden.
    expect(button.getAttribute('aria-label')).toBe('目录');
    const glyph = button.querySelector('.icon')!;
    expect(glyph.getAttribute('aria-hidden')).toBe('true');
    expect(glyph.textContent).toBe(ICON_CODEPOINTS.menu);
  });

  it('draws every icon button from the icon set rather than from text', async () => {
    const { IconButton } = await import('../src/ui/toolkit.tsx');
    const { render } = await import('../src/ui/vendor/preact.ts');
    const host = document.createElement('div');
    render(IconButton({ label: '关闭', icon: 'close' }), host);
    // A regression here is the whole point of the change: the old button took
    // arbitrary children, and Unicode punctuation is what it was given.
    expect(host.querySelector('.icon')).not.toBeNull();
    expect(host.textContent).toBe(ICON_CODEPOINTS.close);
  });
});
