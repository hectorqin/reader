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
       * Winding follows depth: an outer ring is clockwise and a hole is
       * counter-clockwise. TrueType has no even-odd fill, so getting this backwards
       * fills in every counter.
       */
      const scaled = simplify(
        ring.map(([x, y]) => [x * SCALE, (GRID - y) * SCALE]),
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
  view.setInt16(0, rings.length);
  view.setInt16(2, Math.min(...xs));
  view.setInt16(4, Math.min(...ys));
  view.setInt16(6, Math.max(...xs));
  view.setInt16(8, Math.max(...ys));

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
  view.setInt16(4, 960);
  view.setInt16(6, -64);
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
  view.setInt16(2, 500);
  view.setUint16(4, 400);
  view.setUint16(6, 5);
  view.setInt16(10, minY);
  view.setInt16(12, maxY);
  view.setInt16(14, minY);
  view.setInt16(16, maxY);
  view.setUint16(18, 700);
  view.setUint16(20, 100);
  view.setInt16(24, 960);
  view.setInt16(26, -64);
  view.setUint16(30, UPEM);
  view.setUint16(32, UPEM);
  view.setUint16(44, Math.min(...codes));
  view.setUint16(46, Math.max(...codes));
  view.setInt16(48, 960);
  view.setInt16(50, -64);
  view.setUint16(62, 40);
  view.setUint16(64, 1);
  view.setInt16(76, minX);
  view.setInt16(78, maxX);
  view.setInt16(80, minY);
  view.setInt16(82, maxY);
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
