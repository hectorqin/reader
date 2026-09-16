/**
 * Natural ordering for page and chapter names.
 *
 * Shared with the client by intent rather than by imports: the two are separate
 * build targets with no common module, and the rule itself is small enough that
 * duplicating it is cheaper than a shared package. The behaviour must match,
 * because the server's page count and the client's page order have to agree.
 *
 * `1, 2, 10` rather than `1, 10, 2`. A comic sorted lexicographically reads in the
 * wrong order, which is not a cosmetic bug.
 */
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
    const lower = ls.localeCompare(rs, undefined, { sensitivity: 'base', numeric: false });
    if (lower !== 0) return lower;
    return ls < rs ? -1 : 1;
  }
  return 0;
}

function splitChunks(value: string): Array<string | number> {
  const chunks: Array<string | number> = [];
  for (const part of value.split(/(\\d+)/)) {
    if (part === '') continue;
    if (/^\\d+$/.test(part)) {
      // Long zero-padded runs would lose precision as a float.
      chunks.push(part.length > 15 ? Number.parseInt(part, 10) : Number(part));
    } else {
      chunks.push(part);
    }
  }
  return chunks;
}
