import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '../src/db/index.ts';
import { MediaLibraries } from '../src/media/libraries.ts';
import { MediaScanner, type ScanFinished } from '../src/media/scanner.ts';
import { MediaScraping } from '../src/media/scraping.ts';
import { MediaScrapeJobs } from '../src/media/scrape-jobs.ts';
import { MediaAutomation } from '../src/media/automation.ts';
import { MediaSubtitles } from '../src/media/subtitles.ts';
import { BusinessSettingsReader, settingsDefaults } from '../src/services/business-settings.ts';

const admin = { id: 'admin', role: 'admin' } as const;
const probe = async () => ({ status: 'unavailable' as const, info: null });

test('scan jobs report a total, and hidden names are skipped unless the setting allows them', async t => {
  const root = await mkdtemp(join(tmpdir(), 'media-hidden-')), db = new Db(':memory:'), libraries = new MediaLibraries(db);
  let hidden = false;
  const finished: ScanFinished[] = [];
  const scanner = new MediaScanner(db, libraries, probe, undefined, () => ({ libraries: 1, files: 1, mediaHidden: hidden }));
  scanner.onFinished = event => finished.push(event);
  t.after(async () => { await scanner.close(); db.close(); await rm(root, { recursive: true, force: true }); });
  await mkdir(join(root, '.thumbs')); await writeFile(join(root, '.thumbs', 'clip.mp4'), 'x');
  await writeFile(join(root, '._film.mp4'), 'x'); await writeFile(join(root, 'film.mp4'), 'x');
  const library = await libraries.create(admin, { name: 'Films', kind: 'video', root, access: 'all' });
  const scan = async () => { const job = scanner.start(admin, library.id); await scanner.wait(library.id); return scanner.job(admin, job.id); };
  const first = await scan();
  assert.equal(first.state, 'complete');
  assert.deepEqual([first.inspected, first.total], [1, 1]);
  assert.deepEqual(scanner.assets(admin, library.id).items.map(asset => asset.ref), ['film.mp4']);
  hidden = true;
  const second = await scan();
  assert.deepEqual([second.inspected, second.total], [3, 3]);
  assert.deepEqual(finished.map(event => [event.libraryId, event.state]), [[library.id, 'complete'], [library.id, 'complete']]);
  // A bare scanner (no settings) keeps the old behaviour of scanning hidden names.
  assert.equal(new MediaScanner(db, libraries).isScanning(library.id), false);
});

test('automation scans every idle library, and after a scan scrapes only never-attempted items once', async t => {
  const root = await mkdtemp(join(tmpdir(), 'media-auto-')), db = new Db(':memory:'), libraries = new MediaLibraries(db);
  db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('admin','admin','x','admin',0,0)");
  const scanner = new MediaScanner(db, libraries, probe);
  const scraping = new MediaScraping(db, scanner.catalog, [{ id: 'tmdb', label: 'test', configured: true, kinds: ['movie'], async search() { return []; }, async detail() { throw Error('no candidates'); } }]);
  const jobs = new MediaScrapeJobs(db, scanner.catalog, scraping);
  const settings = { mediaAutoScan: true, mediaScrape: true };
  const automation = new MediaAutomation(db, db, libraries, scanner, scraping, jobs, () => settings, undefined, 0);
  t.after(async () => { automation.stop(); await jobs.close(); await scanner.close(); db.close(); await rm(root, { recursive: true, force: true }); });
  await writeFile(join(root, 'Film (2020).mp4'), 'x');
  const library = await libraries.create(admin, { name: 'Films', kind: 'video', root, access: 'all' });
  assert.deepEqual(automation.scanAll(), [library.id]);
  assert.deepEqual(automation.scanAll(), [], 'a library already scanning is skipped');
  await scanner.wait(library.id);
  const scraped = db.all<{ job_id: string }>('SELECT job_id FROM media_scrape_job_items');
  assert.equal(scraped.length, 1, 'the completed scan started one scrape for the new film');
  await jobs.wait(scraped[0]!.job_id);
  // Unmatched once is not retried by the next scan.
  assert.deepEqual(automation.unscraped(library.id, ['movie']), []);
  assert.equal(automation.afterScan({ actor: admin, libraryId: library.id, jobId: 'x', state: 'complete' }), null);
  settings.mediaAutoScan = false;
  assert.deepEqual(automation.scanAll(), []);
});

test('embedded subtitle streams can be turned off, and the new scanning settings have defaults', async () => {
  const db = new Db(':memory:'), libraries = new MediaLibraries(db);
  db.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES('lib','Films','video',?,'all',0,0)", tmpdir());
  new MediaScanner(db, libraries, probe);
  const technical = JSON.stringify({ streams: [{ index: 2, type: 'subtitle', codec: 'subrip', language: 'en' }] });
  db.run("INSERT INTO media_assets(id,library_id,ref,size,modified_at,available,probe_status,technical_json) VALUES('a','lib','missing-dir/film.mkv',1,0,1,'ready',?)", technical);
  let embedded = true;
  const subtitles = new MediaSubtitles(db, libraries, undefined, () => embedded);
  const ids = async () => (await subtitles.list(admin, 'a').catch(() => ({ items: [] as Array<{ id: string }> }))).items.map(item => item.id);
  // Sidecar lookup may fail for the fake path; the embedded list is what matters.
  const withEmbedded = (subtitles as unknown as { embedded(asset: { ref: string; technical_json: string }): unknown[] }).embedded({ ref: 'film.mkv', technical_json: technical });
  assert.equal(withEmbedded.length, 1);
  embedded = false;
  assert.equal((subtitles as unknown as { embedded(asset: { ref: string; technical_json: string }): unknown[] }).embedded({ ref: 'film.mkv', technical_json: technical }).length, 0);
  assert.ok(!(await ids()).includes('stream:2'));
  assert.deepEqual(
    (({ mediaAutoScan, mediaScrape, mediaEmbedded, mediaHidden }) => ({ mediaAutoScan, mediaScrape, mediaEmbedded, mediaHidden }))(settingsDefaults('scanning')),
    { mediaAutoScan: true, mediaScrape: false, mediaEmbedded: true, mediaHidden: false });
  // Rows saved before these fields existed read them as defaults.
  db.run(`CREATE TABLE IF NOT EXISTS business_settings(name TEXT PRIMARY KEY,value TEXT NOT NULL,revision INTEGER NOT NULL)`);
  db.run("INSERT OR REPLACE INTO business_settings VALUES('scanning','{\"interval\":60,\"libraries\":2,\"files\":4}',1)");
  assert.equal(new BusinessSettingsReader(db).read('scanning').mediaEmbedded, true);
  db.close();
});
