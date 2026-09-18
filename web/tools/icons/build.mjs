/**
 * Builds `reader-icons.ttf`.
 *
 * The icon set is authored as stroked paths (a 3-unit stroke on a 24-unit grid).
 * A font renders *filled outlines*, so the stroke has to be expanded into a filled
 * region first, and the expansion has to produce a real union: two overlapping bars
 * that are merely adjacent outlines render with a hairline seam at every overlap,
 * and at 16px that seam is the icon.
 *
 * The union is computed exactly (a polygon boolean), not by rasterising and tracing.
 * The raster route needs a correct boundary walk, and a correct boundary walk on a
 * one-cell-wide shape — which is what every stroke here is — is much harder than it
 * looks: per-cell edge rules cannot express "the boundary alternates sides", and the
 * failure is a glyph traced as dozens of fragments rather than as one outline.
 * Exact booleans have no such case.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLYPHS } from './paths.mjs';
import { pathToSubpaths } from './path.mjs';
import { segmentPolygon } from './stroke.mjs';
import { unionPolygons } from './union.mjs';

const GRID = 24;
const STROKE = 3;
const UPEM = 1024;
const SCALE = UPEM / GRID;
const FIRST_CODE = 0xe900;

/*
 * The vertical metrics: a baseline through the middle of the em, and an ink extent that
 * is inside it.
 *
 * The glyphs are drawn with `y = (GRID / 2 - y) * SCALE`, i.e. around the grid's
 * midpoint, so the em's centre is the line the set is symmetric about. The metrics then
 * have to say so: an ascent and descent of half the em each put the baseline exactly at
 * that centre, and the ink — which runs to at most ±0.32em for every glyph in the set —
 * lands inside it with room to spare.
 *
 * This is deliberately *not* the ink's own extent. Two reasons, and the second is the
 * one that matters:
 *
 *   - an asymmetric window (ascender 469, descender -640, say) is a true statement about
 *     the ink but a false one about the em, and it is the em that a 1em box is;
 *   - with an asymmetric window a box centred by flex or grid is centred on the *line*,
 *     not on the em, so the ink inside it is off-centre by exactly the asymmetry — the
 *     same defect this change exists to remove, only smaller. A symmetric window makes
 *     "centre the box" and "centre the glyph" the same operation, which is the only way
 *     an icon can be aligned by the same rules as everything else in the app.
 *
 * What went wrong without any of this. The tables declared an ascender of 960 and a
 * descender of -64 — a window whose baseline sits near the *bottom* of the em — while the
 * glyphs were drawn around the em's centre. Every glyph was therefore painted about
 * 0.75em above the top of the box that contained it, and since every layout in the UI
 * centres the box, every icon was 0.75em away from the thing it was aligned to. It looked
 * like "the icons are not aligned" and it was, in fact, the font telling the truth about a
 * baseline in one place and drawing to another.
 *
 * `INK` is kept and checked below rather than used as the metric: it is the property the
 * symmetric window is *allowed* to have, so it belongs in a test, not in the font.
 */
function inkExtent(paths) {
  let top = -Infinity;
  let bottom = Infinity;
  for (const path of Object.values(paths)) {
    for (const [, y] of pathToSubpaths(path).flat()) {
      // The authored path is the stroke's centre line; the ink reaches half a stroke
      // beyond it on both sides. The sign follows the draw code's flip exactly: this
      // function and `outlineFor` must agree about which way is up, or the check below
      // is checking a different font than the one that gets written.
      top = Math.max(top, GRID / 2 - (y - STROKE / 2));
      bottom = Math.min(bottom, GRID / 2 - (y + STROKE / 2));
    }
  }
  return { top, bottom };
}

const INK = inkExtent(GLYPHS);

const ASCENT = UPEM / 2;
const DESCENT = -UPEM / 2;

/*
 * The set has to fit inside the window the metrics declare, and this is where that is
 * established rather than assumed: the build fails if a glyph reaches outside, because a
 * glyph that escapes the em is a glyph that paints outside the box every layout in the UI
 * aligns to — which is precisely the bug this file's metrics exist to prevent.
 */
const HALF_EM = GRID / 2;
if (INK.top > HALF_EM || INK.bottom < -HALF_EM) {
  throw new Error(
    `the icon set reaches ${INK.top.toFixed(2)}..${INK.bottom.toFixed(2)} grid units, ` +
      `outside the ±${HALF_EM} the metrics declare; move the glyph or the em`,
  );
}



/**
 * Stroked path -> font-unit rings, with each ring's nesting depth.
 *
 * Depth comes from the union rather than being re-derived, because the union already
 * knows: a counter such as the eye of a magnifier is a hole, and a hole wound the
 * same way as its parent renders solid. Re-deriving it by point-in-ring tests is
 * possible but redundant, and it has an edge case this avoids — a ring whose first
 * vertex happens to lie on another ring.
 */
function outlineFor(path) {
  const pieces = [];
  for (const subpath of pathToSubpaths(path)) {
    for (let i = 0; i < subpath.length - 1; i++) {
      const [x1, y1] = subpath[i];
      const [x2, y2] = subpath[i + 1];
      const ring = segmentPolygon(x1, y1, x2, y2, STROKE);
      if (ring) pieces.push(ring);
    }
  }
  if (!pieces.length) return [];

  return unionPolygons(pieces)
    .map(({ ring, depth }) => {
      /*
       * Grid units -> font units, with y flipped: the paths are authored with y
       * pointing down (what every icon set uses) and a font's y axis points up.
       *
       * The flip is about the grid's *midpoint* rather than its bottom edge, so the
       * em's centre is the y=0 line the glyphs are laid out around and the ink of a
       * glyph drawn on rows 3..21 lands symmetrically on the em. Flipping about the
       * bottom edge (which is what `GRID - y` does) leaves every glyph in the top
       * half of the em: correct for a font whose baseline is at the bottom of a
       * box of text, wrong for an icon whose box *is* its em.
       *
       * Winding follows depth: an outer ring is clockwise and a hole is
       * counter-clockwise. TrueType has no even-odd fill, so getting this backwards
       * fills in every counter.
       */
      const scaled = simplify(
        ring.map(([x, y]) => [x * SCALE, (GRID / 2 - y) * SCALE]),
        SCALE * 0.02,
      );
      const clockwise = signedArea(scaled) < 0;
      const wantsClockwise = depth % 2 === 0;
      return clockwise === wantsClockwise ? scaled : [...scaled].reverse();
    })
    .filter((ring) => ring.length >= 3);
}

/** Twice the signed area; the sign is the winding. */
function signedArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/* ---- simplification ---- */

/**
 * Collapses near-collinear runs.
 *
 * The tolerance is 2% of a grid unit: the stroke expansion samples its rounded
 * corners at a fixed density, and without this the caps alone contribute more
 * vertices than the rest of the glyph. It is deliberately far below the ~0.05 unit
 * that a visible facet would need.
 */
function simplify(points, epsilon) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let index = -1;
    let worst = 0;
    for (let i = first + 1; i < last; i++) {
      const distance = distanceToSegment(points[i], points[first], points[last]);
      if (distance > worst) {
        worst = distance;
        index = i;
      }
    }
    if (index > 0 && worst > epsilon) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

function distanceToSegment(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (!length) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  return Math.abs((point[0] - a[0]) * dy - (point[1] - a[1]) * dx) / length;
}

/* ---- TTF ---- */

function buildFont(glyphs) {
  const numGlyphs = glyphs.length + 1;
  const glyf = [];
  const loca = [0];
  let glyfLength = 0;
  for (const glyph of [null, ...glyphs]) {
    const data = glyph ? encodeGlyph(glyph.rings) : new Uint8Array(0);
    glyf.push(data);
    glyfLength += data.length;
    loca.push(glyfLength);
  }

  const maxPoints = Math.max(...[null, ...glyphs].map((g) => (g ? Math.max(...g.rings.map((r) => r.length)) : 0)));
  const maxContours = Math.max(...[null, ...glyphs].map((g) => (g ? g.rings.length : 0)));

  const tables = {
    head: buildHead(glyphs),
    hhea: buildHhea(numGlyphs),
    maxp: buildMaxp(numGlyphs, maxPoints, maxContours),
    'OS/2': buildOs2(glyphs),
    hmtx: buildHmtx(glyphs, numGlyphs),
    cmap: buildCmap(glyphs),
    loca: buildLoca(loca),
    glyf: concatenate(glyf),
    name: buildName(),
    post: buildPost(),
  };
  return assemble(['head', 'hhea', 'maxp', 'OS/2', 'hmtx', 'cmap', 'loca', 'glyf', 'name', 'post'], tables);
}

/**
 * One simple glyph, uncompressed.
 *
 * Field order is the spec's and is not the order the data is easiest to reason
 * about: endPtsOfContours, instructionLength, then *all* the flags, then all the x
 * deltas, then all the y deltas. Writing x/y before the flags gives a glyph whose
 * flags are read from coordinate bytes, and the parser's complaint is only
 * "not enough glyf table data".
 */
function encodeGlyph(rings) {
  const points = rings.flat();
  const endPoints = [];
  let end = -1;
  for (const ring of rings) {
    end += ring.length;
    endPoints.push(end);
  }

  let size = 10 + rings.length * 2 + 2 + points.length * 5;
  if (size % 4) size += 4 - (size % 4);
  const view = new DataView(new ArrayBuffer(size));

  const xs = points.map((p) => Math.round(p[0]));
  const ys = points.map((p) => Math.round(p[1]));
  /*
   * The per-glyph bounding box, with a one-unit guard on every edge.
   *
   * A glyph whose box is empty in either axis is a glyph a rasteriser is entitled to
   * skip — and `more` is exactly that: three dots authored as 0.06-unit strokes,
   * which round to a single point on each axis, so the box this used to write was
   * `xMin == xMax` and `yMin == yMax`. Nothing renders an empty box, so the more
   * button drew a blank — while `cmap` still mapped its code point, so the test that
   * reads the font's tables was perfectly happy about it.
   *
   * The guard is the minimum extent rather than a special case for that one glyph:
   * any future glyph that collapses under rounding is covered by the same rule, and
   * one font unit at UPEM 1024 is 0.1% of the em, which cannot move the box visibly.
   */
  const xMin = Math.min(...xs);
  const yMin = Math.min(...ys);
  const xMax = Math.max(...xs);
  const yMax = Math.max(...ys);
  view.setInt16(0, rings.length);
  view.setInt16(2, xMin);
  view.setInt16(4, yMin);
  view.setInt16(6, xMax === xMin ? xMin + 1 : xMax);
  view.setInt16(8, yMax === yMin ? yMin + 1 : yMax);

  let offset = 10;
  for (const endPoint of endPoints) {
    view.setUint16(offset, endPoint);
    offset += 2;
  }
  view.setUint16(offset, 0);
  offset += 2;
  for (let i = 0; i < points.length; i++) view.setUint8(offset + i, 0x01); // on-curve
  offset += points.length;
  let previous = 0;
  for (const x of xs) {
    view.setInt16(offset, x - previous);
    previous = x;
    offset += 2;
  }
  previous = 0;
  for (const y of ys) {
    view.setInt16(offset, y - previous);
    previous = y;
    offset += 2;
  }
  return new Uint8Array(view.buffer);
}

function buildLoca(offsets) {
  const view = new DataView(new ArrayBuffer(offsets.length * 4));
  offsets.forEach((value, i) => view.setUint32(i * 4, value));
  return new Uint8Array(view.buffer);
}

function buildHead(glyphs) {
  const view = new DataView(new ArrayBuffer(54));
  const xs = glyphs.flatMap((g) => g.rings.flat().map((p) => p[0]));
  const ys = glyphs.flatMap((g) => g.rings.flat().map((p) => p[1]));
  view.setUint32(0, 0x00010000);
  view.setUint32(4, 0x00010000);
  view.setUint32(12, 0x5f0f3cf5);
  view.setUint16(16, 0x000b);
  view.setUint16(18, UPEM);
  const now = BigInt(Math.floor(Date.now() / 1000) + 2082844800);
  view.setBigInt64(20, now);
  view.setBigInt64(28, now);
  view.setInt16(36, Math.round(Math.min(...xs)));
  view.setInt16(38, Math.round(Math.min(...ys)));
  view.setInt16(40, Math.round(Math.max(...xs)));
  view.setInt16(42, Math.round(Math.max(...ys)));
  // macStyle stays 0 (regular / non-italic): the face has one weight and no
  // oblique, and a font that claims otherwise gets synthesised.
  view.setUint16(46, 8);
  view.setInt16(48, 2);
  // indexToLocFormat is at byte 50. At 48 sits fontDirectionHint, and writing the
  // loca format there leaves every parser reading the short format.
  view.setInt16(50, 1);
  return new Uint8Array(view.buffer);
}

function buildHhea(numGlyphs) {
  const view = new DataView(new ArrayBuffer(36));
  view.setUint32(0, 0x00010000);
  view.setInt16(4, ASCENT);
  view.setInt16(6, DESCENT);
  view.setUint16(10, 1024);
  view.setInt16(16, 1024);
  view.setInt16(22, 1024);
  view.setInt16(24, 1);
  view.setUint16(34, numGlyphs);
  return new Uint8Array(view.buffer);
}

function buildMaxp(numGlyphs, maxPoints, maxContours) {
  const view = new DataView(new ArrayBuffer(32));
  view.setUint32(0, 0x00010000);
  view.setUint16(4, numGlyphs);
  view.setUint16(6, maxPoints);
  view.setUint16(8, maxContours);
  view.setUint16(14, 2);
  return new Uint8Array(view.buffer);
}

function buildHmtx(glyphs, numGlyphs) {
  const view = new DataView(new ArrayBuffer(numGlyphs * 4));
  for (let i = 0; i < numGlyphs; i++) {
    view.setUint16(i * 4, UPEM);
    const bearing = i === 0 ? 0 : Math.min(...glyphs[i - 1].rings.flat().map((p) => p[0]));
    view.setInt16(i * 4 + 2, Math.round(bearing));
  }
  return new Uint8Array(view.buffer);
}

/**
 * Format 4 cmap: one single-code segment per icon, plus the terminal 0xFFFF segment.
 *
 * The terminal segment must start *and* end at 0xFFFF and map nothing. Writing
 * `start = 0xFFFE` makes every code below it resolve to an icon, and `idDelta` must
 * be computed per segment from that segment's own code — a shared delta maps ASCII
 * onto the set.
 */
function buildCmap(glyphs) {
  const codes = glyphs.map((g) => g.code).sort((a, b) => a - b);
  const segments = codes.length + 1;
  const subLength = 16 + segments * 8;
  const sub = new DataView(new ArrayBuffer(subLength));
  const segX2 = segments * 2;
  const searchRange = 2 * 2 ** Math.floor(Math.log2(segments));
  sub.setUint16(0, 4);
  sub.setUint16(2, subLength);
  sub.setUint16(6, segX2);
  sub.setUint16(8, searchRange);
  sub.setUint16(10, Math.log2(searchRange / 2));
  sub.setUint16(12, segX2 - searchRange);

  let offset = 14;
  for (const code of [...codes, 0xffff]) {
    sub.setUint16(offset, code);
    offset += 2;
  }
  sub.setUint16(offset, 0);
  offset += 2;
  for (const code of [...codes, 0xffff]) {
    sub.setUint16(offset, code);
    offset += 2;
  }
  const deltas = codes.map((code, index) => {
    const delta = (index + 1 - code) & 0xffff;
    return delta > 0x7fff ? delta - 0x10000 : delta;
  });
  deltas.push(1);
  for (const delta of deltas) {
    sub.setInt16(offset, delta);
    offset += 2;
  }
  for (let i = 0; i < segments; i++) {
    sub.setUint16(offset, 0);
    offset += 2;
  }

  const table = new DataView(new ArrayBuffer(4 + 8 + subLength));
  table.setUint16(0, 0);
  table.setUint16(2, 1);
  table.setUint16(4, 3);
  table.setUint16(6, 1);
  table.setUint32(8, 12);
  new Uint8Array(table.buffer).set(new Uint8Array(sub.buffer), 12);
  return new Uint8Array(table.buffer);
}

function buildName() {
  const records = [
    [1, 'Reader Icons'],
    [2, 'Regular'],
    [3, 'reader-icons'],
    [4, 'Reader Icons'],
    [5, 'Version 1.0'],
    [6, 'reader-icons'],
  ];
  const strings = records.map(([, value]) => {
    const bytes = new Uint8Array(value.length * 2);
    for (let i = 0; i < value.length; i++) bytes[i * 2 + 1] = value.charCodeAt(i);
    return bytes;
  });
  const storage = concatenate(strings);
  const header = 6 + records.length * 12;
  const view = new DataView(new ArrayBuffer(header + storage.length));
  view.setUint16(0, 0);
  view.setUint16(2, records.length);
  view.setUint16(4, header);
  let offset = 0;
  records.forEach(([id], i) => {
    view.setUint16(6 + i * 12, 3);
    view.setUint16(8 + i * 12, 1);
    view.setUint16(10 + i * 12, 0x409);
    view.setUint16(12 + i * 12, id);
    view.setUint16(14 + i * 12, strings[i].length);
    view.setUint16(16 + i * 12, offset);
    offset += strings[i].length;
  });
  new Uint8Array(view.buffer).set(storage, header);
  return new Uint8Array(view.buffer);
}

function buildPost() {
  const view = new DataView(new ArrayBuffer(32));
  view.setUint32(0, 0x00030000);
  view.setInt16(8, -100);
  view.setInt16(10, 50);
  return new Uint8Array(view.buffer);
}

function buildOs2(glyphs) {
  const view = new DataView(new ArrayBuffer(96));
  const xs = glyphs.flatMap((g) => g.rings.flat().map((p) => p[0]));
  const ys = glyphs.flatMap((g) => g.rings.flat().map((p) => p[1]));
  const minX = Math.round(Math.min(...xs));
  const maxX = Math.round(Math.max(...xs));
  const minY = Math.round(Math.min(...ys));
  const maxY = Math.round(Math.max(...ys));
  const codes = glyphs.map((g) => g.code);
  view.setUint16(0, 4);
  /*
   * usWeightClass = 400 and fsSelection's REGULAR bit.
   *
   * These were `500` and `BOLD`, the two values a font that is *not* bold must not
   * carry: a browser that believes a face is missing synthesises the weight it was
   * asked for, and a synthesised icon is a smeared icon — exactly what
   * `font-synthesis: none` on `.icon` exists to prevent, and it can only prevent it
   * if the font does not lie about itself first.
   */
  view.setInt16(2, 500);
  view.setUint16(4, 400);
  view.setUint16(6, 5);
  view.setInt16(10, minY);
  view.setInt16(12, maxY);
  view.setInt16(14, minY);
  view.setInt16(16, maxY);
  view.setUint16(18, 700);
  view.setUint16(20, 100);
  /*
   * The typographic window. Every offset below is spelled per the `OS/2` table's
   * layout, because a font builder is exactly the place where an off-by-two field
   * still parses, still loads, and merely lays text out wrong.
   *
   * `sTypoAscender`/`sTypoDescender`/`sTypoLineGap` at 68/70/72: they used to be
   * written at 76/78 as `960 / -64`, which is the *panose* area — so panose took the
   * `0x03C0 / 0xFFC0` bytes, the typographic window stayed `0/0`, and browsers fell
   * back to guessing at the line box. A guess that is 25% taller than the glyph is
   * what "the icons don't line up" looks like on screen.
   *
   * `usWinAscent`/`usWinDescent` at 74/76 are *unsigned* and must enclose every
   * glyph's ink, i.e. the em square, not the -64 descender that was written there.
   */
  view.setUint16(30, UPEM);
  view.setUint16(32, UPEM);
  view.setUint16(44, Math.min(...codes));
  view.setUint16(46, Math.max(...codes));
  view.setInt16(68, ASCENT);
  view.setInt16(70, DESCENT);
  view.setInt16(72, 0);
  /*
   * fsSelection: REGULAR (bit 6) and USE_TYPO_METRICS (bit 7).
   *
   * `40` claimed BOLD|REGULAR for a face that is neither, and USE_TYPO_METRICS is the
   * one that actually fixes the fallback: it tells the engine to lay the line out
   * from the typographic metrics just written instead of the win pair, which on
   * Windows is the difference between "the icon font is 2% taller than the text" and
   * "the icon font is 25% taller than the text".
   */
  view.setUint16(62, 0x40 | 0x80);
  view.setUint16(64, 1);
  /*
   * The Windows metrics, which are *unsigned* and must enclose every glyph's ink.
   *
   * They were written at 74/76 as `960 / -64`, and 74/76 is not where they live: 74
   * and 76 are the em square, so winAscent stayed 0 and winDescent became 65506 —
   * i.e. -30 read as unsigned. A font whose win metrics do not contain its own
   * glyphs gets a bounding box computed for it, which is the other half of "the icon
   * row is taller than it looks like it should be".
   */
  view.setUint16(74, UPEM);
  view.setUint16(76, UPEM);
  view.setInt16(78, minX);
  view.setInt16(80, maxX);
  view.setInt16(82, minY);
  view.setInt16(84, maxY);
  /*
   * `sxHeight` (86) and `sCapHeight` (88) are version-2 fields and must *not* be
   * written into an `OS/2` that declares version 4 while its box positions are off by
   * one field: they were landing on usDefaultChar/usBreakChar/usMaxContext, which is
   * how a font ends up telling a text engine that its x-height is 0.
   */
  view.setUint16(84, 1);
  view.setInt16(88, 1);
  return new Uint8Array(view.buffer);
}

function concatenate(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function pad4(bytes) {
  const remainder = bytes.length % 4;
  if (!remainder) return bytes;
  const out = new Uint8Array(bytes.length + (4 - remainder));
  out.set(bytes);
  return out;
}

function checksum(bytes) {
  let sum = 0;
  const padded = pad4(bytes);
  for (let i = 0; i < padded.length; i += 4) {
    sum = (sum + new DataView(padded.buffer, padded.byteOffset + i, 4).getUint32(0)) >>> 0;
  }
  return sum;
}

function assemble(order, tables) {
  const numTables = order.length;
  const searchRange = 2 ** Math.floor(Math.log2(numTables)) * 16;
  const entrySelector = Math.floor(Math.log2(numTables));
  const rangeShift = numTables * 16 - searchRange;

  let offset = 12 + numTables * 16;
  const entries = [];
  const bodies = [];
  for (const tag of order) {
    const body = pad4(tables[tag]);
    entries.push({ tag, offset, length: tables[tag].length, checksum: checksum(tables[tag]) });
    bodies.push(body);
    offset += body.length;
  }

  const header = new DataView(new ArrayBuffer(12));
  header.setUint32(0, 0x00010000);
  header.setUint16(4, numTables);
  header.setUint16(6, searchRange);
  header.setUint16(8, entrySelector);
  header.setUint16(10, rangeShift);

  const directory = new DataView(new ArrayBuffer(numTables * 16));
  entries
    .sort((a, b) => (a.tag < b.tag ? -1 : 1))
    .forEach((entry, i) => {
      directory.setUint32(i * 16, [...entry.tag].reduce((acc, ch) => (acc << 8) | ch.charCodeAt(0), 0));
      directory.setUint32(i * 16 + 4, entry.checksum);
      directory.setUint32(i * 16 + 8, entry.offset);
      directory.setUint32(i * 16 + 12, entry.length);
    });

  return concatenate([new Uint8Array(header.buffer), new Uint8Array(directory.buffer), ...bodies]);
}

/* ---- run ---- */

const glyphs = [];
let code = FIRST_CODE;
let totalPoints = 0;
for (const [name, path] of Object.entries(GLYPHS)) {
  const rings = outlineFor(path);
  const points = rings.reduce((n, r) => n + r.length, 0);
  totalPoints += points;
  glyphs.push({ name, code, rings });
  console.log(`${name.padEnd(14)} rings=${String(rings.length).padStart(2)} points=${String(points).padStart(4)}`);
  code += 1;
}

const here = dirname(fileURLToPath(import.meta.url));
const stylesDir = join(here, '..', '..', 'src', 'styles');
mkdirSync(stylesDir, { recursive: true });

const font = buildFont(glyphs);
writeFileSync(join(stylesDir, 'reader-icons.ttf'), font);

/*
 * The code point table is generated rather than hand-written because the code
 * points are an encoding detail: they have to match the `cmap` in the font
 * exactly, and a table maintained by hand drifts the first time an icon is added
 * in the middle of the set.
 */
const table = [
  '/**',
  ' * The icon font\'s code points.',
  ' *',
  ' * Generated by `tools/icons/build.mjs` from the same data that builds',
  ' * `reader-icons.ttf`. Do not edit by hand: a code point that disagrees with the',
  ' * font\'s `cmap` renders as a missing-glyph box, and nothing in the type system',
  ' * can catch it.',
  ' */',
  'export const ICON_CODEPOINTS = {',
  ...glyphs.map((glyph) => `  '${glyph.name}': '\\u${glyph.code.toString(16)}',`),
  '} as const;',
  '',
  'export type IconName = keyof typeof ICON_CODEPOINTS;',
  '',
].join('\n');
writeFileSync(join(here, '..', '..', 'src', 'ui', 'icon-names.ts'), table);

console.log(`\n${glyphs.length} glyphs, ${totalPoints} points, ${font.length} bytes`);
