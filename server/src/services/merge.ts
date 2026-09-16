import type { ScrapeResult } from '../providers/types.ts';

/**
 * Metadata priority chain (§6). Highest wins, and a higher layer is never
 * allowed to overwrite a lower one:
 *
 *   1. user manual override   (metadata_overrides table)
 *   2. embedded EPUB metadata
 *   3. online provider patch  (fills gaps only)
 *   4. filename parsing       (weakest)
 *
 * This module implements layers 2-4. Layer 1 is applied afterwards by the
 * shelf service so that manual edits are always the last word.
 */
export interface BaseMetadata {
  title: string;
  author: string;
  publisher: string;
  language: string;
  isbn: string;
  description: string;
  series: string;
  seriesIndex: number | null;
  tags: string[];
  pubdate: string;
  source: string;
}

const EMPTY = (value: string | null | undefined): boolean => !value || value.trim().length === 0;

export function mergeProviderPatch(base: BaseMetadata, patch: ScrapeResult, providerId: string): BaseMetadata {
  const merged: BaseMetadata = { ...base };
  if (EMPTY(merged.title) && patch.title) merged.title = patch.title;
  if (EMPTY(merged.author) && patch.author) merged.author = patch.author;
  if (EMPTY(merged.publisher) && patch.publisher) merged.publisher = patch.publisher;
  if (EMPTY(merged.language) && patch.language) merged.language = patch.language;
  if (EMPTY(merged.isbn) && patch.isbn) merged.isbn = patch.isbn;
  if (EMPTY(merged.description) && patch.description) merged.description = patch.description;
  if (EMPTY(merged.series) && patch.series) merged.series = patch.series;
  if (merged.seriesIndex === null && typeof patch.seriesIndex === 'number') merged.seriesIndex = patch.seriesIndex;
  if (merged.tags.length === 0 && patch.tags?.length) merged.tags = patch.tags;
  if (EMPTY(merged.pubdate) && patch.pubdate) merged.pubdate = patch.pubdate;
  // Provenance is recorded so the UI can label scraped fields and offer undo.
  merged.source = `provider:${providerId}`;
  return merged;
}

/**
 * Applies the user's manual edits as the final layer.
 * Returns the effective value for each field plus which layer produced it.
 */
export function applyOverrides(
  base: BaseMetadata,
  overrides: Record<string, string>,
): { effective: BaseMetadata; appliedFields: string[] } {
  const effective: BaseMetadata = { ...base };
  const appliedFields: string[] = [];
  const textFields: Array<keyof BaseMetadata> = [
    'title', 'author', 'publisher', 'language', 'isbn', 'description', 'series', 'pubdate',
  ];
  for (const field of textFields) {
    const override = overrides[field as string];
    if (override === undefined) continue;
    // An override is the user's explicit intent, even when it blanks a field.
    (effective[field] as string) = override;
    appliedFields.push(field as string);
  }
  if (overrides.seriesIndex !== undefined) {
    const parsed = Number.parseFloat(overrides.seriesIndex);
    effective.seriesIndex = Number.isFinite(parsed) ? parsed : null;
    appliedFields.push('seriesIndex');
  }
  if (overrides.tags !== undefined) {
    effective.tags = overrides.tags.split(',').map((t) => t.trim()).filter(Boolean);
    appliedFields.push('tags');
  }
  // `source` keeps describing where the BASE metadata came from; the caller
  // reports `manualFields` separately. Keeping the origin intact is what lets
  // the client show "scraped from X" even after a partial manual edit, and
  // makes an undo fall back to the correct original value.
  return { effective, appliedFields };
}
