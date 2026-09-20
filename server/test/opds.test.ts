import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpdsProvider } from '../src/sources/opds.ts';
import { AppError } from '../src/lib/errors.ts';
import type { Acquisition, SourceContext } from '../src/sources/types.ts';

const ROOT = 'https://library.example/catalog';
const ACQUIRE = 'http://opds-spec.org/acquisition';

function context(config: Record<string, unknown> = { url: ROOT }): SourceContext {
  return {
    instance: { id: 'library', pluginId: 'builtin.opds', sourceType: 'opds', name: 'Library', config, enabled: true },
    userId: 'reader', signal: new AbortController().signal,
  };
}

function transport(routes: Record<string, string | object | Response>) {
  const calls: Array<{ url: string; headers: Headers; redirect?: RequestRedirect }> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers), redirect: init?.redirect });
    const route = routes[url];
    assert.notEqual(route, undefined, `Unexpected network request: ${url}`);
    const response = route instanceof Response
      ? route
      : new Response(typeof route === 'string' ? route : JSON.stringify(route), { status: 200 });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
  return { fetch, calls };
}

function jsonFeed(extra: Record<string, unknown> = {}) {
  return {
    metadata: { title: 'Library' },
    publications: [{
      metadata: { identifier: 'urn:book:one', title: 'One', author: [{ name: 'Alice' }, { name: 'Bob' }] },
      images: [{ href: '/covers/one.jpg', type: 'image/jpeg' }],
      links: [{ href: '/files/one.epub', type: 'application/epub+zip', rel: ACQUIRE }],
    }],
    ...extra,
  };
}

function code(expected: string) {
  return (error: unknown) => error instanceof AppError && error.code === expected;
}

test('OPDS 1 Atom resolves namespaces, xml:base, navigation, pagination and direct acquisitions', async () => {
  const xml = `<?xml version="1.0"?>
    <atom:feed xmlns:atom="http://www.w3.org/2005/Atom" xml:base="/books/">
      <atom:title>A &amp; B</atom:title>
      <atom:link rel="next" href="?page=2&amp;count=10" type="application/atom+xml"/>
      <atom:entry><atom:id>urn:category:fiction</atom:id><atom:title>Fiction</atom:title>
        <atom:link rel="subsection" href="fiction" type="application/atom+xml;profile=opds-catalog"/>
      </atom:entry>
      <atom:entry xml:base="one/"><atom:id>urn:book:one</atom:id><atom:title>书籍一</atom:title>
        <atom:author><atom:name>作者</atom:name></atom:author><atom:summary>Summary</atom:summary>
        <atom:link rel="http://opds-spec.org/image/thumbnail" href="cover.jpg"/>
        <atom:link rel="${ACQUIRE}/open-access" href="book.epub" type="application/epub+zip"/>
      </atom:entry>
    </atom:feed>`;
  const network = transport({ [ROOT]: xml });
  const provider = createOpdsProvider(network);
  const page = await provider.browse!(context(), {});
  assert.equal(page.title, 'A & B');
  assert.deepEqual(page.navigation, [{ title: 'Fiction', ref: 'https://library.example/books/fiction', kind: 'catalog' }]);
  assert.equal(page.nextCursor, 'https://library.example/books/?page=2&count=10');
  assert.equal(page.items[0]?.title, '书籍一');
  assert.deepEqual(page.items[0]?.authors, ['作者']);
  assert.equal(page.items[0]?.coverUrl, 'https://library.example/books/one/cover.jpg');
  assert.equal(page.items[0]?.options?.[0]?.available, true);
});

test('OPDS 2 groups and navigation remain separate from publication entries', async () => {
  const network = transport({ [ROOT]: jsonFeed({
    links: [{ rel: 'next', href: '?page=2' }],
    navigation: [{ title: 'Recent', href: '/recent', type: 'application/opds+json' }],
    groups: [{ publications: [{ metadata: { identifier: 'urn:book:two', title: 'Two' }, links: [{ rel: ACQUIRE, href: '/two.pdf', type: 'application/pdf' }] }] }],
  }) });
  const page = await createOpdsProvider(network).browse!(context(), {});
  assert.deepEqual(page.items.map((item) => item.title), ['One', 'Two']);
  assert.deepEqual(page.items[0]?.authors, ['Alice', 'Bob']);
  assert.equal(page.items[0]?.coverUrl, 'https://library.example/covers/one.jpg');
  assert.equal(page.navigation?.[0]?.title, 'Recent');
  assert.equal(page.nextCursor, `${ROOT}?page=2`);
});

test('acquisition revalidates provider references and streams the selected file', async () => {
  const network = transport({ [ROOT]: jsonFeed(), 'https://library.example/files/one.epub': new Response('epub-bytes', { headers: { 'content-type': 'application/epub+zip', etag: '"one"' } }) });
  const provider = createOpdsProvider(network);
  const ctx = context();
  const entry = (await provider.browse!(ctx, {})).items[0]!;
  const acquisition = await provider.acquire(ctx, { entryRef: entry.ref });
  assert.equal(acquisition.kind, 'file');
  assert.equal('url' in acquisition, false, 'host must resolve a provider reference, not fetch a client-supplied URL');
  const file = await provider.openFile!(ctx, acquisition as Extract<Acquisition, { kind: 'file' }>);
  const chunks: Buffer[] = [];
  for await (const chunk of file.stream!) chunks.push(Buffer.from(chunk));
  assert.equal(Buffer.concat(chunks).toString(), 'epub-bytes');
  assert.equal(file.mediaType, 'application/epub+zip');
  assert.equal(file.etag, '"one"');
  await assert.rejects(() => provider.acquire(ctx, { entryRef: entry.ref, optionId: 'invented' }), code('RESOURCE_GONE'));
  await assert.rejects(() => provider.detail(ctx, 'not-a-ref'), code('INVALID_SOURCE_REF'));
});

test('borrowing, purchases and DRM are explicit external actions rather than file downloads', async () => {
  for (const [rel, mediaType, expected] of [
    [`${ACQUIRE}/borrow`, 'application/epub+zip', 'borrow'],
    [`${ACQUIRE}/buy`, 'application/epub+zip', 'external'],
    [ACQUIRE, 'application/vnd.adobe.adept+xml', 'external'],
  ]) {
    const network = transport({ [ROOT]: jsonFeed({ publications: [{ metadata: { identifier: 'one', title: 'One' }, links: [{ rel, type: mediaType, href: '/action' }] }] }) });
    const provider = createOpdsProvider(network);
    const entry = (await provider.browse!(context(), {})).items[0]!;
    assert.equal(entry.options?.[0]?.available, false);
    const acquisition = await provider.acquire(context(), { entryRef: entry.ref });
    assert.equal(acquisition.kind, 'action-required');
    if (acquisition.kind === 'action-required') assert.equal(acquisition.action.type, expected);
  }
});

test('JSON search templates encode user input and pagination follows advertised links', async () => {
  const searchUrl = 'https://library.example/search?q=%E4%B8%89%E4%BD%93%20%26%20A&limit=20';
  const network = transport({
    [ROOT]: jsonFeed({ links: [{ rel: 'search', href: '/search?q={searchTerms}&limit={count}', type: 'application/opds+json', templated: true }] }),
    [searchUrl]: jsonFeed({ links: [{ rel: 'next', href: '/search?page=2' }] }),
    'https://library.example/search?page=2': jsonFeed(),
  });
  const provider = createOpdsProvider(network);
  const first = await provider.search!(context(), { query: '三体 & A', limit: 20 });
  assert.equal(first.items.length, 1);
  await provider.search!(context(), { query: '三体 & A', cursor: first.nextCursor });
  assert.equal(network.calls.at(-1)?.url, 'https://library.example/search?page=2');
});

test('OPDS 1 OpenSearch descriptions resolve their relative GET templates', async () => {
  const network = transport({
    [ROOT]: '<feed xmlns="http://www.w3.org/2005/Atom"><title>Search</title><link rel="search" href="/search/description.xml" type="application/opensearchdescription+xml"/></feed>',
    'https://library.example/search/description.xml': '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/"><Url type="application/atom+xml" template="results?q={searchTerms}&amp;page={startPage}&amp;language={language?}"/></OpenSearchDescription>',
    'https://library.example/search/results?q=Hello%20World&page=1&language=': '<feed xmlns="http://www.w3.org/2005/Atom"><title>Results</title></feed>',
  });
  const result = await createOpdsProvider(network).search!(context(), { query: 'Hello World' });
  assert.equal(result.title, 'Results');
  assert.equal(network.calls.length, 3);
});

test('missing search capability produces a stable unsupported error', async () => {
  const provider = createOpdsProvider(transport({ [ROOT]: jsonFeed() }));
  await assert.rejects(() => provider.search!(context(), { query: 'book' }), code('SOURCE_UNSUPPORTED'));
});

test('basic credentials stay scoped to the configured origin on allowed CDN redirects', async () => {
  const network = transport({
    [ROOT]: jsonFeed(),
    'https://library.example/files/one.epub': new Response(null, { status: 302, headers: { location: 'https://cdn.example/one.epub' } }),
    'https://cdn.example/one.epub': new Response('epub', { headers: { 'content-type': 'application/epub+zip' } }),
  });
  const ctx: SourceContext = {
    ...context({ url: ROOT, username: 'reader', allowedOrigins: ['https://cdn.example'] }),
    credentials: { get: async () => 'secret', set: async () => {}, delete: async () => {} },
  };
  const provider = createOpdsProvider(network);
  const entry = (await provider.browse!(ctx, {})).items[0]!;
  const acquisition = await provider.acquire(ctx, { entryRef: entry.ref });
  assert.equal(acquisition.kind, 'file');
  const resource = await provider.openFile!(ctx, acquisition as Extract<Acquisition, { kind: 'file' }>);
  resource.stream!.resume();
  assert.equal(network.calls[0]?.headers.get('authorization'), `Basic ${Buffer.from('reader:secret').toString('base64')}`);
  assert.equal(network.calls.at(-1)?.headers.get('authorization'), null);
  assert.ok(network.calls.every((call) => call.redirect === 'manual'));
});

test('forged origins and redirects are rejected before reaching an unrelated host', async () => {
  const network = transport({ [ROOT]: new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }) });
  const provider = createOpdsProvider(network);
  await assert.rejects(() => provider.browse!(context(), { cursor: 'https://other.example/private' }), code('OPDS_UNSAFE_URL'));
  assert.equal(network.calls.length, 0);
  await assert.rejects(() => provider.browse!(context(), {}), code('OPDS_UNSAFE_URL'));
  assert.equal(network.calls.length, 1);
  assert.throws(() => provider.validateConfig!({ url: 'https://user:password@example.com/opds' }), code('INVALID_SOURCE_CONFIG'));
  assert.throws(() => provider.validateConfig!({ url: ROOT, password: 'secret' }), code('INVALID_SOURCE_CONFIG'));
});

test('malformed XML, entity declarations, oversized feeds and authentication failures are bounded errors', async () => {
  for (const xml of ['<feed><title>broken</feed>', '<html><title>Login</title></html>', '{}', '<!DOCTYPE feed [<!ENTITY secret SYSTEM "file:///etc/passwd">]><feed><title>&secret;</title></feed>']) {
    await assert.rejects(() => createOpdsProvider(transport({ [ROOT]: xml })).browse!(context(), {}), code('OPDS_INVALID_RESPONSE'));
  }
  await assert.rejects(() => createOpdsProvider({ ...transport({ [ROOT]: jsonFeed() }), maxFeedBytes: 20 }).browse!(context(), {}), code('RESOURCE_TOO_LARGE'));
  await assert.rejects(() => createOpdsProvider(transport({ [ROOT]: new Response('', { status: 401 }) })).browse!(context(), {}), code('AUTH_REQUIRED'));
  await assert.rejects(() => createOpdsProvider(transport({ [ROOT]: jsonFeed() })).browse!(context({ url: ROOT, username: 'reader' }), {}), code('AUTH_REQUIRED'));
});

test('a successful HTML login page cannot masquerade as an EPUB download', async () => {
  const network = transport({
    [ROOT]: jsonFeed(),
    'https://library.example/files/one.epub': new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }),
  });
  const provider = createOpdsProvider(network);
  const entry = (await provider.browse!(context(), {})).items[0]!;
  const acquisition = await provider.acquire(context(), { entryRef: entry.ref });
  await assert.rejects(() => provider.openFile!(context(), acquisition as Extract<Acquisition, { kind: 'file' }>), code('OPDS_INVALID_RESPONSE'));
});

test('download streams enforce the byte budget even without Content-Length', async () => {
  const network = transport({
    [ROOT]: jsonFeed(),
    'https://library.example/files/one.epub': new Response('a'.repeat(64), { headers: { 'content-type': 'application/epub+zip' } }),
  });
  const provider = createOpdsProvider({ ...network, maxFileBytes: 32 });
  const entry = (await provider.browse!(context(), {})).items[0]!;
  const acquisition = await provider.acquire(context(), { entryRef: entry.ref });
  const file = await provider.openFile!(context(), acquisition as Extract<Acquisition, { kind: 'file' }>);
  await assert.rejects(async () => { for await (const _chunk of file.stream!) { /* Drain until the provider rejects the oversized body. */ } }, code('RESOURCE_TOO_LARGE'));
});

test('cancelled operations do not start a network request', async () => {
  const network = transport({ [ROOT]: jsonFeed() });
  const ctx = { ...context(), signal: AbortSignal.abort() };
  await assert.rejects(() => createOpdsProvider(network).browse!(ctx, {}), { name: 'AbortError' });
  assert.equal(network.calls.length, 0);
});
