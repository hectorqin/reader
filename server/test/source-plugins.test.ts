import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ProcessPlugin } from '../src/sources/process-plugin.ts';
import { SourceRegistry, validatePluginManifest } from '../src/sources/registry.ts';
import { decodeCatalogPage, decodeChapterAcquisition, decodeManifest } from '../src/sources/protocol.ts';
import type { PluginManifest, SourceContext, SourceProvider } from '../src/sources/types.ts';

function context(signal = new AbortController().signal): SourceContext {
  return {
    userId: 'user-one',
    signal,
    instance: {
      id: 'instance-one', pluginId: 'reader.source.demo', sourceType: 'demo-chapters',
      name: 'Demo', config: {}, enabled: true,
    },
  };
}

const manifest: PluginManifest = {
  id: 'test.source', name: 'Test', version: '1.0.0', apiVersion: 1, runtime: 'node', entry: 'main.mjs',
  sourceTypes: [{ id: 'test', label: 'Test', capabilities: ['detail'] }],
};

test('catalog protocol preserves partial failures and rejects malformed diagnostics', () => {
  const errors = [{ source: 'A', code: 'HTTP_ERROR', message: 'HTTP 503' }];
  assert.deepEqual(decodeCatalogPage({ items: [{ ref: 'b', title: 'Book' }], errors }).errors, errors);
  assert.deepEqual(decodeCatalogPage({ items: [] }).items, []);
  for (const invalid of [null, {}, ['failed'], [{ source: 'A', code: 'X' }], [{ ...errors[0], message: {} }]]) {
    assert.throws(() => decodeCatalogPage({ items: [], errors: invalid }), { code: 'PLUGIN_PROTOCOL_ERROR' });
  }
  assert.deepEqual(decodeCatalogPage({ items: [], batch: { completed: 0, total: 0 } }).batch, { completed: 0, total: 0 });
  for (const batch of [{ completed: -1, total: 4 }, { completed: 5, total: 4 }, { completed: 1.5, total: 4 }, { completed: 1, total: 10001 }, { completed: '1', total: 4 }]) {
    assert.throws(() => decodeCatalogPage({ items: [], batch, nextCursor: 'next' }), { code: 'PLUGIN_PROTOCOL_ERROR' });
  }
  assert.throws(() => decodeCatalogPage({ items: [], batch: { completed: 1, total: 4 } }), { code: 'PLUGIN_PROTOCOL_ERROR' });
  assert.equal(decodeCatalogPage({ items: [], batch: { completed: 1, total: 4 }, limitReached: true }).limitReached, true);
  assert.throws(() => decodeCatalogPage({ items: [], limitReached: 'yes' }), { code: 'PLUGIN_PROTOCOL_ERROR' });
});

async function fixture(code: string): Promise<{ directory: string; dispose(): Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'reader-plugin-'));
  await writeFile(join(directory, 'plugin.json'), JSON.stringify(manifest));
  await writeFile(join(directory, 'main.mjs'), code);
  return { directory, dispose: () => rm(directory, { recursive: true, force: true }) };
}

test('registry separates plugin namespaces and rejects unsupported advertised capabilities', () => {
  const registry = new SourceRegistry();
  const provider: SourceProvider = {
    descriptor: { id: 'test', label: 'Test', version: '1', capabilities: ['detail'] },
    async detail() { return { ref: 'book', title: 'Book' }; },
    async acquire() { return { kind: 'ready', publicationId: 'book' }; },
  };
  registry.registerBuiltin('reader.builtin', provider);
  registry.register({ pluginId: 'reader.external', provider });
  assert.equal(registry.list().length, 2);
  assert.equal(registry.require('reader.builtin', 'test').builtin, true);
  assert.throws(() => registry.register({ pluginId: 'reader.external', provider }), /already registered/);
  assert.throws(() => registry.register({
    pluginId: 'reader.invalid',
    provider: { ...provider, descriptor: { ...provider.descriptor, capabilities: ['search'] } },
  }), /does not implement search/);
  assert.throws(() => registry.register({
    pluginId: 'reader.invalid',
    provider: { ...provider, descriptor: { ...provider.descriptor, capabilities: ['acquire.chapters'] } },
  }), /chapter manifest and resources/);
  assert.throws(() => registry.register({ pluginId: 'reader.invalid', provider: {
    ...provider, search: async () => ({ items: [] }), descriptor: { ...provider.descriptor, capabilities: ['search', 'search.session'] },
  } }), /search.session requires search.cancel/);
  assert.throws(() => registry.register({ pluginId: 'reader.invalid', provider: {
    ...provider, search: async () => ({ items: [] }), descriptor: { ...provider.descriptor, capabilities: ['search', 'search.cancel', 'search.session'] },
  } }), /does not implement cancelSearch/);
});

test('plugin manifest rejects API version mismatch and duplicate or incomplete source types', () => {
  assert.equal(validatePluginManifest(manifest).apiVersion, 1);
  assert.throws(() => validatePluginManifest({ ...manifest, apiVersion: 2 }), /API version/);
  assert.throws(() => validatePluginManifest({ ...manifest, apiVersion: undefined }), /API version/);
  assert.throws(() => validatePluginManifest({ ...manifest, sourceTypes: [manifest.sourceTypes[0], manifest.sourceTypes[0]] }), /duplicate/);
  assert.throws(() => validatePluginManifest({
    ...manifest, sourceTypes: [{ id: 'test', label: 'Test', capabilities: ['acquire.chapters'] }],
  }), /must declare manifest and resource/);
});

test('real example process supports discovery, acquisition and stable chapter resources', async () => {
  const plugin = await ProcessPlugin.load(resolve(import.meta.dirname, '../../examples/plugins/demo-chapters'));
  try {
    const registry = new SourceRegistry();
    const provider = plugin.providers()[0]!;
    registry.registerPluginManifest(plugin.manifest, provider);
    await provider.validateConfig?.({});
    const page = await provider.browse!(context(), {});
    assert.equal(page.items[0]?.ref, 'demo-book');
    const acquisition = await provider.acquire(context(), { entryRef: page.items[0]!.ref });
    assert.deepEqual(acquisition, { kind: 'chapters', publicationRef: 'demo-book' });
    const snapshot = await provider.getManifest!(context(), 'demo-book');
    assert.equal(snapshot.items[0]?.id, 'chapter-one');
    const resource = await provider.readResource!(context(), { publicationRef: 'demo-book', ref: snapshot.items[0]!.ref });
    assert.match(resource.text!, /独立 Node 进程/);
    await assert.rejects(provider.detail(context(), 'missing'), { code: 'RESOURCE_GONE' });
    assert.equal(plugin.status().state, 'running');
    assert.equal(plugin.status().pendingRequests, 0);
  } finally {
    await plugin.close();
  }
});

test('process timeout terminates pending work and requires a reload', async () => {
  const source = await fixture('process.stdin.resume();');
  const plugin = await ProcessPlugin.load(source.directory, { timeoutMs: 100 });
  try {
    await assert.rejects(plugin.providers()[0]!.detail(context(), 'book'), { code: 'PLUGIN_TIMEOUT' });
    assert.equal(plugin.status().state, 'failed');
    assert.equal(plugin.status().pendingRequests, 0);
    await assert.rejects(plugin.providers()[0]!.detail(context(), 'book'), { code: 'PLUGIN_UNAVAILABLE' });
  } finally {
    await plugin.close();
    await source.dispose();
  }
});

test('cancellation kills an uncooperative worker and rejects its concurrent calls', async () => {
  const source = await fixture('process.stdin.resume();');
  const plugin = await ProcessPlugin.load(source.directory);
  try {
    const controller = new AbortController();
    const pending = plugin.providers()[0]!.detail(context(controller.signal), 'book');
    const concurrent = plugin.providers()[0]!.detail(context(), 'another-book');
    const outcomes = Promise.allSettled([pending, concurrent]);
    controller.abort();
    for (const result of await outcomes) {
      assert.equal(result.status, 'rejected');
      if (result.status === 'rejected') assert.equal(result.reason.code, 'PLUGIN_CANCELLED');
    }
    assert.equal(plugin.status().pendingRequests, 0);
    assert.equal(plugin.status().state, 'failed');
  } finally {
    await plugin.close();
    await source.dispose();
  }
});

test('cooperative cancellation clears the deadline even without an acknowledgement', async () => {
  const source = await fixture(`
    import { createInterface } from 'node:readline';
    createInterface({ input: process.stdin }).on('line', line => {
      const request = JSON.parse(line);
      if (request.method === 'search' || request.method === '$/cancelRequest') return;
      if (request.method === 'detail') process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', id: request.id, result: { ref: 'book', title: 'Still available' }
      }) + '\\n');
    });
  `);
  await writeFile(join(source.directory, 'plugin.json'), JSON.stringify({ ...manifest,
    sourceTypes: [{ id: 'test', label: 'Test', capabilities: ['detail', 'search', 'search.cancel'] }],
  }));
  const plugin = await ProcessPlugin.load(source.directory, { timeoutMs: 2000 });
  try {
    const provider = plugin.providers()[0]!;
    const controller = new AbortController();
    const rejected = assert.rejects(provider.search!(context(controller.signal), { query: 'slow' }), { code: 'PLUGIN_CANCELLED' });
    await provider.detail(context(), 'book');
    controller.abort();
    await rejected;
    assert.equal(plugin.status().pendingRequests, 0);
    await new Promise(resolve => setTimeout(resolve, 2100));
    assert.equal(plugin.status().state, 'running');
    assert.equal((await provider.detail(context(), 'book')).title, 'Still available');
  } finally {
    await plugin.close();
    await source.dispose();
  }
});

for (const end of ['abort', 'deadline'] as const) test(`search cancellation ${end} does not disable acquisition`, async () => {
  const source = await fixture(`
    import { createInterface } from 'node:readline';
    createInterface({ input: process.stdin }).on('line', line => {
      const request = JSON.parse(line);
      if (request.method === 'searchCancel' || request.method === '$/cancelRequest') return;
      const result = request.method === 'acquire'
        ? { kind: 'chapters', publicationRef: 'book', title: 'Book' }
        : { ref: 'book', title: 'Book' };
      setTimeout(() => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n'), 50);
    });
  `);
  await writeFile(join(source.directory, 'plugin.json'), JSON.stringify({ ...manifest,
    sourceTypes: [{ id: 'test', label: 'Test', capabilities: ['detail', 'search', 'search.cancel', 'search.session'] }],
  }));
  const plugin = await ProcessPlugin.load(source.directory, { timeoutMs: 2000 });
  try {
    const provider = plugin.providers()[0]!;
    await provider.detail(context(), 'book');
    const controller = new AbortController();
    const cancelled = assert.rejects(provider.cancelSearch!(context(controller.signal), 'session'), {
      code: end === 'abort' ? 'PLUGIN_CANCELLED' : 'PLUGIN_TIMEOUT',
    });
    if (end === 'deadline') await cancelled;
    const acquiring = provider.acquire(context(), { entryRef: 'book' });
    const outcome = Promise.allSettled([acquiring]);
    if (end === 'abort') controller.abort();
    await cancelled;
    assert.deepEqual(await outcome, [{ status: 'fulfilled', value: { kind: 'chapters', publicationRef: 'book', title: 'Book' } }]);
    assert.equal(plugin.status().state, 'running');
    assert.equal(plugin.status().pendingRequests, 0);
    assert.equal((await provider.acquire(context(), { entryRef: 'book' })).kind, 'chapters');
  } finally {
    await plugin.close();
    await source.dispose();
  }
});

test('wire validation prevents plugins claiming host books or corrupting chapter identities', () => {
  assert.throws(() => decodeChapterAcquisition({ kind: 'ready', publicationId: 'other-users-book' }), /must acquire chapter/);
  assert.throws(() => decodeChapterAcquisition({ kind: 'action-required', action: { type: 'external', label: 'Open', url: 'javascript:alert(1)' } }), /HTTP or HTTPS/);
  const item = { id: 'stable', seq: 0, title: 'Chapter', kind: 'chapter', mediaType: 'text/plain', ref: 'chapter' };
  assert.throws(() => decodeManifest({ publicationRef: 'wrong', items: [item] }, 'requested'), /does not match/);
  assert.throws(() => decodeManifest({ publicationRef: 'book', items: [item, { ...item, seq: 1 }] }, 'book'), /duplicate chapter/);
  assert.equal(decodeManifest({ publicationRef: 'book', items: [item] }, 'book').items[0]?.id, 'stable');
});

test('oversized responses fail the plugin instead of buffering unbounded output', async () => {
  const source = await fixture(`process.stdin.on('data', () => process.stdout.write('x'.repeat(4096)));`);
  const plugin = await ProcessPlugin.load(source.directory, { maxMessageBytes: 1024 });
  try {
    await assert.rejects(plugin.providers()[0]!.detail(context(), 'book'), { code: 'PLUGIN_MESSAGE_TOO_LARGE' });
    assert.equal(plugin.status().state, 'failed');
  } finally {
    await plugin.close();
    await source.dispose();
  }
});

test('plugin entry cannot escape its package directory', async () => {
  const source = await fixture('');
  try {
    await mkdir(join(source.directory, 'package'));
    await writeFile(join(source.directory, 'package', 'plugin.json'), JSON.stringify({ ...manifest, entry: '../main.mjs' }));
    await assert.rejects(ProcessPlugin.load(join(source.directory, 'package')), { code: 'PLUGIN_INVALID' });
  } finally {
    await source.dispose();
  }
});
