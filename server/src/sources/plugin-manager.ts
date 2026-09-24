import { extensionPage, extensionValues, type PluginExtensions } from './extensions.ts';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Db } from '../db/index.ts';
import { AppError } from '../lib/errors.ts';
import { ProcessPlugin, type ProcessPluginOptions } from './process-plugin.ts';
import { SourceRegistry, SourceRegistryError } from './registry.ts';
import type { PluginRuntimeStatus, SourceDescriptor, SourceProvider, SourceInstance } from './types.ts';

interface InstanceRow { id: string; plugin_id: string; source_type: string; name: string; config_json: string; enabled: number }
interface InstalledPlugin { plugin_id: string; folder: string; enabled: number }
interface ManagedPlugin {
  plugin?: ProcessPlugin;
  providers: readonly SourceProvider[];
  active: boolean;
  error?: { code: string; message: string };
}

export interface PluginInfo {
  /** Only present on the response to a successful package replacement. */
  updated?: boolean;
  previousVersion?: string;
  extensions?: PluginExtensions;
  pluginId: string;
  folder?: string;
  builtin: boolean;
  enabled: boolean;
  name?: string;
  version?: string;
  sourceTypes: readonly SourceDescriptor[];
  runtime: PluginRuntimeStatus | null;
  error?: { code: string; message: string };
}

function pluginError(status: number, code: string, message: string): AppError {
  return new AppError(status, code, message);
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Installs trusted packages already present under DATA_DIR/plugins. All lifecycle
 * mutations are serialized; unloading removes providers before awaiting workers.
 */
export class PluginManager {
  private readonly managed = new Map<string, ManagedPlugin>();
  private pending: Promise<void> = Promise.resolve();
  private closed = false;
  private taskTimer?: ReturnType<typeof setInterval>;
  private taskRun?: Promise<void>;
  private readonly extensionBusy = new Set<string>();

  startTasks(): void {
    if (this.taskTimer || this.closed) return;
    this.taskTimer = setInterval(() => { void this.runTasks().catch(() => undefined); }, 60_000);
    this.taskTimer.unref(); void this.runTasks().catch(() => undefined);
  }

  runTasks(now = Date.now()): Promise<void> {
    if (this.taskRun) return this.taskRun;
    if (this.closed) return Promise.resolve();
    const work = async () => {
      for (const [id, managed] of this.managed) {
        const candidates = (managed.plugin?.manifest.extensions?.tasks ?? []).map(task => ({ task, sourceId: undefined as string | undefined }));
        for (const row of this.db.all<InstanceRow>('SELECT * FROM source_instances WHERE plugin_id = ? AND enabled = 1', id)) {
          const type = managed.plugin?.manifest.sourceTypes.find(type => type.id === row.source_type);
          candidates.push(...(type?.extensions?.tasks ?? []).map(task => ({ task, sourceId: row.id })));
        }
        for (const { task, sourceId } of candidates) {
          if (this.closed || !managed.active) break;
          const busyKey = sourceId ? JSON.stringify([id, sourceId]) : id;
          if (this.extensionBusy.has(busyKey)) continue;
          const key = sourceId ? 'source-task:' + JSON.stringify([id, sourceId, task.id]) : 'plugin-task:' + id + ':' + task.id;
          const instance = sourceId ? this.sourceInstance(sourceId) : undefined;
          if (sourceId && (!instance?.enabled || instance.pluginId !== id)) continue;
          const saved = this.db.get<{ value: string }>('SELECT value FROM plugin_storage WHERE key = ?', key);
          const previous = saved ? JSON.parse(saved.value) : { next: 0, failures: 0 };
          if (previous.next > now) continue;
          let failures = 0;
          this.extensionBusy.add(busyKey);
          try {
            if (managed.plugin!.status().state === 'failed') await managed.plugin!.close();
            if (!managed.active || this.closed) break;
            const current = sourceId ? this.sourceInstance(sourceId) : undefined;
            if (sourceId && (!current?.enabled || current.pluginId !== id)) continue;
            await managed.plugin!.invoke('extension.task', { taskId: task.id,
              ...(current ? { sourceType: current.sourceType, context: { instance: current, userId: '' } } : {}),
            });
          } catch { failures = previous.failures + 1; }
          finally { this.extensionBusy.delete(busyKey); }
          if (this.closed) break;
          const minutes = failures ? Math.min(1440, Math.max(task.intervalMinutes, 2 ** Math.min(failures, 10))) : task.intervalMinutes;
          this.db.run('INSERT INTO plugin_storage (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            key, JSON.stringify({ next: now + minutes * 60_000, failures, lastError: failures ? 'TASK_FAILED' : null }));
        }
      }
    };
    this.taskRun = work().finally(() => { this.taskRun = undefined; });
    return this.taskRun;
  }

  private sourceInstance(id: string): SourceInstance | undefined {
    const row = this.db.get<InstanceRow>('SELECT * FROM source_instances WHERE id = ?', id);
    return row ? { id: row.id, pluginId: row.plugin_id, sourceType: row.source_type, name: row.name,
      config: JSON.parse(row.config_json), enabled: row.enabled === 1 } : undefined;
  }

  async sourcePage(sourceId: string, pageId: string, userId: string, action?: string, values: unknown = {}) {
    const instance = this.sourceInstance(sourceId);
    if (!instance) throw pluginError(404, 'SOURCE_NOT_FOUND', 'Source instance is unavailable');
    return this.page(instance.pluginId, pageId, userId, action, values, instance);
  }

  async page(pluginId: string, pageId: string, userId: string, action?: string, values: unknown = {}, instance?: SourceInstance) {
    if (this.closed) throw pluginError(503, 'PLUGIN_UNAVAILABLE', 'Plugin manager is closed');
    const managed = this.managed.get(pluginId);
    if (!managed?.active || !managed.plugin) throw pluginError(404, 'PLUGIN_UNAVAILABLE', 'Plugin is unavailable');
    const extensions = instance ? managed.plugin.manifest.sourceTypes.find(type => type.id === instance.sourceType)?.extensions : managed.plugin.manifest.extensions;
    if (!extensions?.pages?.some(page => page.id === pageId)) throw pluginError(404, 'PAGE_NOT_FOUND', 'Plugin page is not declared');
    if (action !== undefined && !/^[a-z][a-z0-9._-]{0,63}$/.test(action)) throw pluginError(400, 'INVALID_ACTION', 'Invalid action');
    const input = extensionValues(values);
    const busyKey = instance ? JSON.stringify([pluginId, instance.id]) : pluginId;
    if (action && this.extensionBusy.has(busyKey)) throw pluginError(429, 'PLUGIN_BUSY', '插件正在更新，请稍后重试');
    if (action) this.extensionBusy.add(busyKey);
    try {
      return extensionPage(await managed.plugin.invoke(action ? 'extension.action' : 'extension.page', {
        pageId, userId, action, values: input,
        ...(instance ? { sourceType: instance.sourceType, context: { instance, userId } } : {}),
      }));
    } finally { if (action) this.extensionBusy.delete(busyKey); }
  }


  constructor(private readonly db: Db, private readonly dataDir: string, private readonly registry: SourceRegistry, private readonly onDiagnostic?: ProcessPluginOptions['onDiagnostic']) {}

  loadInstalled(): Promise<void> {
    return this.enqueue(async () => {
      for (const row of this.rows()) {
        if (row.enabled !== 1 || this.managed.get(row.plugin_id)?.active) continue;
        try {
          this.assertExternal(row.plugin_id);
          await this.activate(row);
        } catch (error) {
          // One bad package must not prevent the library or other plugins starting.
          this.managed.set(row.plugin_id, { active: false, providers: [], error: this.errorInfo(error) });
        }
      }
    });
  }

  install(folder: string, options: { replace?: boolean } = {}): Promise<PluginInfo> {
    return this.enqueue(async () => {
      const plugin = await this.loadPackage(folder);
      let managed: ManagedPlugin | undefined;
      try {
        this.assertExternal(plugin.manifest.id);
        const existing = this.rows().find(row => row.plugin_id === plugin.manifest.id || row.folder === folder);
        if (existing) {
          if (options.replace && existing.plugin_id === plugin.manifest.id && existing.folder !== folder) {
            return await this.replace(existing, folder, plugin);
          }
          throw pluginError(409, 'PLUGIN_ALREADY_INSTALLED', '此插件或安装目录已安装，请上传新版安装包或输入 npm 包名更新。');
        }
        managed = this.prepare(plugin);
        this.register(managed);
        this.db.run('INSERT INTO installed_plugins (plugin_id, folder, enabled) VALUES (?, ?, 1)', plugin.manifest.id, folder);
        this.managed.set(plugin.manifest.id, managed);
        return this.info({ plugin_id: plugin.manifest.id, folder, enabled: 1 });
      } catch (error) {
        if (managed) this.unregister(managed);
        await plugin.close();
        throw this.packageInputError(error);
      }
    });
  }

  /** Validate a separate dependency tree before switching the durable package pointer. */
  private async replace(row: InstalledPlugin, folder: string, plugin: ProcessPlugin): Promise<PluginInfo> {
    const previous = this.managed.get(row.plugin_id);
    let oldPlugin = previous?.plugin;
    if (!oldPlugin) {
      try { oldPlugin = await this.loadPackage(row.folder); }
      catch { /* A missing/broken old package can be repaired by uploading a valid replacement. */ }
    }
    try {
      if (oldPlugin?.manifest.version === plugin.manifest.version) {
        throw pluginError(409, 'PLUGIN_ALREADY_INSTALLED', `已安装此版本（${plugin.manifest.version}），无需重复安装。`);
      }
      const candidate = this.prepare(plugin, true);
      // Existing instances, including disabled ones, must remain usable after switching.
      for (const instance of this.db.all<InstanceRow>('SELECT * FROM source_instances WHERE plugin_id = ?', row.plugin_id)) {
        const provider = candidate.providers.find(provider => provider.descriptor.id === instance.source_type);
        const oldType = oldPlugin?.manifest.sourceTypes.find(type => type.id === instance.source_type);
        if (!provider || oldType?.capabilities.some(capability => !provider.descriptor.capabilities.includes(capability))) {
          throw pluginError(409, 'PLUGIN_UPDATE_INCOMPATIBLE', '新版插件缺少已有书源使用的类型或能力，已保留原版本。');
        }
        await provider.validateConfig?.(JSON.parse(instance.config_json));
      }
      // New work may have arrived during validation. Keep the current process intact
      // rather than interrupting a search, data write or reader during an update.
      if (previous?.plugin?.status().pendingRequests || [...this.extensionBusy].some(key => key === row.plugin_id || key.startsWith(JSON.stringify([row.plugin_id]).slice(0, -1) + ','))) {
        throw pluginError(409, 'PLUGIN_BUSY', '插件仍有操作正在执行，请停止搜索或等待操作完成后重试更新。');
      }
      const wasActive = previous?.active;
      if (previous) this.unregister(previous);
      try {
        this.register(candidate);
        this.db.run('UPDATE installed_plugins SET folder = ?, enabled = 1 WHERE plugin_id = ?', folder, row.plugin_id);
        this.managed.set(row.plugin_id, candidate);
      } catch (error) {
        this.unregister(candidate);
        if (previous) { previous.active = wasActive!; if (previous.active) this.register(previous); }
        throw error;
      }
      await previous?.plugin?.close();
      return { ...this.info({ ...row, folder, enabled: 1 }), updated: true, previousVersion: oldPlugin?.manifest.version };
    } finally {
      if (oldPlugin && oldPlugin !== previous?.plugin) await oldPlugin.close();
    }
  }

  setEnabled(pluginId: string, enabled: boolean): Promise<PluginInfo> {
    return this.enqueue(async () => {
      this.assertExternal(pluginId);
      const row = this.row(pluginId);
      const previous = this.managed.get(pluginId);
      if (!enabled) {
        this.db.run('UPDATE installed_plugins SET enabled = 0 WHERE plugin_id = ?', pluginId);
        if (previous) await this.stop(previous);
        return this.info({ ...row, enabled: 0 });
      }
      if (row.enabled === 1 && previous?.active && previous.plugin?.status().state !== 'failed') return this.info(row);
      if (previous) await this.stop(previous);
      try {
        await this.activate(row);
        this.db.run('UPDATE installed_plugins SET enabled = 1 WHERE plugin_id = ?', pluginId);
      } catch (error) {
        const failed = this.managed.get(pluginId);
        if (failed) await this.stop(failed);
        this.managed.set(pluginId, { active: false, providers: [], error: this.errorInfo(error) });
        throw error;
      }
      return this.info({ ...row, enabled: 1 });
    });
  }

  uninstall(pluginId: string): Promise<void> {
    return this.enqueue(async () => {
      this.assertExternal(pluginId);
      this.row(pluginId);
      this.db.run('DELETE FROM installed_plugins WHERE plugin_id = ?', pluginId);
      const managed = this.managed.get(pluginId);
      if (managed) await this.stop(managed);
      this.managed.delete(pluginId);
      // Package files, source instances, credentials and reading state are retained.
    });
  }

  list(): PluginInfo[] {
    const builtins = new Map<string, PluginInfo>();
    for (const registration of this.registry.list()) {
      if (!registration.builtin) continue;
      const item = builtins.get(registration.pluginId) ?? {
        pluginId: registration.pluginId, builtin: true, enabled: true,
        name: registration.provider.descriptor.label, version: registration.provider.descriptor.version,
        sourceTypes: [], runtime: null,
      };
      item.sourceTypes = [...item.sourceTypes, registration.provider.descriptor];
      builtins.set(registration.pluginId, item);
    }
    return [...builtins.values(), ...this.rows().filter((row) => !builtins.has(row.plugin_id)).map((row) => this.info(row))];
  }

  close(): Promise<void> {
    return this.enqueue(async () => {
      if (this.closed) return;
      this.closed = true;
      clearInterval(this.taskTimer);
      const outcomes = await Promise.allSettled([...this.managed.values()].map((managed) => this.stop(managed)));
      await this.taskRun;
      const failure = outcomes.find((outcome) => outcome.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    }, true);
  }

  private enqueue<T>(action: () => Promise<T>, allowClosed = false): Promise<T> {
    const work = this.pending.then(() => {
      if (this.closed && !allowClosed) throw pluginError(503, 'PLUGIN_MANAGER_CLOSED', 'Plugin manager is closed');
      return action();
    });
    this.pending = work.then(() => {}, () => {});
    return work;
  }

  private rows(): InstalledPlugin[] {
    return this.db.all<InstalledPlugin>('SELECT plugin_id, folder, enabled FROM installed_plugins ORDER BY plugin_id');
  }

  private row(pluginId: string): InstalledPlugin {
    const row = this.db.get<InstalledPlugin>('SELECT plugin_id, folder, enabled FROM installed_plugins WHERE plugin_id = ?', pluginId);
    if (!row) throw pluginError(404, 'PLUGIN_NOT_FOUND', 'Plugin is not installed');
    return row;
  }

  private assertExternal(pluginId: string): void {
    if (this.registry.list().some((registration) => registration.pluginId === pluginId && registration.builtin)) {
      throw pluginError(400, 'BUILTIN_PLUGIN_IMMUTABLE', 'Built-in source providers cannot be replaced, disabled or uninstalled');
    }
  }

  private async packageDirectory(folder: string): Promise<string> {
    const installed = /^installed:([a-f0-9-]{36}):((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)$/.exec(folder);
    if (installed) {
      const data = await realpath(this.dataDir);
      const root = await realpath(join(data, 'plugins'));
      const workspace = await realpath(join(root, installed[1]!));
      const directory = await realpath(join(workspace, 'node_modules', installed[2]!));
      const manifest = await realpath(join(directory, 'plugin.json'));
      if (!inside(data, root) || !inside(root, workspace) || !inside(workspace, directory) || !inside(directory, manifest)) {
        throw pluginError(400, 'PLUGIN_PATH_ESCAPE', 'Installed package must remain within DATA_DIR/plugins');
      }
      return directory;
    }
    const npmName = typeof folder === 'string' && folder.startsWith('npm:') ? folder.slice(4) : undefined;
    if (npmName !== undefined ? !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(npmName) || npmName.length > 214
      : typeof folder !== 'string' || !/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,126}[a-zA-Z0-9_-])?$/.test(folder)) {
      throw pluginError(400, 'PLUGIN_INVALID_FOLDER', 'Use a single directory name or npm:package-name');
    }
    const data = await realpath(this.dataDir);
    const root = await realpath(resolve(data, 'plugins'));
    if (!inside(data, root)) throw pluginError(400, 'PLUGIN_PATH_ESCAPE', 'Plugin root must remain within DATA_DIR');
    const packageRoot = npmName === undefined ? root : await realpath(join(root, 'node_modules'));
    if (npmName !== undefined && !inside(root, packageRoot)) throw pluginError(400, 'PLUGIN_PATH_ESCAPE', 'npm packages must remain within DATA_DIR/plugins');
    const directory = await realpath(join(packageRoot, npmName ?? folder));
    if (!inside(packageRoot, directory)) throw pluginError(400, 'PLUGIN_PATH_ESCAPE', 'Plugin must remain within its package root');
    if (!inside(root, directory)) throw pluginError(400, 'PLUGIN_PATH_ESCAPE', 'Plugin package must remain within DATA_DIR/plugins');
    const manifest = await realpath(join(directory, 'plugin.json'));
    if (!inside(directory, manifest)) {
      throw pluginError(400, 'PLUGIN_PATH_ESCAPE', 'Plugin package must remain within DATA_DIR/plugins');
    }
    if (!(await stat(directory)).isDirectory()) throw pluginError(400, 'PLUGIN_INVALID_FOLDER', 'Plugin package must be a directory');
    return directory;
  }

  private async loadPackage(folder: string): Promise<ProcessPlugin> {
    try { return await ProcessPlugin.load(await this.packageDirectory(folder), { dataRoot: join(this.dataDir, 'plugin-data'), onDiagnostic: this.onDiagnostic }); }
    catch (error) { throw this.packageInputError(error); }
  }

  private packageInputError(error: unknown): unknown {
    if (error instanceof AppError) {
      if (error.code === 'PLUGIN_INVALID' || error.code === 'PLUGIN_INCOMPATIBLE') {
        return pluginError(400, error.code, error.message);
      }
      return error;
    }
    if (error instanceof SyntaxError) return pluginError(400, 'PLUGIN_INVALID_MANIFEST', 'Plugin manifest must contain valid JSON');
    if (error instanceof SourceRegistryError) return pluginError(400, 'PLUGIN_INVALID_MANIFEST', error.message);
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') return pluginError(404, 'PLUGIN_PACKAGE_NOT_FOUND', 'Plugin folder, manifest or entry file does not exist');
    if (code === 'ENOTDIR' || code === 'EISDIR') return pluginError(400, 'PLUGIN_INVALID_PACKAGE', 'Plugin package must contain a manifest and an executable entry file');
    if (code === 'EACCES' || code === 'EPERM') return pluginError(403, 'PLUGIN_PACKAGE_UNREADABLE', 'The server cannot read this plugin package');
    if (code === 'ELOOP') return pluginError(400, 'PLUGIN_PATH_ESCAPE', 'Plugin package contains a symbolic link loop');
    return error;
  }

  private prepare(plugin: ProcessPlugin, replacing = false): ManagedPlugin {
    if (!replacing && this.registry.list().some((registration) => registration.pluginId === plugin.manifest.id)) {
      throw pluginError(409, 'PLUGIN_SOURCE_CONFLICT', 'The plugin already owns a registered source type');
    }
    const managed: ManagedPlugin = { plugin, providers: [], active: true };
    managed.providers = plugin.providers().map((provider) => new Proxy(provider, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver) as unknown;
        if (typeof value !== 'function') return value;
        return async (...args: unknown[]) => {
          // Existing callers may retain providers after registry removal. Do not
          // let those references restart a worker after disable or uninstall.
          if (!managed.active) throw pluginError(503, 'PLUGIN_UNAVAILABLE', 'Plugin is disabled or uninstalled');
          return value.apply(target, args);
        };
      },
    }));
    const validation = new SourceRegistry();
    for (const provider of managed.providers) validation.registerPluginManifest(plugin.manifest, provider);
    return managed;
  }

  private register(managed: ManagedPlugin): void {
    for (const provider of managed.providers) this.registry.registerPluginManifest(managed.plugin!.manifest, provider);
  }

  private unregister(managed: ManagedPlugin): void {
    managed.active = false;
    for (const provider of managed.providers) {
      const pluginId = managed.plugin!.manifest.id;
      if (this.registry.get(pluginId, provider.descriptor.id)?.provider === provider) {
        this.registry.unregister(pluginId, provider.descriptor.id);
      }
    }
  }

  private async stop(managed: ManagedPlugin): Promise<void> {
    this.unregister(managed);
    await managed.plugin?.close();
  }

  private async activate(row: InstalledPlugin): Promise<void> {
    const plugin = await this.loadPackage(row.folder);
    let managed: ManagedPlugin | undefined;
    try {
      if (plugin.manifest.id !== row.plugin_id) throw pluginError(409, 'PLUGIN_ID_CHANGED', 'Installed package plugin id no longer matches its installation record');
      managed = this.prepare(plugin);
      this.register(managed);
      this.managed.set(row.plugin_id, managed);
    } catch (error) {
      if (managed) this.unregister(managed);
      await plugin.close();
      throw this.packageInputError(error);
    }
  }

  private info(row: InstalledPlugin): PluginInfo {
    const managed = this.managed.get(row.plugin_id);
    return {
      pluginId: row.plugin_id, folder: row.folder, builtin: false, enabled: row.enabled === 1,
      extensions: managed?.plugin?.manifest.extensions,
      name: managed?.plugin?.manifest.name, version: managed?.plugin?.manifest.version,
      sourceTypes: managed?.providers.map((provider) => provider.descriptor) ?? [],
      runtime: managed?.plugin?.status() ?? null, error: managed?.error,
    };
  }

  private errorInfo(error: unknown): { code: string; message: string } {
    return error instanceof AppError
      ? { code: error.code, message: error.message }
      : { code: 'PLUGIN_LOAD_FAILED', message: error instanceof Error ? error.message : 'Plugin failed to load' };
  }
}
