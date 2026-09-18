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

/**
 * The font's vertical metrics.
 *
 * These are the numbers that decide whether an icon is *aligned*, and they are the ones
 * this file did not check while the icons were half an em out of place: `cmap` was
 * verified, the glyph names were verified, and the metrics — the only part a layout reads
 * — were not.
 *
 * The contract has two halves and both are needed:
 *
 *   - the ascent and descent must be equal, because a `1em` box is symmetric and every
 *     container in the UI centres a box. Asymmetric metrics make "centre the box" and
 *     "centre the glyph" two different operations, and the difference is exactly the
 *     asymmetry — which is how the icons were misaligned by a different amount in every
 *     row of the product.
 *   - no glyph's ink may leave that window. A glyph that reaches outside the em paints
 *     outside the box the layout aligned to, which is the same defect by another route,
 *     and it is invisible to every check that only reads a table.
 */
function fontTables() {
  const font = readFileSync(join(process.cwd(), 'src/styles/reader-icons.ttf'));
  const numTables = font.readUInt16BE(4);
  const offsets: Record<string, number> = {};
  for (let i = 0; i < numTables; i++) {
    const entry = 12 + i * 16;
    offsets[font.toString('ascii', entry, entry + 4)] = font.readUInt32BE(entry + 8);
  }
  const unitsPerEm = font.readUInt16BE(offsets.head + 18);
  const numGlyphs = font.readUInt16BE(offsets.maxp + 4);
  return {
    font,
    offsets,
    unitsPerEm,
    numGlyphs,
    hheaAscent: font.readInt16BE(offsets.hhea + 4),
    hheaDescent: font.readInt16BE(offsets.hhea + 6),
    typoAscent: font.readInt16BE(offsets['OS/2'] + 68),
    typoDescent: font.readInt16BE(offsets['OS/2'] + 70),
    winAscent: font.readUInt16BE(offsets['OS/2'] + 74),
    winDescent: font.readUInt16BE(offsets['OS/2'] + 76),
    selection: font.readUInt16BE(offsets['OS/2'] + 62),
    weightClass: font.readUInt16BE(offsets['OS/2'] + 4),
  };
}

describe('the font metrics', () => {
  it('declares a symmetric window, so a centred box is a centred glyph', () => {
    const t = fontTables();
    // The em's middle is the line the glyphs are drawn around, and the metrics have to
    // say the same thing or every container that centres an icon centres it off by the
    // difference. Zero would be symmetric too and is what the font used to declare by
    // accident, which sends an engine to a fallback it has to guess at.
    expect(t.hheaAscent).toBe(t.unitsPerEm / 2);
    expect(t.hheaDescent).toBe(-t.unitsPerEm / 2);
    expect(t.typoAscent).toBe(t.hheaAscent);
    expect(t.typoDescent).toBe(t.hheaDescent);
  });

  it('declares Windows metrics that are unsigned and contain the em', () => {
    const t = fontTables();
    // These were written at the wrong offsets for as long as the font existed, so they
    // read as 0 / 65506 (-30, read unsigned) — a window that does not contain the glyphs
    // it describes. An engine that falls back to them computes a box instead of using one.
    expect(t.winAscent).toBe(t.unitsPerEm);
    expect(t.winDescent).toBe(t.unitsPerEm);
  });

  it('tells engines to use the typographic metrics, and that the face is regular', () => {
    const t = fontTables();
    // Without USE_TYPO_METRICS a Windows engine prefers the win pair, so getting the win
    // metrics right above is only half of it.
    expect(t.selection & 0x80).toBeTruthy();
    expect(t.selection & 0x40).toBeTruthy(); // regular
    expect(t.selection & 0x20).toBeFalsy(); // ... and not bold
    expect(t.weightClass).toBe(400);
  });

  it('keeps every glyph inside the em the metrics declare', () => {
    const t = fontTables();
    // Walk `glyf` through `loca` and read each glyph's own bounding box — that box *is*
    // the glyph's ink in its own coordinate system, so it is exactly what has to fit.
    const offsets = [...Array(t.numGlyphs + 1)].map((_, i) => t.font.readUInt32BE(t.offsets.loca + 4 * i));
    for (let gid = 1; gid <= t.numGlyphs; gid++) {
      if (offsets[gid + 1] === offsets[gid]) continue;
      const start = t.offsets.glyf + offsets[gid];
      const yMin = t.font.readInt16BE(start + 4);
      const yMax = t.font.readInt16BE(start + 8);
      expect(yMin, `glyph ${gid} reaches below the descender`).toBeGreaterThanOrEqual(-t.unitsPerEm / 2);
      expect(yMax, `glyph ${gid} reaches above the ascender`).toBeLessThanOrEqual(t.unitsPerEm / 2);
    }
  });

  it('gives every non-blank glyph a non-empty bounding box', () => {
    const t = fontTables();
    // An empty box is a glyph a rasteriser is entitled to skip, and `more` was one: three
    // dots authored as 0.06-unit strokes rounded to a single point on each axis. The
    // button drew blank while `cmap` still mapped its code point, so every table-reading
    // assertion above was satisfied by a font that could not draw its own ellipsis.
    const offsets = [...Array(t.numGlyphs + 1)].map((_, i) => t.font.readUInt32BE(t.offsets.loca + 4 * i));
    for (let gid = 1; gid <= t.numGlyphs; gid++) {
      if (offsets[gid + 1] === offsets[gid]) continue;
      const start = t.offsets.glyf + offsets[gid];
      const numContours = t.font.readInt16BE(start);
      if (numContours <= 0) continue;
      expect(t.font.readInt16BE(start + 6) - t.font.readInt16BE(start + 2), `glyph ${gid} has no width`).toBeGreaterThan(0);
      expect(t.font.readInt16BE(start + 8) - t.font.readInt16BE(start + 4), `glyph ${gid} has no height`).toBeGreaterThan(0);
    }
  });
});

describe('the icon box', () => {
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

/**
 * The stylesheet's half of the contract.
 *
 * The font can only be right; whether the icon ends up where the font says is decided in
 * CSS. These read `.icon` out of the real stylesheet, because the rules that matter are
 * the ones that were wrong and a test that re-states them in its own words would have
 * been updated alongside the bug.
 */
describe('the stylesheet', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles/reader.css'), 'utf8');
  const iconRule = /(^|\n)\.icon \{([^}]*)\}/.exec(css)?.[2] ?? '';
  const declaration = (property: string): string | undefined =>
    new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(iconRule)?.[1]?.trim();

  it('lets the font own the line box instead of imposing a square on it', () => {
    // `line-height: 1` gives the icon the font's own line box, which is symmetric because
    // the font's metrics are. A fixed `height: 1em` plus `line-height: 0` anchors a box at
    // the baseline while the ink is drawn around it, so the ink lands at the box's top
    // edge and everything that centres the box centres the glyph half an em off — which is
    // exactly what shipped, measured at 0.496em across `menu`, `close` and `folder`.
    expect(declaration('line-height')).toBe('1');
    expect(declaration('height')).toBeUndefined();
  });

  it('keeps an explicit advance width', () => {
    // The one thing the layout needs that the font cannot supply: a row of icons and
    // labels has to be laid out the same way whatever glyphs are in it.
    expect(declaration('width')).toBe('1em');
  });

  it('aligns on the middle for the rows that are not flex or grid', () => {
    // In a paragraph, `baseline` would put the icon's baseline on the text's, and the icon
    // has no baseline in the text sense — its ink is centred on the em.
    expect(declaration('vertical-align')).toBe('middle');
  });

  it('does not move the glyph with a transform', () => {
    // A transform would also move the ink inside a flex or grid container, where
    // `vertical-align` is inert — but it moves the glyph at paint time, so the space the
    // icon reserves stops agreeing with the space it appears to occupy.
    expect(declaration('transform')).toBeUndefined();
  });

  it('is applied by every icon button, including the hand-built ones', () => {
    // The glyph has to be `.icon` for any of the above to reach it, and a button that
    // builds its own markup is where that gets forgotten.
    const sources = ['toolkit.tsx', 'shelf-screen.tsx', 'manager-screen.tsx', 'reader-chrome.tsx', 'shelf-settings.tsx'];
    for (const source of sources) {
      const text = readFileSync(join(process.cwd(), 'src/ui', source), 'utf8');
      // A raw `<button className="icon-button">` is the shape that drifts; the primitive
      // and the icon-name type are what make the glyph's class a consequence rather than
      // a convention.
      expect(text.includes('className="icon-button'), `${source} hand-builds an icon button`).toBe(false);
      expect(text.includes("className={'icon-button"), `${source} hand-builds an icon button`).toBe(false);
    }
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
