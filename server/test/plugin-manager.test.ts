import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Db } from '../src/db/index.ts';
import { PluginManager } from '../src/sources/plugin-manager.ts';
import { SourceRegistry } from '../src/sources/registry.ts';
import type { SourceContext, SourceProvider } from '../src/sources/types.ts';

const WORKER = `import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (request.params.entryRef === 'hang') return;
  if (request.params.entryRef === 'crash') process.exit(1);
  const result = request.method === 'detail' ? { ref: 'book', title: 'Book' } : null;
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
});`;

const builtin: SourceProvider = {
  descriptor: { id: 'local', label: 'Local', version: '1', capabilities: ['detail'] },
  async detail() { return { ref: 'book', title: 'Local book' }; },
  async acquire() { return { kind: 'ready', publicationId: 'book' }; },
};

function context(): SourceContext {
  return {
    userId: 'reader', signal: new AbortController().signal,
    instance: { id: 'test', pluginId: 'test.plugin', sourceType: 'test', name: 'Test', config: {}, enabled: true },
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'reader-plugin-manager-'));
  const dataDir = join(root, 'data');
  await mkdir(join(dataDir, 'plugins'), { recursive: true });
  const db = new Db(':memory:');
  const registry = new SourceRegistry();
  registry.registerBuiltin('reader.local', builtin);
  const managers = [new PluginManager(db, dataDir, registry)];
  return {
    root, dataDir, db, registry, manager: managers[0]!,
    async package(folder = 'example', pluginId = 'test.plugin', sourceTypes: unknown[] = [{ id: 'test', label: 'Test', capabilities: ['detail'] }]) {
      const directory = join(dataDir, 'plugins', folder);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'plugin.json'), JSON.stringify({
        id: pluginId, name: 'Test plugin', version: '1.0.0', apiVersion: 1, runtime: 'node', entry: 'main.mjs', sourceTypes,
      }));
      await writeFile(join(directory, 'main.mjs'), WORKER);
      return directory;
    },
    restart() {
      const manager = new PluginManager(db, dataDir, registry);
      managers.push(manager);
      return manager;
    },
    async dispose() {
      for (const manager of managers) await manager.close();
      db.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('installation registers a real provider and lists builtins alongside the persisted package', async () => {
  const f = await fixture();
  try {
    await f.package();
    const installed = await f.manager.install('example');
    assert.equal(installed.pluginId, 'test.plugin');
    assert.equal(installed.folder, 'example');
    assert.equal(installed.enabled, true);
    assert.equal(installed.runtime?.state, 'stopped', 'processes start lazily on their first operation');
    const provider = f.registry.require('test.plugin', 'test').provider;
    assert.equal((await provider.detail(context(), 'book')).title, 'Book');
    const plugins = f.manager.list();
    assert.equal(plugins.find((plugin) => plugin.pluginId === 'reader.local')?.builtin, true);
    assert.equal(plugins.find((plugin) => plugin.pluginId === 'test.plugin')?.runtime?.state, 'running');
    assert.equal(f.db.get<{ enabled: number }>('SELECT enabled FROM installed_plugins WHERE plugin_id = ?', 'test.plugin')?.enabled, 1);
  } finally { await f.dispose(); }
});

test('npm packages support scopes, restart and reject traversal or outside links', async () => {
  const f = await fixture();
  try {
    await f.package('node_modules/@reader/source');
    await f.manager.install('npm:@reader/source');
    assert.equal((await f.registry.require('test.plugin', 'test').provider.detail(context(), 'book')).title, 'Book');
    await f.manager.close();
    const restarted = f.restart(); await restarted.loadInstalled();
    assert.equal(restarted.list().find(p => p.pluginId === 'test.plugin')?.folder, 'npm:@reader/source');
    for (const input of ['npm:../outside', 'npm:@reader/../../outside', 'npm:source@latest', 'npm:C:\\outside', 'npm:']) {
      await assert.rejects(restarted.install(input), { code: 'PLUGIN_INVALID_FOLDER' });
    }
    const outside = join(f.root, 'outside'); await mkdir(outside);
    await symlink(outside, join(f.dataDir, 'plugins', 'node_modules', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(restarted.install('npm:escape'), { code: 'PLUGIN_PATH_ESCAPE' });
  } finally { await f.dispose(); }
});

test('disable stops in-flight work, rejects retained providers, and persists across restart', async () => {
  const f = await fixture();
  try {
    await f.package();
    await f.manager.install('example');
    const provider = f.registry.require('test.plugin', 'test').provider;
    const pending = assert.rejects(provider.detail(context(), 'hang'), { code: 'PLUGIN_UNAVAILABLE' });
    const disabled = await f.manager.setEnabled('test.plugin', false);
    await pending;
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.runtime?.state, 'stopped');
    assert.equal(f.registry.get('test.plugin', 'test'), undefined);
    await assert.rejects(provider.detail(context(), 'book'), { code: 'PLUGIN_UNAVAILABLE' });
    await f.manager.close();
    const restarted = f.restart();
    await restarted.loadInstalled();
    assert.equal(restarted.list().find((plugin) => plugin.pluginId === 'test.plugin')?.enabled, false);
    assert.equal(f.registry.get('test.plugin', 'test'), undefined);
    await restarted.setEnabled('test.plugin', true);
    assert.equal((await f.registry.require('test.plugin', 'test').provider.detail(context(), 'book')).title, 'Book');
  } finally { await f.dispose(); }
});

test('enabled packages reload after shutdown and failed package loads do not block healthy packages', async () => {
  const f = await fixture();
  try {
    await f.package();
    await f.manager.install('example');
    f.db.run('INSERT INTO installed_plugins (plugin_id, folder, enabled) VALUES (?, ?, 1)', 'broken.plugin', 'missing');
    await f.manager.close();
    const restarted = f.restart();
    await restarted.loadInstalled();
    await restarted.loadInstalled();
    assert.ok(f.registry.get('test.plugin', 'test'));
    assert.equal(restarted.list().find((plugin) => plugin.pluginId === 'broken.plugin')?.error?.code, 'PLUGIN_PACKAGE_NOT_FOUND');
    assert.equal(f.registry.list().length, 2, 'reloading is idempotent');
    assert.equal((await f.registry.require('test.plugin', 'test').provider.detail(context(), 'book')).title, 'Book');
  } finally { await f.dispose(); }
});

test('a crashed worker remains isolated and can be reloaded through enable', async () => {
  const f = await fixture();
  try {
    await f.package();
    await f.package('healthy', 'healthy.plugin');
    await f.manager.install('example');
    await f.manager.install('healthy');
    await assert.rejects(f.registry.require('test.plugin', 'test').provider.detail(context(), 'crash'), { code: 'PLUGIN_UNAVAILABLE' });
    assert.equal(f.manager.list().find((plugin) => plugin.pluginId === 'test.plugin')?.runtime?.state, 'failed');
    assert.equal((await f.registry.require('healthy.plugin', 'test').provider.detail(context(), 'book')).title, 'Book');
    await f.manager.setEnabled('test.plugin', true);
    assert.equal((await f.registry.require('test.plugin', 'test').provider.detail(context(), 'book')).title, 'Book');
  } finally { await f.dispose(); }
});

test('uninstall retains package files and source data while removing registrations and install records', async () => {
  const f = await fixture();
  try {
    const directory = await f.package();
    await f.manager.install('example');
    f.db.run("INSERT INTO source_instances (id, plugin_id, source_type, name, config_json, enabled, created_at) VALUES ('keep', 'test.plugin', 'test', 'Keep', '{}', 1, 0)");
    f.db.run("INSERT INTO plugin_storage (key, value) VALUES ('keep', 'data')");
    await f.manager.uninstall('test.plugin');
    assert.equal(f.registry.get('test.plugin', 'test'), undefined);
    assert.equal(f.db.get('SELECT plugin_id FROM installed_plugins WHERE plugin_id = ?', 'test.plugin'), undefined);
    assert.ok(f.db.get("SELECT id FROM source_instances WHERE id = 'keep'"));
    assert.ok(f.db.get("SELECT key FROM plugin_storage WHERE key = 'keep'"));
    await access(join(directory, 'main.mjs'));
    await f.manager.install('example');
    assert.ok(f.registry.get('test.plugin', 'test'));
  } finally { await f.dispose(); }
});

test('builtins, duplicate installations and source conflicts cannot be replaced', async () => {
  const f = await fixture();
  try {
    await f.package();
    await f.package('builtin', 'reader.local');
    await assert.rejects(f.manager.install('builtin'), { code: 'BUILTIN_PLUGIN_IMMUTABLE' });
    await assert.rejects(f.manager.setEnabled('reader.local', false), { code: 'BUILTIN_PLUGIN_IMMUTABLE' });
    await assert.rejects(f.manager.uninstall('reader.local'), { code: 'BUILTIN_PLUGIN_IMMUTABLE' });
    f.registry.register({ pluginId: 'test.plugin', provider: builtin });
    await assert.rejects(f.manager.install('example'), { code: 'PLUGIN_SOURCE_CONFLICT' });
    assert.equal(f.db.all('SELECT plugin_id FROM installed_plugins').length, 0);
    f.registry.unregister('test.plugin', 'local');
    await f.manager.install('example');
    await assert.rejects(f.manager.install('example'), { code: 'PLUGIN_ALREADY_INSTALLED' });
    assert.equal(f.registry.require('reader.local', 'local').provider, builtin);
  } finally { await f.dispose(); }
});

test('invalid multi-source packages leave no partially registered providers or persisted installation', async () => {
  const f = await fixture();
  try {
    await f.package('invalid', 'invalid.plugin', [
      { id: 'valid', label: 'Valid', capabilities: ['detail'] },
      { id: 'unsupported-file', label: 'Unsupported file', capabilities: ['detail', 'acquire.file'] },
    ]);
    await assert.rejects(f.manager.install('invalid'), { code: 'PLUGIN_INCOMPATIBLE', statusCode: 400 });
    assert.equal(f.registry.list().length, 1);
    assert.equal(f.db.all('SELECT plugin_id FROM installed_plugins').length, 0);
  } finally { await f.dispose(); }
});

test('missing packages, invalid JSON and invalid manifests return stable client errors', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.manager.install('missing'), { code: 'PLUGIN_PACKAGE_NOT_FOUND', statusCode: 404 });
    const directory = await f.package();
    await writeFile(join(directory, 'plugin.json'), '{ invalid JSON');
    await assert.rejects(f.manager.install('example'), { code: 'PLUGIN_INVALID_MANIFEST', statusCode: 400 });
    await writeFile(join(directory, 'plugin.json'), JSON.stringify({ id: 'test.plugin' }));
    await assert.rejects(f.manager.install('example'), { code: 'PLUGIN_INVALID_MANIFEST', statusCode: 400 });
    await f.package();
    await rm(join(directory, 'main.mjs'));
    await assert.rejects(f.manager.install('example'), { code: 'PLUGIN_PACKAGE_NOT_FOUND', statusCode: 404 });
    assert.equal(f.db.all('SELECT plugin_id FROM installed_plugins').length, 0);
    assert.equal(f.registry.list().length, 1);
  } finally { await f.dispose(); }
});

test('install accepts only one package folder and rejects symlink escapes', async () => {
  const f = await fixture();
  try {
    const directory = await f.package();
    for (const folder of ['../example', './example', '/example', 'example/child', 'example\\child', '.', '', 'example.']) {
      await assert.rejects(f.manager.install(folder), { code: 'PLUGIN_INVALID_FOLDER' });
    }
    const outside = join(f.root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'plugin.json'), '{}');
    await symlink(outside, join(f.dataDir, 'plugins', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(f.manager.install('escape'), { code: 'PLUGIN_PATH_ESCAPE' });
    await access(join(directory, 'plugin.json'));
  } finally { await f.dispose(); }
});

test('changed package identity is refused on restart and lifecycle mutations remain ordered', async () => {
  const f = await fixture();
  try {
    await f.package();
    await f.manager.install('example');
    const disabled = f.manager.setEnabled('test.plugin', false);
    const enabled = f.manager.setEnabled('test.plugin', true);
    await Promise.all([disabled, enabled]);
    assert.equal(f.manager.list().find((plugin) => plugin.pluginId === 'test.plugin')?.enabled, true);
    assert.ok(f.registry.get('test.plugin', 'test'));
    await f.manager.close();
    await f.package('example', 'changed.plugin');
    const restarted = f.restart();
    await restarted.loadInstalled();
    assert.equal(restarted.list().find((plugin) => plugin.pluginId === 'test.plugin')?.error?.code, 'PLUGIN_ID_CHANGED');
    assert.equal(f.registry.get('changed.plugin', 'test'), undefined);
    await restarted.close();
    await assert.rejects(restarted.setEnabled('test.plugin', true), { code: 'PLUGIN_MANAGER_CLOSED' });
  } finally { await f.dispose(); }
});
