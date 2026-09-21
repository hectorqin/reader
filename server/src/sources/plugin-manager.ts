import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Db } from '../db/index.ts';
import { AppError } from '../lib/errors.ts';
import { ProcessPlugin } from './process-plugin.ts';
import { SourceRegistry, SourceRegistryError } from './registry.ts';
import type { PluginRuntimeStatus, SourceDescriptor, SourceProvider } from './types.ts';

interface InstalledPlugin { plugin_id: string; folder: string; enabled: number }
interface ManagedPlugin {
  plugin?: ProcessPlugin;
  providers: readonly SourceProvider[];
  active: boolean;
  error?: { code: string; message: string };
}

export interface PluginInfo {
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

  constructor(private readonly db: Db, private readonly dataDir: string, private readonly registry: SourceRegistry) {}

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

  install(folder: string): Promise<PluginInfo> {
    return this.enqueue(async () => {
      const plugin = await this.loadPackage(folder);
      let managed: ManagedPlugin | undefined;
      try {
        this.assertExternal(plugin.manifest.id);
        if (this.rows().some((row) => row.plugin_id === plugin.manifest.id || row.folder === folder)) {
          throw pluginError(409, 'PLUGIN_ALREADY_INSTALLED', 'This plugin id or package folder is already installed');
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
      const outcomes = await Promise.allSettled([...this.managed.values()].map((managed) => this.stop(managed)));
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
    try { return await ProcessPlugin.load(await this.packageDirectory(folder)); }
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

  private prepare(plugin: ProcessPlugin): ManagedPlugin {
    if (this.registry.list().some((registration) => registration.pluginId === plugin.manifest.id)) {
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
