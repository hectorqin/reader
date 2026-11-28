import { textNodes } from './text-anchor.ts';

export interface GlossaryTermRef {
  key: string;
  label: string;
  category: string;
  /** Primary name and aliases; entries shorter than 2 chars are ignored to avoid noisy matches. */
  needles: string[];
}

export interface GlossaryMatchSpan {
  term: GlossaryTermRef;
  start: number;
  end: number;
}

/**
 * Finds non-overlapping occurrences of glossary terms in plain chapter text.
 *
 * Longest needles win first so compound names ("青云玉佩") are matched before
 * shorter substrings ("玉佩"). Per-term and total caps keep pages readable.
 */
export function findGlossaryMatchSpans(
  text: string,
  terms: readonly GlossaryTermRef[],
  maxPerTerm = 2,
  maxTotal = 60,
): GlossaryMatchSpan[] {
  if (!text || !terms.length) return [];
  const lowerText = text.toLowerCase();
  const candidates: Array<{ term: GlossaryTermRef; needle: string; lower: string }> = [];
  for (const term of terms) {
    const seen = new Set<string>();
    for (const raw of term.needles) {
      const clean = raw.trim();
      if (clean.length < 2) continue;
      const lower = clean.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      candidates.push({ term, needle: clean, lower });
    }
  }
  candidates.sort((a, b) => b.lower.length - a.lower.length);

  const taken: Array<[number, number]> = [];
  const counts = new Map<string, number>();
  const matches: GlossaryMatchSpan[] = [];

  const overlaps = (start: number, end: number): boolean =>
    taken.some(([a, b]) => start < b && end > a);

  for (const { term, lower } of candidates) {
    if (matches.length >= maxTotal) break;
    let count = counts.get(term.key) ?? 0;
    if (count >= maxPerTerm) continue;

    let pos = lowerText.indexOf(lower, 0);
    while (pos >= 0 && count < maxPerTerm && matches.length < maxTotal) {
      const end = pos + lower.length;
      if (!overlaps(pos, end)) {
        taken.push([pos, end]);
        matches.push({ term, start: pos, end });
        count += 1;
        counts.set(term.key, count);
      }
      pos = lowerText.indexOf(lower, end);
    }
  }

  return matches.sort((a, b) => a.start - b.start);
}

/** Resolves glossary matches in a Shadow DOM flow container into live DOM Ranges without mutating text nodes. */
export function findGlossaryRanges(
  root: Node,
  terms: readonly GlossaryTermRef[],
): Array<{ term: GlossaryTermRef; range: Range }> {
  const nodes = textNodes(root);
  if (!nodes.length || !terms.length) return [];
  const text = nodes.map((n) => n.data).join('');
  const spans = findGlossaryMatchSpans(text, terms);
  if (!spans.length) return [];

  const doc = root.ownerDocument!;
  const out: Array<{ term: GlossaryTermRef; range: Range }> = [];
  let nodeIdx = 0;
  let offset = 0;

  for (const span of spans) {
    while (nodeIdx < nodes.length && offset + nodes[nodeIdx]!.length <= span.start) {
      offset += nodes[nodeIdx]!.length;
      nodeIdx += 1;
    }
    if (nodeIdx >= nodes.length) break;

    const range = doc.createRange();
    range.setStart(nodes[nodeIdx]!, span.start - offset);

    let endIdx = nodeIdx;
    let endOffset = offset;
    while (endIdx < nodes.length && endOffset + nodes[endIdx]!.length < span.end) {
      endOffset += nodes[endIdx]!.length;
      endIdx += 1;
    }
    if (endIdx >= nodes.length) break;
    range.setEnd(nodes[endIdx]!, span.end - endOffset);
    out.push({ term: span.term, range });
  }
  return out;
}
