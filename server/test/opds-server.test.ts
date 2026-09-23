import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { Db } from '../src/db/index.ts';
import { buildApp } from '../src/http/app.ts';
import type { AppContext } from '../src/http/context.ts';
import { UserService } from '../src/services/users.ts';
import { ShelfService } from '../src/services/shelf.ts';
import { createOpdsProvider } from '../src/sources/opds.ts';
import type { SourceContext } from '../src/sources/types.ts';

test('OPDS credentials publish a scoped, paginated read-only feed and revoke every resource', async t => {
  const root = await mkdtemp(join(tmpdir(), 'reader-opds-test-'));
  const booksDir = join(root, 'books'), dataDir = join(root, 'data');
  await mkdir(booksDir); await mkdir(dataDir); await writeFile(join(booksDir, 'test.txt'), 'hello OPDS');
  const db = new Db(join(dataDir, 'reader.db'));
  const config = { booksDir, dataDir, host: '127.0.0.1', port: 0, jwtSecret: 'test-secret', accessTokenTtl: 3600, refreshTokenTtl: 3600,
    scanInterval: 0, watchInterval: 0, logLevel: 'silent' as const, publicUrl: 'https://reader.test/prefix', corsOrigins: [] };
  const ctx = { config, db } as AppContext;
  ctx.users = new UserService(db, config); ctx.shelf = new ShelfService(db);
  const app = buildApp(ctx);
  t.after(async () => { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); });
  const user = await ctx.users.create({ username: 'alice', password: 'password123' });
  const other = await ctx.users.create({ username: 'other', password: 'password123' });
  const session = await ctx.users.login('alice', 'password123', 'test');
  const otherSession = await ctx.users.login('other', 'password123', 'test');
  const bearer = { authorization: 'Bearer ' + session.accessToken };
  for (let i = 0; i < 52; i++) {
    const id = 'b' + String(i).padStart(3, '0');
    db.run('INSERT INTO books(id,content_hash,format,title,author,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', id, id, 'txt', 'Book ' + i + ' <&>', 'Author', 1, 1);
    await writeFile(join(booksDir, id + '.txt'), 'hello OPDS');
    db.run('INSERT INTO book_files(id,book_id,rel_path,size,mtime_ms,first_seen,last_seen) VALUES(?,?,?,?,?,?,?)', id, id, id + '.txt', 10, 1, 1, 1);
    db.run('INSERT INTO user_books(user_id,book_id,added_at,hidden) VALUES(?,?,?,?)', user.id, id, 1, i === 51 ? 1 : 0);
  }
  const noAuth = await app.inject('/opds'); assert.equal(noAuth.statusCode, 401); assert.match(String(noAuth.headers['www-authenticate']), /Basic/);
  const response = await app.inject({ method: 'POST', url: '/api/v1/opds/credentials', headers: bearer, payload: { name: 'Tablet' } });
  assert.equal(response.statusCode, 201, response.body);
  const credential = response.json(), basic = { authorization: 'Basic ' + Buffer.from(credential.username + ':' + credential.password).toString('base64') };
  assert.notEqual(db.get<{ token_hash: string }>('SELECT token_hash FROM opds_credentials')!.token_hash, credential.password);
  const listed = await app.inject({ url: '/api/v1/opds/credentials', headers: bearer });
  assert.ok(!listed.body.includes(credential.password));
  const feed = await app.inject({ url: '/opds', headers: basic });
  assert.equal(feed.statusCode, 200, feed.body); assert.equal(XMLValidator.validate(feed.body), true);
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(feed.body).feed;
  assert.equal(parsed.entry.length, 50); assert.equal(parsed['opensearch:totalResults'], 51);
  assert.ok(parsed.link.some((link: any) => link['@_rel'] === 'next'));
  assert.ok(feed.body.includes('https://reader.test/prefix/opds/books/'));
  assert.ok(feed.body.includes('&lt;&amp;&gt;')); assert.ok(!feed.body.includes('test.txt'));
  assert.equal(feed.headers['cache-control'], 'private, no-store');
  const client = createOpdsProvider({ fetch: async (input, init) => {
    const target = new URL(String(input));
    const response = await app.inject({ url: target.pathname.replace('/prefix', '') + target.search, headers: Object.fromEntries(new Headers(init?.headers)) });
    return new Response(response.rawPayload, { status: response.statusCode, headers: { 'content-type': String(response.headers['content-type']) } });
  } });
  const clientContext: SourceContext = {
    userId: user.id, signal: new AbortController().signal,
    instance: { id: 'client', pluginId: 'reader.opds', sourceType: 'opds', name: 'Client', enabled: true,
      config: { url: 'https://reader.test/prefix/opds', username: credential.username } },
    credentials: { async get() { return credential.password; }, async set() {}, async delete() {} },
  };
  const catalog = await client.browse!(clientContext, {});
  assert.equal(catalog.items.length, 50); assert.ok(catalog.nextCursor);
  const found = await client.search!(clientContext, { query: 'Book 10' });
  assert.equal(found.items.length, 1); assert.match(found.items[0]!.title, /Book 10/);
  const second = await app.inject({ url: '/opds?page=2', headers: basic });
  assert.equal(new XMLParser({ isArray: name => name === 'entry' }).parse(second.body).feed.entry.length, 1);
  const search = await app.inject({ url: '/opds?search=Book%2010', headers: basic });
  assert.match(search.body, /Book 10/); assert.doesNotMatch(search.body, /Book 11/);
  assert.equal((await app.inject({ url: '/opds?page=abc', headers: basic })).statusCode, 400);
  assert.equal(XMLValidator.validate((await app.inject({ url: '/opds/search.xml', headers: basic })).body), true);
  const resource = await app.inject({ url: '/opds/books/b000/content', headers: { ...basic, range: 'bytes=0-4' } });
  assert.equal(resource.statusCode, 206); assert.equal(resource.body, 'hello'); assert.equal(resource.headers['cache-control'], 'private, no-store');
  assert.equal((await app.inject({ url: '/opds/books/b051/content', headers: basic })).statusCode, 404);
  assert.equal((await app.inject({ url: '/api/v1/books', headers: basic })).statusCode, 401);
  await app.inject({ method: 'DELETE', url: '/api/v1/opds/credentials/' + credential.id, headers: { authorization: 'Bearer ' + otherSession.accessToken } });
  assert.equal((await app.inject({ url: '/opds', headers: basic })).statusCode, 200);
  db.run('UPDATE users SET disabled=1 WHERE id=?', user.id);
  assert.equal((await app.inject({ url: '/opds/books/b000/content', headers: basic })).statusCode, 401);
  db.run('UPDATE users SET disabled=0 WHERE id=?', user.id);
  db.run('UPDATE opds_credentials SET expires_at=0 WHERE id=?', credential.id);
  assert.equal((await app.inject({ url: '/opds', headers: basic })).statusCode, 401);
  db.run('UPDATE opds_credentials SET expires_at=? WHERE id=?', Date.now() + 10000, credential.id);
  const otherCred = (await app.inject({ method: 'POST', url: '/api/v1/opds/credentials', headers: { authorization: 'Bearer ' + otherSession.accessToken }, payload: { name: 'Other' } })).json();
  const otherBasic = { authorization: 'Basic ' + Buffer.from(otherCred.username + ':' + otherCred.password).toString('base64') };
  assert.ok(!(await app.inject({ url: '/opds', headers: otherBasic })).body.includes('<entry>'));
  assert.equal((await app.inject({ url: '/opds/books/b000/content', headers: otherBasic })).statusCode, 404);
  await app.inject({ method: 'DELETE', url: '/api/v1/opds/credentials/' + credential.id, headers: bearer });
  for (const url of ['/opds', '/opds/books/b000/content', '/opds/books/b000/cover']) assert.equal((await app.inject({ url, headers: basic })).statusCode, 401);
  assert.ok(other.id);
});
