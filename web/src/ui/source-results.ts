import type { SourceEntry } from '../api/sources.ts';

export interface SourceResultGroup { key: string; entry: SourceEntry; entries: SourceEntry[] }
const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();

/** Group display rows, retaining every opaque reference for detail and acquisition. */
export function groupSourceResults(items: SourceEntry[], merge: boolean): SourceResultGroup[] {
  const groups = new Map<string, SourceResultGroup>(), refs = new Set<string>();
  for (const entry of items) {
    if (refs.has(entry.ref)) continue;
    refs.add(entry.ref);
    const title = normalize(entry.title), authors = [...new Set((entry.authors ?? []).map(normalize).filter(Boolean))].sort();
    // An absent author is not evidence that two identically named books are the same work.
    const key = merge && title && authors.length ? JSON.stringify(['book', title, authors]) : JSON.stringify(['entry', entry.ref]);
    let group = groups.get(key);
    if (!group) { group = { key, entry, entries: [] }; groups.set(key, group); }
    group.entries.push(entry);
  }
  return [...groups.values()];
}
