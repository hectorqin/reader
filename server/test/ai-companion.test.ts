import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import Fastify from 'fastify';

import { autoShelf } from './auto-shelf.ts';
import { loadConfig } from '../src/config/index.ts';
import { openDatabase } from '../src/db/index.ts';
import { Scanner } from '../src/indexer/scanner.ts';
import { UserService } from '../src/services/users.ts';
import { ShelfService } from '../src/services/shelf.ts';
import { SyncService } from '../src/services/sync.ts';
import { TtsService } from '../src/services/tts.ts';
import { BrowseService } from '../src/services/browse.ts';
import { UploadService } from '../src/services/uploads.ts';
import { buildApp } from '../src/http/app.ts';
import type { AppContext } from '../src/http/context.ts';
import { mergeCompanionGraph } from '../src/services/ai-companion.ts';

async function makeNovelEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/opf/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:test:companion-novel-1</dc:identifier>
    <dc:title>迷雾之城</dc:title>
    <dc:creator>测试作家</dc:creator>
    <dc:language>zh</dc:language>
  </metadata>
  <manifest>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="ch3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
    <itemref idref="c3"/>
  </spine>
</package>`,
  );
  zip.file(
    'OEBPS/ch1.xhtml',
    '<html><body><h1>第一章 初遇</h1><p>林默与苏清在青云宗拜师，两人是同门师兄妹，师父留下一枚来历不明的玉佩。</p></body></html>',
  );
  zip.file(
    'OEBPS/ch2.xhtml',
    '<html><body><h1>第二章 疑云</h1><p>林默在古塔中发现玉佩与十年前的失踪案有关，苏清暗中相助。</p></body></html>',
  );
  zip.file(
    'OEBPS/ch3.xhtml',
    '<html><body><h1>第三章 反转</h1><p>惊天剧透：苏清其实是魔教圣女，与林默反目成仇成为宿敌。</p></body></html>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('mergeCompanionGraph folds entities, aliases, categories, and relation evolution chronologically', () => {
  const graph = mergeCompanionGraph([
    {
      sectionSeq: 0,
      sectionId: 'ch1',
      digestText: '初遇',
      entities: [
        { name: '林默', category: 'character', aliases: ['默哥'], role: '弟子', note: '拜入青云宗' },
        { name: '苏清', category: 'character', role: '师妹', note: '与林默同门' },
        { name: '青云玉佩', category: 'item', aliases: ['古玉'], role: '神秘信物', note: '师父所留' },
      ],
      relations: [{ from: '林默', to: '苏清', label: '同门师兄妹' }],
      openThreads: ['玉佩来历不明'],
    },
    {
      sectionSeq: 2,
      sectionId: 'ch3',
      digestText: '反转',
      entities: [
        { name: '苏清', category: 'character', role: '魔教圣女', note: '暴露身份' },
        { name: '古玉', category: 'item', role: '魔教钥匙', note: '可开启禁地大门' },
      ],
      relations: [{ from: '林默', to: '苏清', label: '宿敌' }],
      openThreads: ['玉佩来历不明', '魔教真正目的'],
    },
  ]);

  const su = graph.entities.find((e) => e.name === '苏清');
  assert.equal(su?.role, '魔教圣女');
  assert.equal(su?.category, 'character');
  assert.equal(su?.firstSeenSeq, 0);
  assert.equal(su?.lastSeenSeq, 2);
  assert.equal(su?.mentions, 2);

  // Alias '古玉' merges into '青云玉佩' with chronological timeline
  const jade = graph.entities.find((e) => e.name === '青云玉佩');
  assert.equal(jade?.category, 'item');
  assert.equal(jade?.role, '魔教钥匙');
  assert.deepEqual(jade?.aliases, ['古玉']);
  assert.deepEqual(jade?.timeline, [
    { seq: 0, note: '师父所留' },
    { seq: 2, note: '可开启禁地大门' },
  ]);

  assert.equal(graph.relations[0]?.label, '宿敌');
  assert.deepEqual(graph.relations[0]?.history, [
    { seq: 0, label: '同门师兄妹' },
    { seq: 2, label: '宿敌' },
  ]);
  assert.deepEqual(graph.openThreads, ['魔教真正目的', '玉佩来历不明']);
});

test('spoiler-free AI companion enforces section_seq <= uptoSeq, caches digests/recaps, and feeds assist memory', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ai-companion-'));
  const booksDir = join(root, 'books');
  await mkdir(booksDir, { recursive: true });
  await writeFile(join(booksDir, 'novel.epub'), await makeNovelEpub());

  process.env.BOOKS_DIR = booksDir;
  process.env.DATA_DIR = join(root, 'data');
  process.env.SCAN_INTERVAL = '0';
  process.env.WATCH_INTERVAL = '0';
  process.env.READER_TOKEN_SECRET = 'companion-test-secret-long-enough';

  const calls: Array<{ system: string; user: string }> = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages: Array<{ role: string; content: string }> };
    const system = body.messages[0]?.content ?? '';
    const user = body.messages[1]?.content ?? '';
    calls.push({ system, user });

    let content = 'OK';
    if (user.includes('章节：第 1 章')) {
      content = JSON.stringify({
        digest: '林默与苏清在青云宗成为同门师兄妹，师父留下神秘玉佩。',
        entities: [
          { name: '林默', category: 'character', role: '主角', note: '青云宗弟子' },
          { name: '苏清', category: 'character', role: '同门师妹', note: '与林默一起拜师' },
          { name: '神秘玉佩', category: 'item', aliases: ['古玉'], role: '师父遗物', note: '来历不明' },
          { name: '青云宗', category: 'organization', role: '名门正派', note: '主角拜师门派' },
        ],
        relations: [{ from: '林默', to: '苏清', label: '同门师兄妹' }],
        openThreads: ['师父留下的玉佩来历不明'],
      });
    } else if (user.includes('章节：第 2 章')) {
      content = JSON.stringify({
        digest: '林默在古塔发现玉佩线索，苏清暗中相助。',
        entities: [{ name: '林默', role: '主角', note: '调查十年前失踪案' }],
        relations: [{ from: '苏清', to: '林默', label: '暗中相助' }],
        openThreads: ['十年前失踪案真相'],
      });
    } else if (user.includes('章节：第 3 章')) {
      content = JSON.stringify({
        digest: '苏清暴露魔教圣女身份，与林默反目成仇。',
        entities: [{ name: '苏清', role: '魔教圣女', note: '终局反转' }],
        relations: [{ from: '林默', to: '苏清', label: '宿敌' }],
        openThreads: [],
      });
    } else if (user.includes('前情提要')) {
      content = `前情提要：${user.includes('宿敌') ? '含剧透' : '截至当前章节，林默与苏清是同门师兄妹，正调查玉佩线索。'}`;
    } else {
      content = `回答基于上下文：${user.includes('同门师兄妹') ? '包含防剧透记忆' : '无记忆'}`;
    }
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  const origin = 'http://mock-ai.local';

  const config = loadConfig();
  const db = openDatabase(config);
  autoShelf(db);
  const silent = Fastify({ logger: false });
  const ctx: AppContext = {
    config,
    db,
    log: silent.log,
    scanner: new Scanner(db, config, { info: () => {}, warn: () => {} }),
    users: new UserService(db, config),
    shelf: new ShelfService(db),
    sync: undefined as never,
    tts: new TtsService(config),
    browse: undefined as never,
    uploads: undefined as never,
  };
  ctx.sync = new SyncService(db, ctx.shelf);
  ctx.browse = new BrowseService(db, config, ctx.shelf);
  ctx.uploads = new UploadService(db, config, ctx.browse, ctx.scanner);
  const app = buildApp(ctx);
  await ctx.scanner.scan();

  t.after(async () => {
    globalThis.fetch = origFetch;
    await app.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  });

  // Register admin (user A) and member (user B)
  const regA = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: 'admin_a', password: 'password123', displayName: 'Admin A' },
  });
  const tokenA = JSON.parse(regA.body).session.accessToken as string;
  const authA = { authorization: `Bearer ${tokenA}` };

  // Enable AI summary & assist
  await app.inject({
    method: 'PATCH',
    url: '/api/v1/admin/settings/ai',
    headers: authA,
    payload: {
      values: {
        enabled: true,
        summaryEnabled: true,
        assistEnabled: true,
        baseUrl: `${origin}/v1`,
        apiKey: 'test-key',
        model: 'test-model',
      },
      revision: ctx.settings!.view('ai').revision,
    },
  });

  const books = JSON.parse(
    (await app.inject({ method: 'GET', url: '/api/v1/books', headers: authA })).body,
  ).items;
  const bookId = books[0].id as string;

  // Step A: Extract all 3 chapters (including chapter 3 spoiler) at sectionIndex = 2
  const fullRes = await app.inject({
    method: 'POST',
    url: '/api/v1/ai/companion',
    headers: authA,
    payload: { bookId, sectionIndex: 2 },
  });
  assert.equal(fullRes.statusCode, 200);
  const fullData = JSON.parse(fullRes.body);
  assert.equal(fullData.uptoSeq, 2);
  assert.equal(fullData.coveredChapters, 3);
  assert.equal(fullData.newlyExtracted, 3);
  assert.equal(fullData.relations.find((r: { from: string; to: string }) => r.from === '林默' && r.to === '苏清')?.label, '宿敌');

  // Step B: Even though chapter 3 is ALREADY cached in ai_chapter_digests, querying at
  // sectionIndex = 0 MUST physically hide chapter 2 & chapter 3 (zero spoilers, zero re-extraction)!
  const callsBeforeSafe = calls.length;
  const safeRes = await app.inject({
    method: 'POST',
    url: '/api/v1/ai/companion',
    headers: authA,
    payload: { bookId, sectionIndex: 0 },
  });
  assert.equal(safeRes.statusCode, 200);
  const safeData = JSON.parse(safeRes.body);
  assert.equal(safeData.uptoSeq, 0);
  assert.equal(safeData.coveredChapters, 1);
  assert.equal(safeData.newlyExtracted, 0);
  assert.equal(safeData.relations.find((r: { from: string; to: string }) => r.from === '林默' && r.to === '苏清')?.label, '同门师兄妹');
  assert.doesNotMatch(JSON.stringify(safeData), /魔教圣女|宿敌/);
  // Only 1 upstream call (for the new recap at uptoSeq=0), 0 digest extractions
  assert.equal(calls.length, callsBeforeSafe + 1);

  // Calling again at sectionIndex = 0 hits recap cache (0 upstream calls)
  const cachedRes = await app.inject({
    method: 'POST',
    url: '/api/v1/ai/companion',
    headers: authA,
    payload: { bookId, sectionIndex: 0 },
  });
  assert.equal(JSON.parse(cachedRes.body).recapCached, true);
  assert.equal(calls.length, callsBeforeSafe + 1);

  // Step C: /api/v1/ai/assist with sectionIndex=0 injects spoiler-free memory without leaking chapter 3
  const assistRes = await app.inject({
    method: 'POST',
    url: '/api/v1/ai/assist',
    headers: authA,
    payload: { bookId, action: 'explain', text: '苏清', sectionIndex: 0 },
  });
  assert.equal(assistRes.statusCode, 200);
  assert.match(JSON.parse(assistRes.body).answer, /包含防剧透记忆/);
  const lastAssistPrompt = calls.at(-1)!.user;
  assert.match(lastAssistPrompt, /同门师兄妹/);
  assert.doesNotMatch(lastAssistPrompt, /魔教圣女|宿敌/);

  // Step D: GET /api/v1/ai/glossary filters by category & alias with 0 LLM calls and zero spoilers
  const callsBeforeGlossary = calls.length;
  const itemGlossary = await app.inject({
    method: 'GET',
    url: `/api/v1/ai/glossary?bookId=${encodeURIComponent(bookId)}&category=item&q=${encodeURIComponent('古玉')}&sectionIndex=0`,
    headers: authA,
  });
  assert.equal(itemGlossary.statusCode, 200);
  const glossaryBody = JSON.parse(itemGlossary.body);
  assert.equal(calls.length, callsBeforeGlossary);
  assert.equal(glossaryBody.items.length, 1);
  assert.equal(glossaryBody.items[0].name, '神秘玉佩');
  assert.equal(glossaryBody.counts.organization, 1);
  assert.doesNotMatch(JSON.stringify(glossaryBody), /魔教圣女|宿敌/);

  // Step E: Incremental batch backfill walks backwards from uptoSeq to 0 without re-extracting cached chapters
  db.run('DELETE FROM ai_chapter_digests');
  db.run('DELETE FROM ai_recaps');

  const initBatch = JSON.parse(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/ai/companion',
        headers: authA,
        payload: { bookId, sectionIndex: 2, window: 1, generateRecap: false },
      })
    ).body,
  );
  assert.equal(initBatch.coveredChapters, 1);
  assert.equal(initBatch.newlyExtracted, 1);
  assert.equal(initBatch.uncachedChapters, 2);
  assert.equal(initBatch.hasMoreBackfill, true);

  const backfill1 = JSON.parse(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/ai/companion',
        headers: authA,
        payload: { bookId, sectionIndex: 2, window: 1, backfill: true, generateRecap: false },
      })
    ).body,
  );
  assert.equal(backfill1.coveredChapters, 2);
  assert.equal(backfill1.newlyExtracted, 1);
  assert.equal(backfill1.uncachedChapters, 1);
  assert.equal(backfill1.hasMoreBackfill, true);

  const backfill2 = JSON.parse(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/ai/companion',
        headers: authA,
        payload: { bookId, sectionIndex: 2, window: 1, backfill: true, generateRecap: false },
      })
    ).body,
  );
  assert.equal(backfill2.coveredChapters, 3);
  assert.equal(backfill2.newlyExtracted, 1);
  assert.equal(backfill2.uncachedChapters, 0);
  assert.equal(backfill2.hasMoreBackfill, false);
});

test('AI companion backfill fetches unfetched online chapters on demand via sources.chapters.asset', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'reader-ai-chapters-'));
  const booksDir = join(root, 'books');
  const dataDir = join(root, 'data');
  await mkdir(booksDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });

  const envBackup = {
    BOOKS_DIR: process.env.BOOKS_DIR,
    DATA_DIR: process.env.DATA_DIR,
    JWT_SECRET: process.env.JWT_SECRET,
  };
  process.env.BOOKS_DIR = booksDir;
  process.env.DATA_DIR = dataDir;
  process.env.JWT_SECRET = 'test-secret-key-for-ai-companion-chapters';
  t.after(() => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                digest: '在线章节摘要内容，记录角色齐夏在终焉之地的首次试炼。',
                entities: [{ name: '齐夏', category: 'character', role: '主角', note: '醒来于房间' }],
                relations: [],
                openThreads: ['终焉之地的真相'],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof globalThis.fetch;

  const config = loadConfig();
  const db = openDatabase(config);
  autoShelf(db);
  const silent = Fastify({ logger: false });
  const onlineBookId = 'online-chapters-book-1';
  const assetCalls: string[] = [];

  const ctx: AppContext = {
    config,
    db,
    log: silent.log,
    scanner: new Scanner(db, config, { info: () => {}, warn: () => {} }),
    users: new UserService(db, config),
    shelf: new ShelfService(db),
    sync: undefined as never,
    tts: new TtsService(config),
    browse: undefined as never,
    uploads: undefined as never,
  };
  ctx.sync = new SyncService(db, ctx.shelf);
  ctx.browse = new BrowseService(db, config, ctx.shelf);
  ctx.uploads = new UploadService(db, config, ctx.browse, ctx.scanner);
  const app = buildApp(ctx);
  ctx.sources = {
    chapters: {
      has: (id: string) => id === onlineBookId,
      manifest: () => ({
        bookId: onlineBookId,
        kind: 'text',
        format: 'chapters',
        revision: 'rev1',
        items: [
          { id: 'c0', href: 'chapter:c0', title: '第1章', format: 'text', resourceRef: 'chapter-resource:rev1:c0' },
          { id: 'c1', href: 'chapter:c1', title: '第2章', format: 'text', resourceRef: 'chapter-resource:rev1:c1' },
        ],
        toc: [],
      }),
      asset: async (_userId: string, _bookId: string, ref: string) => {
        assetCalls.push(ref);
        const body = `这是通过书源按需拉取的在线章节正文（${ref}），齐夏在房间中醒来，开始寻找离开终焉之地的线索。`;
        return { data: Buffer.from(body, 'utf8'), contentType: 'text/plain; charset=utf-8' };
      },
    },
  } as never;

  t.after(async () => {
    globalThis.fetch = origFetch;
    await app.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  });

  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: 'online_u', password: 'password123', displayName: 'Online U' },
  });
  const regBody = JSON.parse(reg.body);
  const token = regBody.session.accessToken as string;
  const userId = regBody.user.id as string;
  const auth = { authorization: `Bearer ${token}` };

  await app.inject({
    method: 'PATCH',
    url: '/api/v1/admin/settings/ai',
    headers: auth,
    payload: {
      values: {
        enabled: true,
        summaryEnabled: true,
        assistEnabled: true,
        baseUrl: 'http://mock-ai.local/v1',
        apiKey: 'test-key',
        model: 'test-model',
      },
      revision: ctx.settings!.view('ai').revision,
    },
  });

  const now = Date.now();
  db.run(
    `INSERT INTO books (id, content_hash, content_hash_kind, format, title, author, language, description, pubdate, page_count, meta_json, source, created_at, updated_at)
     VALUES (?, 'rev1', 'manifest', 'chapters', '十日终焉', '杀虫队队员', 'zh', '', '', 2, '{"kind":"text"}', 'provider:test', ?, ?)`,
    onlineBookId,
    now,
    now,
  );
  db.run(
    `INSERT INTO user_books (user_id, book_id, added_at) VALUES (?, ?, ?)`,
    userId,
    onlineBookId,
    now,
  );
  // No chapter_resources rows cached yet — simulates unread online chapters (body IS NULL / missing)

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/ai/companion',
    headers: auth,
    payload: { bookId: onlineBookId, sectionIndex: 1, window: 2, backfill: true, generateRecap: false },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.coveredChapters, 2);
  assert.equal(body.newlyExtracted, 2);
  assert.equal(body.hasMoreBackfill, false);
  assert.deepEqual(assetCalls, ['chapter-resource:rev1:c1', 'chapter-resource:rev1:c0']);

  // Calling again hits ai_chapter_digests fast-path with 0 extra chapter asset fetches
  const res2 = await app.inject({
    method: 'POST',
    url: '/api/v1/ai/companion',
    headers: auth,
    payload: { bookId: onlineBookId, sectionIndex: 1, window: 2, backfill: true, generateRecap: false },
  });
  assert.equal(res2.statusCode, 200);
  assert.equal(JSON.parse(res2.body).newlyExtracted, 0);
  assert.equal(assetCalls.length, 2);
});
