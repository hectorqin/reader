/**
 * Natural ordering for page and volume names.
 *
 * `page10.jpg` must sort after `page2.jpg`; the naive string comparison the
 * library used before put volume 10 between 1 and 2, which silently scrambles
 * the reading order of every comic in the library. That is the kind of bug the
 * user only notices after finishing a chapter in the wrong order.
 *
 * Implemented here rather than via `localeCompare` because ICU collation differs
 * between Node builds and platforms (musl vs glibc, alpine vs debian), and a
 * self-hosted product has to produce the same page order on every host.
 */

const cache = new Map<string, Array<string | number>>();

function tokenize(input: string): Array<string | number> {
  const cached = cache.get(input);
  if (cached) return cached;

  const tokens: Array<string | number> = [];
  const re = /(\d+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    if (match.index > last) tokens.push(input.slice(last, match.index).toLowerCase());
    // Number.parseInt keeps `007` and `7` in the same position, which is what
    // scanners produce when they zero pad page numbers inconsistently.
    tokens.push(Number.parseInt(match[1]!, 10));
    last = match.index + match[1]!.length;
  }
  if (last < input.length) tokens.push(input.slice(last).toLowerCase());

  // Bounded: a library with 100k files would otherwise hold every filename
  // tokenised in memory for the lifetime of the process.
  if (cache.size > 20_000) cache.clear();
  cache.set(input, tokens);
  return tokens;
}

export function naturalCompare(a: string, b: string): number {
  const left = tokenize(a);
  const right = tokenize(b);
  const len = Math.min(left.length, right.length);

  for (let i = 0; i < len; i += 1) {
    const x = left[i]!;
    const y = right[i]!;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    // Numbers sort before text so `1.jpg` precedes `cover.jpg` consistently.
    if (typeof x === 'number') return -1;
    if (typeof y === 'number') return 1;
    return x < y ? -1 : 1;
  }

  if (left.length === right.length) return 0;
  return left.length < right.length ? -1 : 1;
}

export function naturalSortBy<T>(items: readonly T[], pick: (item: T) => string): T[] {
  return [...items].sort((a, b) => naturalCompare(pick(a), pick(b)));
}
