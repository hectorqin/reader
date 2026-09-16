/**
 * Online metadata scraping is a pluggable provider chain (§6).
 *
 * First release ships only the `none` provider: embedded metadata + filename
 * parsing + manual completion. Online sources (Google Books, Open Library) drop
 * in later without touching the indexer, and every provider must comply with
 * the contract below so that the priority chain stays intact.
 */
export interface ScrapeQuery {
  title: string;
  author: string;
  isbn: string;
  language: string;
}

/** A partial metadata patch. Only empty fields are ever filled. */
export interface ScrapeResult {
  title?: string;
  author?: string;
  publisher?: string;
  description?: string;
  language?: string;
  pubdate?: string;
  series?: string;
  seriesIndex?: number;
  tags?: string[];
  isbn?: string;
  coverUrl?: string;
}

export interface MetadataProvider {
  /** Stable id, persisted in `books.source` as `provider:<id>`. */
  readonly id: string;
  readonly displayName: string;
  /** Whether this provider is usable in the current configuration. */
  enabled(): boolean;
  /** Returns a patch, or null when the provider has nothing to add. */
  lookup(query: ScrapeQuery): Promise<ScrapeResult | null>;
}

/** Provider that never returns anything; keeps the chain explicit and testable. */
export const nullProvider: MetadataProvider = {
  id: 'none',
  displayName: 'Disabled (local metadata only)',
  enabled: () => true,
  async lookup() {
    return null;
  },
};
