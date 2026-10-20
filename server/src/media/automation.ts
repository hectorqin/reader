import type { MediaDatabase } from './read-database.ts';
import type { MediaActor, MediaLibraries, MediaLibraryKind } from './libraries.ts';
import type { MediaScanner, ScanFinished } from './scanner.ts';
import type { MediaScraping } from './scraping.ts';
import type { MediaScrapeJobs } from './scrape-jobs.ts';
import type { MediaItemKind } from './catalog.ts';

export const AUTO_SCAN_INTERVAL_MS = 60 * 60 * 1000;
/** The items a library is scraped by: the top of each hierarchy, never episodes or tracks. */
const scrapeKinds: Record<MediaLibraryKind, MediaItemKind[]> = { video: ['movie', 'series'], music: ['album'], audiobook: ['audiobook'] };

interface Settings { mediaAutoScan: boolean; mediaScrape: boolean }
interface Log { info(data: object, message: string): void; warn(data: object, message: string): void }

/**
 * 扫描与元数据 on the media library page:
 * - 自动扫描新文件: every library is rescanned hourly (unchanged files reuse their probe);
 * - 刮削封面与简介: after a scan completes, items that have neither online metadata
 *   nor an earlier scrape attempt are scraped with the first configured provider that
 *   supports them. One attempt per item, so an unmatched film is not retried hourly.
 *
 * Automatic work runs as the first active administrator; with none, it does nothing.
 */
export class MediaAutomation {
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(
    private readonly accounts: Pick<MediaDatabase, 'get'>,
    private readonly db: MediaDatabase,
    private readonly libraries: MediaLibraries,
    private readonly scanner: MediaScanner,
    private readonly scraping: MediaScraping,
    private readonly scrapeJobs: MediaScrapeJobs,
    private readonly settings: () => Settings,
    private readonly log?: Log,
    interval = AUTO_SCAN_INTERVAL_MS,
  ) {
    scanner.onFinished = event => this.afterScan(event);
    if (interval > 0) { this.timer = setInterval(() => this.scanAll(), interval); this.timer.unref?.(); }
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  private systemActor(): MediaActor | null {
    const row = this.accounts.get<{ id: string }>("SELECT id FROM users WHERE role='admin' AND disabled=0 ORDER BY created_at,id LIMIT 1");
    return row ? { id: row.id, role: 'admin' } : null;
  }

  /** Starts a scan of every library not already scanning. Returns the libraries started. */
  scanAll(): string[] {
    if (!this.settings().mediaAutoScan) return [];
    const actor = this.systemActor();
    if (!actor) return [];
    const started: string[] = [];
    for (const library of this.libraries.list(actor)) {
      if (this.scanner.isScanning(library.id)) continue;
      try { this.scanner.start(actor, library.id); started.push(library.id); }
      catch (error) { this.log?.warn({ err: error, libraryId: library.id }, 'automatic media scan skipped'); }
    }
    if (started.length) this.log?.info({ libraries: started.length }, 'automatic media scan started');
    return started;
  }

  /** Items in a library that were never scraped and have no online metadata. */
  unscraped(libraryId: string, kinds: readonly MediaItemKind[], limit = 500): string[] {
    if (!kinds.length) return [];
    return this.db.all<{ id: string }>(`SELECT i.id FROM media_items i WHERE i.library_id=? AND i.kind IN (${kinds.map(() => '?').join(',')})
      AND NOT EXISTS (SELECT 1 FROM media_online_metadata m WHERE m.item_id=i.id)
      AND NOT EXISTS (SELECT 1 FROM media_scrape_job_items j WHERE j.item_id=i.id)
      ORDER BY i.rowid DESC LIMIT ?`, libraryId, ...kinds, limit).map(row => row.id);
  }

  /** Returns the started scrape job's id, or null when there was nothing to do. */
  afterScan(event: ScanFinished): string | null {
    if (event.state !== 'complete' || !this.settings().mediaScrape) return null;
    const actor: MediaActor = event.actor.role === 'admin' ? event.actor : this.systemActor() ?? event.actor;
    try {
      const library = this.libraries.get(actor, event.libraryId);
      const wanted = scrapeKinds[library.kind];
      for (const provider of this.scraping.status(actor).items) {
        if (!provider.configured) continue;
        const ids = this.unscraped(library.id, wanted.filter(kind => provider.kinds.includes(kind)));
        if (!ids.length) continue;
        const job = this.scrapeJobs.start(actor, provider.id, ids, 'strong');
        this.log?.info({ libraryId: library.id, provider: provider.id, items: ids.length }, 'automatic scrape started');
        return job.id;
      }
    } catch (error) {
      // Typically another scrape job is running; the next scan tries again.
      this.log?.warn({ err: error, libraryId: event.libraryId }, 'automatic scrape skipped');
    }
    return null;
  }
}
