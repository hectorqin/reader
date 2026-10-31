import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/db/index.ts';
import { MediaLibraries } from '../src/media/libraries.ts';
import { MediaScanner } from '../src/media/scanner.ts';
import { MediaPlayback } from '../src/media/playback.ts';
import { MediaTimeStats } from '../src/media/time-stats.ts';
import { SLOT_MS, TimeStatsService } from '../src/services/time-stats.ts';
import { ShelfService } from '../src/services/shelf.ts';
import { UserService } from '../src/services/users.ts';
import { buildApp } from '../src/http/app.ts';
import { signAccessToken } from '../src/services/tokens.ts';
import type { AppConfig } from '../src/config/index.ts';
import type { AppContext } from '../src/http/context.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DAY = 24 * 60 * 60 * 1000;
// 2026-08-31T16:00Z is 2026-09-01 00:00 in UTC+8.
const MIDNIGHT_SG = Date.UTC(2026, 7, 31, 16);

function readingFixture() {
  const db = new Db(':memory:');
  for (const id of ['alice', 'bob']) db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,'x','member',0,0)", id, id);
  db.run("INSERT INTO books(id,content_hash,title,author,format,created_at,updated_at) VALUES('b1','h1','一','甲','epub',0,0)");
  db.run("INSERT INTO books(id,content_hash,title,author,format,created_at,updated_at) VALUES('b2','h2','二','乙','epub',0,0)");
  const shelf = { getMany: () => new Map() } as unknown as ShelfService;
  return { db, stats: new TimeStatsService(db, shelf) };
}

test('reading time: a replayed report never counts twice, and each device counts once', () => {
  const { db, stats } = readingFixture();
  const slot = MIDNIGHT_SG;
  stats.record('alice', 'device-aaaa', [{ bookId: 'b1', slot, seconds: 120 }]);
  stats.record('alice', 'device-aaaa', [{ bookId: 'b1', slot, seconds: 300 }]);
  stats.record('alice', 'device-aaaa', [{ bookId: 'b1', slot, seconds: 300 }]);
  stats.record('alice', 'device-aaaa', [{ bookId: 'b1', slot, seconds: 200 }]);
  stats.record('alice', 'device-bbbb', [{ bookId: 'b1', slot, seconds: 60 }]);
  const result = stats.summary('alice', { from: slot, to: slot + DAY, tz: 480, group: 'day' });
  assert.equal(result.total, 360);
  assert.deepEqual(result.works.map(work => [work.id, work.title, work.seconds]), [['b1', '一', 360]]);
  db.close();
});

test('reading time: rejects bad slots, unknown books and caps a slot at fifteen minutes', () => {
  const { db, stats } = readingFixture();
  const result = stats.record('alice', 'device-aaaa', [
    { bookId: 'b1', slot: MIDNIGHT_SG + 1, seconds: 10 },
    { bookId: 'nope', slot: MIDNIGHT_SG, seconds: 10 },
    { bookId: 'b1', slot: Date.now() + 10 * SLOT_MS - (Date.now() % SLOT_MS), seconds: 10 },
    { bookId: 'b2', slot: MIDNIGHT_SG, seconds: 5000 },
  ]);
  assert.deepEqual(result, { accepted: 1, rejected: 3 });
  assert.equal(stats.summary('alice', { from: 0, to: Date.now() + DAY, tz: 0, group: 'year' }).total, 900);
  assert.throws(() => stats.record('alice', 'x', []), /client id/);
  db.close();
});

test('reading time groups by day, month and year in the viewer\'s zone', () => {
  const { db, stats } = readingFixture();
  // 23:45 on 31 August and 00:00 on 1 September, Singapore time.
  stats.record('alice', 'device-aaaa', [
    { bookId: 'b1', slot: MIDNIGHT_SG - SLOT_MS, seconds: 100 },
    { bookId: 'b2', slot: MIDNIGHT_SG, seconds: 200 },
    { bookId: 'b2', slot: MIDNIGHT_SG + 40 * DAY, seconds: 50 },
  ]);
  const range = { from: MIDNIGHT_SG - 30 * DAY, to: MIDNIGHT_SG + 60 * DAY };
  assert.deepEqual(stats.summary('alice', { ...range, tz: 480, group: 'day' }).series,
    [{ key: '2026-08-31', seconds: 100 }, { key: '2026-09-01', seconds: 200 }, { key: '2026-10-11', seconds: 50 }]);
  assert.deepEqual(stats.summary('alice', { ...range, tz: 0, group: 'day' }).series.map(point => point.key), ['2026-08-31', '2026-10-10']);
  assert.deepEqual(stats.summary('alice', { ...range, tz: 480, group: 'month' }).series,
    [{ key: '2026-08', seconds: 100 }, { key: '2026-09', seconds: 200 }, { key: '2026-10', seconds: 50 }]);
  assert.deepEqual(stats.summary('bob', { ...range, tz: 480, group: 'year' }).series, []);
  assert.deepEqual(stats.users(range).map(user => [user.userId, user.seconds]), [['alice', 350], ['bob', 0]]);
  assert.throws(() => stats.summary('alice', { from: 10, to: 5, tz: 0, group: 'day' }), /range/);
  assert.throws(() => stats.summary('alice', { from: 0, to: 5, tz: 0, group: 'week' as 'day' }), /group/);
  db.close();
});

test('watch time is derived from progress saves: the smaller of clock and position, gaps ignored', async () => {
  const db = new Db(':memory:'), libraries = new MediaLibraries(db), scanner = new MediaScanner(db, libraries);
  try {
    const playback = new MediaPlayback(db, libraries), stats = new MediaTimeStats(db, libraries);
    const actor = { id: 'member', role: 'member' } as const;
    db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('member','member','x','member',0,0)");
    db.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES('tv','tv','video','/tv','all',0,0)");
    db.run("INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json) VALUES('show','tv','series','show','剧集','{}')");
    db.run("INSERT INTO media_items(id,library_id,kind,parent_id,local_key,title,metadata_json) VALUES('s1','tv','season','show','s1','第一季','{}')");
    db.run("INSERT INTO media_items(id,library_id,kind,parent_id,local_key,title,metadata_json) VALUES('e1','tv','episode','s1','e1','第一集','{}')");
    db.run("INSERT INTO media_assets(id,library_id,ref,size,modified_at,available,probe_status) VALUES('a1','tv','e1.mp4',1,0,1,'ready')");
    db.run("INSERT INTO media_editions(id,item_id,local_key,label) VALUES('ed','e1','ed','版本')");
    db.run("INSERT INTO media_parts(id,edition_id,asset_id,local_key,title,ordinal) VALUES('p1','ed','a1','p1','第一集',0)");

    const session = playback.create(actor, 'p1');
    let revision = session.revision, sequence = 0;
    const save = (position: number, at: number) => {
      db.run('UPDATE media_progress SET updated_at=? WHERE part_id=?', at, 'p1');
      revision = playback.update(actor, session.id, { sequence: sequence++, revision, position }).revision;
    };
    const now = Date.now();
    // Saves are stamped "now"; the previous save's time is set just before each one.
    save(5, now - 5000);     // 5s of clock, 5s of position: 5
    save(15, now - 5000);    // 5s of clock, 10s of position (2×): 5
    save(615, now - 2000);   // a seek: 2s of clock: 2
    save(615, now - 5000);   // paused: 0
    save(700, now - 120_000); // resumed after two minutes: not counted
    save(690, now - 5000);   // backwards: 0
    const today = now - (now % SLOT_MS);
    const result = stats.summary(actor, { from: today - DAY, to: today + DAY, tz: 0, group: 'day' });
    assert.equal(result.series.length, 1);
    assert.equal(result.series[0]!.channel, 'video');
    assert.ok(Math.abs(result.series[0]!.seconds - 12) <= 1, `got ${result.series[0]!.seconds}`);
    assert.deepEqual(result.works.map(work => [work.id, work.title, work.channel]), [['show', '剧集', 'video']]);
    assert.deepEqual(stats.users({ from: today - DAY, to: today + DAY }).map(row => [row.userId, row.channel]), [['member', 'video']]);
    // A library the user can no longer see is not counted.
    db.run("UPDATE media_libraries SET access='restricted' WHERE id='tv'");
    assert.deepEqual(stats.summary(actor, { from: today - DAY, to: today + DAY, tz: 0, group: 'day' }).series, []);
  } finally { await scanner.close(); db.close(); }
});

test('the HTTP routes work when services are attached after the app is built, as main.ts does', async t => {
  const root = await mkdtemp(join(tmpdir(), 'time-stats-')), db = new Db(':memory:');
  const config: AppConfig = { booksDir: root, dataDir: root, host: '127.0.0.1', port: 0, jwtSecret: 'time-stats-test-secret-16chars', accessTokenTtl: 604800, refreshTokenTtl: 31536000, scanInterval: 1800, watchInterval: 60, logLevel: 'silent', publicUrl: '', corsOrigins: [], webDir: join(root, 'web') };
  // The placeholder context main.ts builds the app with: shelf and users come later.
  const ctx = { config, db, shelf: undefined, users: undefined } as unknown as AppContext;
  const app = buildApp(ctx);
  ctx.users = new UserService(db, config);
  ctx.shelf = new ShelfService(db);
  await app.ready();
  t.after(async () => { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); });
  db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('alice','alice','x','admin',0,0)");
  db.run("INSERT INTO books(id,content_hash,title,author,format,created_at,updated_at) VALUES('b1','h1','一','甲','epub',0,0)");
  const headers = { authorization: 'Bearer ' + signAccessToken(config, { id: 'alice', role: 'admin' }).token };
  const posted = await app.inject({ method: 'POST', url: '/api/v1/stats/reading-time', headers, payload: { clientId: 'device-aaaa', entries: [{ bookId: 'b1', slot: MIDNIGHT_SG, seconds: 120 }] } });
  assert.equal(posted.statusCode, 200, posted.body);
  const query = `from=${MIDNIGHT_SG - DAY}&to=${MIDNIGHT_SG + DAY}&tz=480&group=year`;
  const summary = await app.inject({ url: `/api/v1/stats/reading?${query}`, headers });
  assert.equal(summary.statusCode, 200, summary.body);
  assert.deepEqual(summary.json().series, [{ key: '2026', seconds: 120 }]);
  assert.equal(summary.json().works[0].title, '一');
  const users = await app.inject({ url: `/api/v1/stats/reading/users?${query}`, headers });
  assert.equal(users.statusCode, 200, users.body);
  assert.equal((await app.inject({ url: `/api/v1/stats/reading?from=5&to=1&tz=0&group=day`, headers })).statusCode, 400);
});
