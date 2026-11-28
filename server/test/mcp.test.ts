import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import Fastify, { type FastifyInstance } from 'fastify';

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
import { resolveProgressSectionIndex } from '../src/services/mcp.ts';

let app: FastifyInstance;
let ctx: AppContext;
let root: string;
let accessToken: string;
let bookId: string;

async function makeMultiChapterEpub() {
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
    <dc:identifier id="bookid">urn:test:mcp-book-1</dc:identifier>
    <dc:title>分布式系统设计指南</dc:title>
    <dc:creator>测试作者</dc:creator>
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
    '<html><body><h1>第一章 复制与共识</h1><p>林默在第一章提出了 Raft 领导者选举协议。</p></body></html>',
  );
  zip.file(
    'OEBPS/ch2.xhtml',
    '<html><body><h1>第二章 日志压缩</h1><p>第二章讨论了快照机制与状态机恢复。</p></body></html>',
  );
  zip.file(
    'OEBPS/ch3.xhtml',
    '<html><body><h1>第三章 终局反转</h1><p>剧透内容：林默其实是幕后最终反派。</p></body></html>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function rpc(token: string, body: unknown) {
  const res = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    payload: body,
  });
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null, headers: res.headers };
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'reader-mcp-test-'));
  const booksDir = join(root, 'books');
  await mkdir(booksDir, { recursive: true });
  await writeFile(join(booksDir, 'distributed.epub'), await makeMultiChapterEpub());

  process.env.BOOKS_DIR = booksDir;
  process.env.DATA_DIR = join(root, 'data');
  process.env.SCAN_INTERVAL = '0';
  process.env.WATCH_INTERVAL = '0';
  process.env.READER_TOKEN_SECRET = 'mcp-test-secret-long-enough-12345';

  const config = loadConfig();
  const db = openDatabase(config);
  autoShelf(db);
  const silent = Fastify({ logger: false });
  ctx = {
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

  app = buildApp(ctx);
  await ctx.scanner.scan();

  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: 'alice', password: 'password123', displayName: 'Alice' },
  });
  assert.equal(reg.statusCode, 201);
  accessToken = JSON.parse(reg.body).session.accessToken;

  const list = await app.inject({
    method: 'GET',
    url: '/api/v1/books',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const books = JSON.parse(list.body).items;
  assert.equal(books.length, 1);
  bookId = books[0].id;
});

after(async () => {
  await app.close();
  ctx.db.close();
  await rm(root, { recursive: true, force: true });
});

test('resolveProgressSectionIndex maps r1, rt1, and percentage onto manifest items', () => {
  const items = [
    { id: 'c1', seq: 0, title: 'Ch1', kind: 'chapter' as const, href: 'xhtml:OEBPS/ch1.xhtml' },
    { id: 'c2', seq: 1, title: 'Ch2', kind: 'chapter' as const, href: 'xhtml:OEBPS/ch2.xhtml' },
    { id: 'c3', seq: 2, title: 'Ch3', kind: 'chapter' as const, href: 'xhtml:OEBPS/ch3.xhtml' },
  ];
  assert.equal(resolveProgressSectionIndex('r1:0.2500:OEBPS/ch2.xhtml', 0.4, items), 1);
  assert.equal(
    resolveProgressSectionIndex(
      'rt1:' + JSON.stringify({ sectionId: 'OEBPS/ch1.xhtml', start: 0, end: 3 }),
      0.1,
      items,
    ),
    0,
  );
  assert.equal(resolveProgressSectionIndex('', 0.7, items), 2);
  assert.equal(resolveProgressSectionIndex('', 0, items), null);
});

test('MCP credentials CRUD, auth enforcement, and scope isolation', async () => {
  // Missing token is rejected
  const unauth = await app.inject({
    method: 'POST',
    url: '/mcp',
    payload: { jsonrpc: '2.0', id: 1, method: 'ping' },
  });
  assert.equal(unauth.statusCode, 401);

  // Create read-only credential
  const createRead = await app.inject({
    method: 'POST',
    url: '/api/v1/mcp/credentials',
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { name: 'Claude Read', scope: 'read' },
  });
  assert.equal(createRead.statusCode, 201);
  const readCred = JSON.parse(createRead.body);
  assert.equal(readCred.scope, 'read');
  assert.ok(readCred.token.startsWith('rdr_'));

  // Create write credential
  const createWrite = await app.inject({
    method: 'POST',
    url: '/api/v1/mcp/credentials',
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { name: 'Cursor Write', scope: 'write' },
  });
  assert.equal(createWrite.statusCode, 201);
  const writeCred = JSON.parse(createWrite.body);
  assert.equal(writeCred.scope, 'write');

  // initialize + notifications/initialized
  const init = await rpc(readCred.token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(init.status, 200);
  assert.equal(init.json.result.serverInfo.name, 'reader-pro');
  assert.equal(init.headers['cache-control'], 'private, no-store');

  const notif = await rpc(readCred.token, { jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notif.status, 202);

  // read token cannot see or invoke append_note
  const readTools = await rpc(readCred.token, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const readNames = readTools.json.result.tools.map((t: { name: string }) => t.name);
  assert.ok(readNames.includes('search_books'));
  assert.ok(!readNames.includes('append_note'));

  const deniedWrite = await rpc(readCred.token, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'append_note', arguments: { bookId, comment: 'should fail' } },
  });
  assert.equal(deniedWrite.json.result.isError, true);

  // write token sees append_note
  const writeTools = await rpc(writeCred.token, { jsonrpc: '2.0', id: 4, method: 'tools/list' });
  const writeNames = writeTools.json.result.tools.map((t: { name: string }) => t.name);
  assert.ok(writeNames.includes('append_note'));

  // Revoke read token and verify rejection
  const del = await app.inject({
    method: 'DELETE',
    url: `/api/v1/mcp/credentials/${encodeURIComponent(readCred.id)}`,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(del.statusCode, 200);
  const afterRevoke = await rpc(readCred.token, { jsonrpc: '2.0', id: 5, method: 'ping' });
  assert.equal(afterRevoke.status, 401);

  // Clean up write token at end of this test
  await app.inject({
    method: 'DELETE',
    url: `/api/v1/mcp/credentials/${encodeURIComponent(writeCred.id)}`,
    headers: { authorization: `Bearer ${accessToken}` },
  });
});

test('MCP reading tools, spoiler protection, notes sync, resources and prompts', async () => {
  const createWrite = await app.inject({
    method: 'POST',
    url: '/api/v1/mcp/credentials',
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { name: 'Agent Full', scope: 'write' },
  });
  const token = JSON.parse(createWrite.body).token as string;

  // 1. search_books & get_book_toc
  const searched = await rpc(token, {
    jsonrpc: '2.0',
    id: 10,
    method: 'tools/call',
    params: { name: 'search_books', arguments: { search: '分布式' } },
  });
  const searchPayload = JSON.parse(searched.json.result.content[0].text);
  assert.equal(searchPayload.total, 1);
  assert.equal(searchPayload.items[0].bookId, bookId);

  const tocRes = await rpc(token, {
    jsonrpc: '2.0',
    id: 11,
    method: 'tools/call',
    params: { name: 'get_book_toc', arguments: { bookId } },
  });
  const toc = JSON.parse(tocRes.json.result.content[0].text);
  assert.equal(toc.total, 3);
  const ch1Href = toc.items[0].href as string;

  // 2. Push reading progress at chapter 1 (sectionIndex 0)
  const syncPush = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: { authorization: `Bearer ${accessToken}` },
    payload: {
      progress: [
        {
          bookId,
          locator: `r1:0.5000:${ch1Href}`,
          percentage: 0.2,
          chapterTitle: '第一章 复制与共识',
          device: 'test',
          updatedAt: Date.now(),
        },
      ],
    },
  });
  assert.equal(syncPush.statusCode, 200);

  // 3. read_passage with respectProgress=true allows ch1 (0) and blocks ch3 (2)
  const ch1Read = await rpc(token, {
    jsonrpc: '2.0',
    id: 12,
    method: 'tools/call',
    params: { name: 'read_passage', arguments: { bookId, sectionIndex: 0, respectProgress: true } },
  });
  assert.equal(ch1Read.json.result.isError, undefined);
  const ch1Data = JSON.parse(ch1Read.json.result.content[0].text);
  assert.match(ch1Data.text, /Raft/);

  const ch3Blocked = await rpc(token, {
    jsonrpc: '2.0',
    id: 13,
    method: 'tools/call',
    params: { name: 'read_passage', arguments: { bookId, sectionIndex: 2, respectProgress: true } },
  });
  assert.equal(ch3Blocked.json.result.isError, true);
  assert.match(ch3Blocked.json.result.content[0].text, /SPOILER_GUARD/);

  // 4. search_book_content with respectProgress=true hides chapter 3 spoiler
  const safeSearch = await rpc(token, {
    jsonrpc: '2.0',
    id: 14,
    method: 'tools/call',
    params: { name: 'search_book_content', arguments: { bookId, query: '林默', respectProgress: true } },
  });
  const safeHits = JSON.parse(safeSearch.json.result.content[0].text);
  assert.equal(safeHits.maxSectionIndex, 0);
  assert.equal(safeHits.hits.length, 1);
  assert.equal(safeHits.hits[0].sectionIndex, 0);

  // Without respectProgress, both ch1 and ch3 match
  const fullSearch = await rpc(token, {
    jsonrpc: '2.0',
    id: 15,
    method: 'tools/call',
    params: { name: 'search_book_content', arguments: { bookId, query: '林默', respectProgress: false } },
  });
  const fullHits = JSON.parse(fullSearch.json.result.content[0].text);
  assert.equal(fullHits.hits.length, 2);

  // 5. append_note writes through SyncService so /api/v1/sync pulls it
  const noteRes = await rpc(token, {
    jsonrpc: '2.0',
    id: 16,
    method: 'tools/call',
    params: {
      name: 'append_note',
      arguments: {
        bookId,
        type: 'highlight',
        text: 'Raft 领导者选举协议',
        comment: '结合代码核对任期与投票持久化',
        chapterTitle: '第一章 复制与共识',
        tags: ['共识算法'],
      },
    },
  });
  assert.equal(noteRes.json.result.isError, undefined);
  const createdNote = JSON.parse(noteRes.json.result.content[0].text);
  assert.equal(createdNote.synced, true);

  const pulled = await app.inject({
    method: 'GET',
    url: '/api/v1/sync?since=0',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const syncedNotes = JSON.parse(pulled.body).notes;
  assert.ok(
    syncedNotes.some((n: { id: string; comment: string }) => n.id === createdNote.id && n.comment.includes('任期')),
  );

  // 6. export_notes_markdown, resource reader://library/recent, and prompt review_book_notes
  const exported = await rpc(token, {
    jsonrpc: '2.0',
    id: 17,
    method: 'tools/call',
    params: { name: 'export_notes_markdown', arguments: { bookId } },
  });
  const md = JSON.parse(exported.json.result.content[0].text);
  assert.equal(md.noteCount, 1);
  assert.match(md.markdown, /Raft 领导者选举协议/);

  const recentRes = await rpc(token, {
    jsonrpc: '2.0',
    id: 18,
    method: 'resources/read',
    params: { uri: 'reader://library/recent' },
  });
  const recent = JSON.parse(recentRes.json.result.contents[0].text);
  assert.equal(recent.recentBooks.length, 1);
  assert.equal(recent.recentNotes.length, 1);

  const promptRes = await rpc(token, {
    jsonrpc: '2.0',
    id: 19,
    method: 'prompts/get',
    params: { name: 'review_book_notes', arguments: { bookId } },
  });
  assert.match(promptRes.json.result.messages[0].content.text, /分布式系统设计指南/);

  // 7. search_library_content (lazy FTS5 index, >=3 char trigram & <3 char fallback, respectProgress)
  const ftsLong = await rpc(token, {
    jsonrpc: '2.0',
    id: 20,
    method: 'tools/call',
    params: { name: 'search_library_content', arguments: { query: '领导者选举' } },
  });
  assert.equal(ftsLong.json.result.isError, undefined);
  const ftsLongData = JSON.parse(ftsLong.json.result.content[0].text);
  assert.equal(ftsLongData.newlyIndexed, 1);
  assert.equal(ftsLongData.indexedBooks, 1);
  assert.equal(ftsLongData.hits.length, 1);
  assert.equal(ftsLongData.hits[0].sectionIndex, 0);

  // Second call reuses cached FTS5 index (newlyIndexed = 0) and respects progress on 2-char CJK query
  const ftsSafeShort = await rpc(token, {
    jsonrpc: '2.0',
    id: 21,
    method: 'tools/call',
    params: { name: 'search_library_content', arguments: { query: '林默', respectProgress: true } },
  });
  const ftsSafeShortData = JSON.parse(ftsSafeShort.json.result.content[0].text);
  assert.equal(ftsSafeShortData.newlyIndexed, 0);
  assert.equal(ftsSafeShortData.hits.length, 1);
  assert.equal(ftsSafeShortData.hits[0].sectionIndex, 0);
  assert.doesNotMatch(ftsSafeShortData.hits[0].excerpt, /反派/);
});
