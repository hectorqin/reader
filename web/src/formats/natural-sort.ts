/**
 * Natural ordering for chapter and page names.
 *
 * A comic archive almost always names its pages `001.jpg … 010.jpg`, but a
 * scanalator that goes past 99 produces `100.jpg`, and a handful of tools emit
 * `第1话`, `第10话`, `第2话`. Plain lexicographic sort turns those into
 * 1, 10, 2 — a book that reads in the wrong order, which readers notice
 * immediately and never forgive.
 */

const NUMERIC_CHUNK = /(\d+)/;

export function naturalCompare(a: string, b: string): number {
  const left = splitChunks(a);
  const right = splitChunks(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const l = left[index];
    const r = right[index];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (typeof l === 'number' && typeof r === 'number') {
      if (l !== r) return l - r;
      continue;
    }
    const ls = String(l);
    const rs = String(r);
    if (ls === rs) continue;
    // Compare case-insensitively first so `Chapter` and `chapter` do not sort
    // into separate runs, then fall back to a stable tie-break.
    const lower = ls.localeCompare(rs, undefined, { sensitivity: 'base', numeric: false });
    if (lower !== 0) return lower;
    return ls < rs ? -1 : 1;
  }
  return 0;
}

function splitChunks(value: string): Array<string | number> {
  const parts = value.split(NUMERIC_CHUNK);
  const chunks: Array<string | number> = [];
  for (const part of parts) {
    if (part === '') continue;
    if (/^\d+$/.test(part)) {
      // Guard against a leading-zero run long enough to lose precision when
      // parsed as a float: `00000000001` must not become `1e-7`.
      chunks.push(part.length > 15 ? Number.parseInt(part, 10) : Number(part));
    } else {
      chunks.push(part);
    }
  }
  return chunks;
}

export function sortByName<T>(items: T[], nameOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => naturalCompare(nameOf(a), nameOf(b)));
}
