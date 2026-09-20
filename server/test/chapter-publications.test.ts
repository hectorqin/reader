import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Db } from '../src/db/index.ts';
import { SCHEMA_SQL } from '../src/db/schema.ts';
import { ChapterPublications, MAX_CHAPTER_BYTES } from '../src/publications/chapters.ts';
import type { SourceContext, SourceProvider } from '../src/sources/types.ts';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'reader-chapters-'));
  const db = new Db(join(root, 'reader.db'));
  db.run(`INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES ('u1','u1','x','member',0,0)`);
  db.run(`INSERT INTO source_instances (id, plugin_id, source_type, name, created_at) VALUES ('s1','p1','chapters','源',0)`);
  const context: SourceContext = { userId: 'u1', signal: new AbortController().signal,
    instance: { id: 's1', pluginId: 'p1', sourceType: 'chapters', name: '源', config: {}, enabled: true } };
  let items = [
    { id: 'one', seq: 0, title: '第一章', kind: 'chapter' as const, mediaType: 'text/plain', ref: 'provider-one' },
    { id: 'two', seq: 1, title: '第二章', kind: 'chapter' as const, mediaType: 'text/plain', ref: 'provider-two' },
  ];
  const provider: SourceProvider = {
    descriptor: { id: 'chapters', label: '章节', version: '1', capabilities: ['detail', 'acquire.chapters', 'content.manifest', 'content.resource'] },
    async detail() { return { ref: 'book', title: '远程书' }; },
    async acquire() { return { kind: 'chapters', publicationRef: 'book' }; },
    async getManifest() { return { publicationRef: 'book', version: 'v1', items }; },
    async readResource(_ctx, request) {
      const item = items.find((entry) => entry.ref === request.ref);
      return { mediaType: 'text/plain; charset=utf-8', text: item ? `<${item.title}> 正文` : '' };
    },
  };
  const chapters = new ChapterPublications(db, {
    manifest: async () => provider.getManifest!(context, 'book'),
    resource: async (_user, _source, _publication, ref) => provider.readResource!(context, { publicationRef: 'book', ref }),
  });
  return { root, db, context, provider, chapters, setItems(next: typeof items) { items = next; } };
}

test('chapter acquisition creates isolated stable publication and caches plain text assets', async () => {
  const f = await fixture();
  try {
    const bookId = await f.chapters.acquire(f.provider, f.context, { entryRef: 'book' }, 'book', { ref: 'book', title: '远程书' });
    assert.equal(f.chapters.has(bookId), true);
    const manifest = f.chapters.manifest('u1', bookId);
    assert.equal(manifest.items.length, 2);
    assert.match(manifest.items[0]!.href, /^chapter:[a-f0-9]{64}$/);
    assert.match(manifest.items[0]!.resourceRef!, /^chapter-resource:[a-f0-9]{64}:[a-f0-9]{64}$/);
    const asset = await f.chapters.asset('u1', bookId, manifest.items[0]!.resourceRef!);
    assert.equal(asset.contentType, 'text/plain; charset=utf-8');
    assert.equal(asset.data?.toString('utf8'), '<第一章> 正文');
    assert.equal(f.db.get('SELECT body FROM chapter_resources WHERE book_id = ? AND chapter_id = ?', bookId, manifest.items[0]!.id)?.body, '<第一章> 正文');
  } finally { f.db.close(); await rm(f.root, { recursive: true, force: true }); }
});

test('refresh keeps stable href, versions resource refs, and leaves old cached bytes readable', async () => {
  const f = await fixture();
  try {
    const bookId = await f.chapters.acquire(f.provider, f.context, { entryRef: 'book' }, 'book', { ref: 'book', title: '远程书' });
    const oldManifest = f.chapters.manifest('u1', bookId);
    await f.chapters.asset('u1', bookId, oldManifest.items[0]!.resourceRef!);
    // Keep the original chapter but insert a new one: its href is independent of seq.
    f.setItems([
      { id: 'zero', seq: 0, title: '序章', kind: 'chapter', mediaType: 'text/plain', ref: 'provider-zero' },
      { id: 'one', seq: 1, title: '第一章', kind: 'chapter', mediaType: 'text/plain', ref: 'provider-one' },
      { id: 'two', seq: 2, title: '第二章', kind: 'chapter', mediaType: 'text/plain', ref: 'provider-two' },
    ]);
    const refreshed = await f.chapters.refresh('u1', bookId);
    const original = refreshed.items.find((item) => item.title === '第一章')!;
    assert.equal(original.href, oldManifest.items[0]!.href);
    assert.notEqual(original.resourceRef, oldManifest.items[0]!.resourceRef);
    const old = await f.chapters.asset('u1', bookId, oldManifest.items[0]!.resourceRef!);
    assert.equal(old.data?.toString('utf8'), '<第一章> 正文');
  } finally { f.db.close(); await rm(f.root, { recursive: true, force: true }); }
});

test('unsupported manifest media is rejected before creating a publication', async () => {
  const f = await fixture();
  try {
    f.setItems([{ id: 'bad', seq: 0, title: '坏', kind: 'chapter', mediaType: 'text/html', ref: 'bad' }]);
    await assert.rejects(() => f.chapters.acquire(f.provider, f.context, { entryRef: 'book' }, 'book', { ref: 'book', title: '坏' }), { code: 'UNSUPPORTED_FORMAT' });
    assert.equal(f.db.get<{ count: number }>('SELECT count(*) AS count FROM books')!.count, 0);
  } finally { f.db.close(); await rm(f.root, { recursive: true, force: true }); }
});

test('old database gains content_hash_kind as an additive migration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reader-schema-'));
  const path = join(root, 'reader.db');
  try {
    const first = new DatabaseSync(path);
    first.exec(SCHEMA_SQL.replace(/^  content_hash_kind .*\r?\n/m, ''));
    first.exec(`INSERT INTO books (id, content_hash, format, title, created_at, updated_at) VALUES ('old','original-hash','txt','旧书',0,0)`);
    assert.equal(first.prepare('PRAGMA table_info(books)').all().some((row) => row.name === 'content_hash_kind'), false);
    first.close();
    for (let restart = 0; restart < 2; restart += 1) {
      const upgraded = new Db(path);
      try {
        const old = upgraded.get<{ content_hash: string; content_hash_kind: string; title: string }>('SELECT content_hash, content_hash_kind, title FROM books WHERE id = ?', 'old')!;
        assert.equal(old.content_hash_kind, 'file');
        assert.equal(old.content_hash, 'original-hash');
        assert.equal(old.title, '旧书');
        assert.deepEqual(upgraded.all('PRAGMA foreign_key_check'), []);
        assert.throws(() => upgraded.run("INSERT INTO user_books (user_id, book_id, added_at) VALUES ('missing', 'old', 0)"), /FOREIGN KEY/);
      } finally { upgraded.close(); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a refresh racing with an uncached resource never labels new bytes with an old revision', async () => {
  const f = await fixture();
  try {
    const bookId = await f.chapters.acquire(f.provider, f.context, { entryRef: 'book' }, 'book', { ref: 'book', title: '远程书' });
    const oldManifest = f.chapters.manifest('u1', bookId);
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    let finish!: (value: { mediaType: string; text: string }) => void;
    const waiting = new Promise<{ mediaType: string; text: string }>((resolve) => { finish = resolve; });
    f.provider.readResource = async () => { signalStarted(); return waiting; };
    const pending = f.chapters.asset('u1', bookId, oldManifest.items[0]!.resourceRef!);
    const outcome = assert.rejects(pending, { code: 'CHAPTER_SNAPSHOT_EXPIRED' });
    await started;
    f.setItems([{ id: 'one', seq: 0, title: '第一章更新', kind: 'chapter', mediaType: 'text/plain', ref: 'provider-one' }]);
    await f.chapters.refresh('u1', bookId);
    finish({ mediaType: 'text/plain', text: '这是更新后内容' });
    await outcome;
    assert.equal(f.db.get<{ body: string | null }>('SELECT body FROM chapter_resources WHERE book_id = ? AND revision = ? AND chapter_id = ?', bookId, oldManifest.revision!, oldManifest.items[0]!.id)!.body, null);
    await assert.rejects(f.chapters.asset('u1', bookId, oldManifest.items[1]!.resourceRef!), { code: 'CHAPTER_SNAPSHOT_EXPIRED' });
  } finally { f.db.close(); await rm(f.root, { recursive: true, force: true }); }
});

test('invalid bytes, unsupported content type and oversized chapters never enter the cache', async () => {
  const f = await fixture();
  try {
    const bookId = await f.chapters.acquire(f.provider, f.context, { entryRef: 'book' }, 'book', { ref: 'book', title: '远程书' });
    const ref = f.chapters.manifest('u1', bookId).items[0]!.resourceRef!;
    f.provider.readResource = async () => ({ mediaType: 'text/plain', data: Uint8Array.from([0xc3, 0x28]) });
    await assert.rejects(f.chapters.asset('u1', bookId, ref), { code: 'INVALID_RESOURCE' });
    f.provider.readResource = async () => ({ mediaType: 'text/html', text: '<script>alert(1)</script>' });
    await assert.rejects(f.chapters.asset('u1', bookId, ref), { code: 'INVALID_RESOURCE' });
    f.provider.readResource = async () => ({ mediaType: 'text/plain', data: Buffer.alloc(MAX_CHAPTER_BYTES + 1) });
    await assert.rejects(f.chapters.asset('u1', bookId, ref), { code: 'CHAPTER_TOO_LARGE' });
    assert.equal(f.db.get<{ count: number }>('SELECT count(*) AS count FROM chapter_resources WHERE body IS NOT NULL')!.count, 0);
  } finally { f.db.close(); await rm(f.root, { recursive: true, force: true }); }
});

test('concurrent acquisition and reads are idempotent while failed refresh keeps the previous directory', async () => {
  const f = await fixture();
  try {
    let manifests = 0;
    const original = f.provider.getManifest!;
    f.provider.getManifest = async (...args) => { manifests += 1; return original(...args); };
    const acquire = () => f.chapters.acquire(f.provider, f.context, { entryRef: 'book' }, 'book', { ref: 'book', title: '远程书' });
    const [bookId, duplicate] = await Promise.all([acquire(), acquire()]);
    assert.equal(bookId, duplicate);
    assert.equal(manifests, 1);
    const current = f.chapters.manifest('u1', bookId);
    let reads = 0;
    f.provider.readResource = async () => { reads += 1; return { mediaType: 'text/plain', text: '只加载一次' }; };
    await Promise.all([f.chapters.asset('u1', bookId, current.items[0]!.resourceRef!), f.chapters.asset('u1', bookId, current.items[0]!.resourceRef!)]);
    assert.equal(reads, 1);
    f.provider.getManifest = async () => { throw new Error('upstream unavailable'); };
    await assert.rejects(f.chapters.refresh('u1', bookId), /upstream unavailable/);
    assert.deepEqual(f.chapters.manifest('u1', bookId), current);
    assert.throws(() => f.chapters.manifest('other-user', bookId), { code: 'BOOK_NOT_FOUND' });
    assert.throws(() => f.chapters.asset('other-user', bookId, current.items[0]!.resourceRef!), { code: 'BOOK_NOT_FOUND' });
    assert.throws(() => f.chapters.refresh('other-user', bookId), { code: 'BOOK_NOT_FOUND' });
  } finally { f.db.close(); await rm(f.root, { recursive: true, force: true }); }
});
