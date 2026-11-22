import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Db } from '../src/db/index.ts';
import { Scanner } from '../src/indexer/scanner.ts';
import { ShelfService } from '../src/services/shelf.ts';
import { UserService } from '../src/services/users.ts';
import { BookViewModes } from '../src/services/book-view-modes.ts';
import { buildApp } from '../src/http/app.ts';
import { signAccessToken } from '../src/services/tokens.ts';
import type { AppConfig } from '../src/config/index.ts';
import type { AppContext } from '../src/http/context.ts';
import { buildPdf } from './helpers/pdf-fixture.ts';

test("a reader's choice for one book wins over the site default, and clearing it returns to the default", () => {
  const db = new Db(':memory:');
  db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('u','u','x','member',0,0)");
  db.run(
    "INSERT INTO books(id,content_hash,title,author,format,created_at,updated_at) VALUES('b','h','t','a','pdf',0,0)",
  );
  const modes = new BookViewModes(db);
  assert.deepEqual(modes.get('u', 'b'), { pdfMode: 'pdfjs', chosen: null, defaultPdfMode: 'pdfjs' });
  db.run(
    "INSERT INTO business_settings (name, value, revision) VALUES ('library', ?, 1)",
    JSON.stringify({ pdfMode: 'enhanced' }),
  );
  assert.deepEqual(modes.get('u', 'b'), { pdfMode: 'enhanced', chosen: null, defaultPdfMode: 'enhanced' });
  assert.deepEqual(modes.set('u', 'b', 'pdfjs'), { pdfMode: 'pdfjs', chosen: 'pdfjs', defaultPdfMode: 'enhanced' });
  assert.deepEqual(modes.set('u', 'b', null), { pdfMode: 'enhanced', chosen: null, defaultPdfMode: 'enhanced' });
  assert.throws(() => modes.set('u', 'b', 'ocr'), /pdfMode/);
  db.close();
});

test("the manifest and table of contents follow the reader's mode; only PDFs can switch", async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'view-modes-'));
  const booksDir = join(root, 'books'),
    dataDir = join(root, 'data');
  await mkdir(booksDir);
  await mkdir(dataDir);
  await writeFile(
    join(booksDir, 'paper.pdf'),
    buildPdf(
      [
        [
          { text: 'Opening', y: 760, size: 18 },
          { text: 'The first chapter says something worth reading.', y: 720 },
        ],
        [
          { text: 'Closing', y: 760, size: 18 },
          { text: 'The last chapter says something else entirely.', y: 720 },
        ],
      ],
      [
        { title: 'Opening', page: 0, top: 780 },
        { title: 'Closing', page: 1, top: 780 },
      ],
    ),
  );
  await writeFile(join(booksDir, 'notes.txt'), '第一章\n' + '正文。'.repeat(100));
  const db = new Db(':memory:');
  const config: AppConfig = {
    booksDir,
    dataDir,
    host: '127.0.0.1',
    port: 0,
    jwtSecret: 'view-modes-test-secret-16chars',
    accessTokenTtl: 604800,
    refreshTokenTtl: 31536000,
    scanInterval: 1800,
    watchInterval: 60,
    logLevel: 'silent',
    publicUrl: '',
    corsOrigins: [],
    webDir: join(root, 'web'),
  };
  const ctx = { config, db, shelf: undefined, users: undefined } as unknown as AppContext;
  const app = buildApp(ctx);
  ctx.users = new UserService(db, config);
  ctx.shelf = new ShelfService(db);
  await app.ready();
  t.after(async () => {
    await app.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  });
  await new Scanner(db, config, { info: () => {}, warn: () => {} }).scan();
  db.run(
    "INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('alice','alice','x','member',0,0)",
  );
  const id = (format: string) => db.get<{ id: string }>('SELECT id FROM books WHERE format = ?', format)!.id;
  for (const format of ['pdf', 'txt'])
    db.run('INSERT INTO user_books(user_id,book_id,added_at) VALUES(?,?,0)', 'alice', id(format));
  const headers = { authorization: 'Bearer ' + signAccessToken(config, { id: 'alice', role: 'member' }).token };
  const pdf = id('pdf');
  const kind = async () => (await app.inject({ url: `/api/v1/books/${pdf}/manifest`, headers })).json().content.kind;

  assert.equal(await kind(), 'document');
  const switched = await app.inject({
    method: 'PUT',
    url: `/api/v1/books/${pdf}/view-mode`,
    headers,
    payload: { pdfMode: 'enhanced' },
  });
  assert.equal(switched.statusCode, 200, switched.body);
  assert.deepEqual(switched.json(), { pdfMode: 'enhanced', chosen: 'enhanced', defaultPdfMode: 'pdfjs' });
  assert.equal(await kind(), 'reflowable');
  const toc = (await app.inject({ url: `/api/v1/books/${pdf}/toc`, headers })).json().toc;
  assert.deepEqual(
    toc.map((entry: { title: string }) => entry.title),
    ['Opening', 'Closing'],
  );
  const search = await app.inject({
    url: `/api/v1/books/${pdf}/search?q=${encodeURIComponent('else entirely')}`,
    headers,
  });
  assert.equal(search.statusCode, 200, search.body);
  assert.equal(search.json().hits.length, 1);
  assert.equal(
    (await app.inject({ method: 'PUT', url: `/api/v1/books/${pdf}/view-mode`, headers, payload: {} })).json().chosen,
    null,
  );
  assert.equal(await kind(), 'document');

  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/v1/books/${id('txt')}/view-mode`,
        headers,
        payload: { pdfMode: 'enhanced' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ method: 'PUT', url: `/api/v1/books/${pdf}/view-mode`, headers, payload: { pdfMode: 'ocr' } }))
      .statusCode,
    400,
  );
});
