import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { Db } from '../src/db/index.ts';
import { PluginManager } from '../src/sources/plugin-manager.ts';
import { PluginInstaller } from '../src/sources/plugin-installer.ts';
import { SourceRegistry } from '../src/sources/registry.ts';
import { pluginArchive } from './helpers/plugin-package.ts';

async function fixture(t: import('node:test').TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'reader-plugin-install-'));
  const db = new Db(':memory:'), registry = new SourceRegistry();
  const manager = new PluginManager(db, root, registry);
  t.after(async () => { await manager.close(); db.close(); await rm(root, { recursive: true, force: true }); });
  return { root, db, registry, manager, installer: new PluginInstaller(root, manager) };
}

test('uploaded npm package is enabled, runnable and restored; scripts never run and duplicate installation preserves it', async t => {
  const f = await fixture(t);
  const archive = pluginArchive();
  const result = await f.installer.installArchive(target => writeFile(target, archive));
  assert.equal(result.enabled, true);
  assert.equal(result.pluginId, 'test.upload');
  const directories = await readdir(join(f.root, 'plugins'));
  const packageDir = join(f.root, 'plugins', directories[0]!, 'node_modules', '@reader', 'example');
  await assert.rejects(access(join(packageDir, 'lifecycle-ran')));
  await assert.rejects(access(join(f.root, 'plugins', directories[0]!, 'upload.tgz')));
  await assert.rejects(f.installer.installArchive(target => writeFile(target, archive)), { code: 'PLUGIN_ALREADY_INSTALLED' });
  assert.deepEqual(await readdir(join(f.root, 'plugins')), directories);
  await f.manager.close();
  const restored = new PluginManager(f.db, f.root, f.registry);
  try {
    await restored.loadInstalled();
    assert.equal(restored.list()[0]?.enabled, true);
    const provider = f.registry.get('test.upload', 'test')!.provider;
    const book = await provider.detail({ userId: 'u', signal: new AbortController().signal,
      instance: { id: 's', pluginId: 'test.upload', sourceType: 'test', name: 'Test', config: {}, enabled: true } }, 'book');
    assert.equal(book.title, 'Installed book');
  } finally { await restored.close(); }
});

test('invalid package and interrupted upload leave no installation behind', async t => {
  const f = await fixture(t);
  await assert.rejects(f.installer.installArchive(target => writeFile(target, pluginArchive('example', 'test.invalid', false))));
  await assert.rejects(f.installer.installArchive(async target => { await writeFile(target, 'partial'); throw new Error('disconnect'); }), /disconnect/);
  assert.deepEqual(await readdir(join(f.root, 'plugins')), []);
  assert.deepEqual(f.manager.list(), []);
});

test('uploading a new version upgrades the existing plugin and retains source configuration across restart', async t => {
  const f = await fixture(t);
  const old = await f.installer.installArchive(target => writeFile(target, pluginArchive()));
  f.db.run("INSERT INTO source_instances (id, plugin_id, source_type, name, config_json, enabled, created_at) VALUES ('keep', 'test.upload', 'test', 'Keep', '{\"custom\":true}', 1, 0)");
  f.db.run("INSERT INTO plugin_storage (key, value) VALUES ('keep', 'state')");
  const upgraded = await f.installer.installArchive(target => writeFile(target, pluginArchive(undefined, undefined, true, '1.1.0')));
  assert.equal(upgraded.version, '1.1.0');
  assert.equal(upgraded.enabled, true);
  assert.notEqual(upgraded.folder, old.folder);
  assert.equal(f.db.all('SELECT * FROM installed_plugins').length, 1);
  assert.equal(f.db.get<{ config_json: string }>("SELECT config_json FROM source_instances WHERE id = 'keep'")?.config_json, '{"custom":true}');
  assert.equal(f.db.get<{ value: string }>("SELECT value FROM plugin_storage WHERE key = 'keep'")?.value, 'state');
  await f.manager.close();
  const restored = new PluginManager(f.db, f.root, f.registry);
  try { await restored.loadInstalled(); assert.equal(restored.list()[0]?.version, '1.1.0'); }
  finally { await restored.close(); }
});

test('npm specs reject options, URLs, local paths and aliases before any npm call', async t => {
  const f = await fixture(t);
  for (const spec of ['--help', '../package', 'file:package.tgz', 'https://example.test/a.tgz', 'git+https://example.test/a', 'x@npm:other', 'x;whoami', '@scope/x/../y', 'x@latest --ignore-scripts=false']) {
    assert.throws(() => f.installer.installPackage(spec), { code: 'PLUGIN_INVALID_PACKAGE' });
  }
});

test('npm package install passes scoped name and version, serializes downloads and cleans failures', async t => {
  const f = await fixture(t);
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const installer = new PluginInstaller(f.root, f.manager, async (_directory, spec) => {
    assert.equal(spec, '@reader/example@1.2.3'); started(); await wait; throw new Error('network error');
  });
  const pending = installer.installPackage('@reader/example@1.2.3');
  const failure = assert.rejects(pending, /network error/);
  await ready;
  await assert.rejects(installer.installPackage('other'), { code: 'PLUGIN_INSTALL_BUSY' });
  release(); await failure;
  assert.deepEqual(await readdir(join(f.root, 'plugins')), []);
});

test('plugin root cannot point outside DATA_DIR', async t => {
  const f = await fixture(t), outside = await mkdtemp(join(tmpdir(), 'reader-plugin-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(f.root, 'plugins'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.installer.installArchive(async () => {}), { code: 'PLUGIN_PATH_ESCAPE' });
  assert.deepEqual(await readdir(outside), []);
});

test('npm name installs through a registry and auto-enables the downloaded scoped package', async t => {
  const f = await fixture(t);
  let version = '1.0.0';
  let registryUrl = '';
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url!);
    if (request.url === '/example.tgz') { response.end(pluginArchive(undefined, undefined, true, version)); return; }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ name: '@reader/example', 'dist-tags': { latest: version }, versions: {
      [version]: { name: '@reader/example', version, dist: { tarball: registryUrl + '/example.tgz' } },
    } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  registryUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const previous = process.env.npm_config_registry;
  process.env.npm_config_registry = registryUrl;
  try {
    const result = await f.installer.installPackage('@reader/example@latest');
    assert.equal(result.enabled, true);
    assert.equal(result.pluginId, 'test.upload');
    assert.ok(requests.includes('/example.tgz'));
    version = '1.1.0';
    const updated = await f.installer.installPackage('@reader/example@latest');
    assert.equal(updated.version, version); assert.equal(updated.updated, true);
    assert.equal(f.manager.list().length, 1);
  } finally {
    if (previous === undefined) delete process.env.npm_config_registry; else process.env.npm_config_registry = previous;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
