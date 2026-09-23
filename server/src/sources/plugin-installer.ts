import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { AppError } from '../lib/errors.ts';
import type { PluginInfo, PluginManager } from './plugin-manager.ts';

const exec = promisify(execFile);
export const PLUGIN_UPLOAD_LIMIT = 100 * 1024 * 1024;
export const npmPackageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 214 && npmPackageName.test(value);
}

/** Locate npm's JS entry point, including Windows, without passing input through a shell. */
async function npmCli(): Promise<string> {
  const bin = dirname(process.execPath);
  const candidates = [process.env.npm_execpath, join(bin, 'node_modules/npm/bin/npm-cli.js'),
    join(bin, '../lib/node_modules/npm/bin/npm-cli.js')];
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    candidates.push(join(directory, 'node_modules/npm/bin/npm-cli.js'));
    if (process.platform !== 'win32') {
      try { candidates.push(await realpath(join(directory, 'npm'))); } catch { /* Next PATH entry. */ }
    }
  }
  for (const candidate of candidates) {
    if (!candidate?.endsWith('npm-cli.js')) continue;
    try { await access(candidate); return candidate; } catch { /* Next installation. */ }
  }
  throw new AppError(503, 'NPM_UNAVAILABLE', '服务端未找到 npm，请安装包含 npm 的 Node.js 后重试。');
}

export async function runNpmInstall(directory: string, spec: string): Promise<void> {
  const cli = await npmCli();
  try {
    await exec(process.execPath, [cli, 'install', '--prefix', directory, '--ignore-scripts', '--omit=dev',
      '--no-audit', '--no-fund', '--package-lock=false', '--save-exact', '--fetch-retries=1', '--', spec], {
      cwd: directory, windowsHide: true, timeout: 300_000, maxBuffer: 1024 * 1024,
      env: { ...process.env, npm_config_cache: join(directory, '.npm-cache'), npm_config_update_notifier: 'false' },
    });
  } catch (error) {
    // npm output can contain registry credentials or private URLs. Return only known error codes.
    const failure = error as { stderr?: string; killed?: boolean };
    const code = /\b(E404|E401|E403|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EINTEGRITY|TAR_BAD_ARCHIVE)\b/.exec(failure.stderr ?? '')?.[1];
    throw new AppError(502, 'PLUGIN_INSTALL_FAILED', failure.killed
      ? '插件安装超时，请检查服务端网络后重试。'
      : `插件安装失败${code ? `（${code}）` : ''}，请检查包名、安装包和服务端 npm 仓库配置。`);
  }
}

/** Each install owns its dependency tree; a failed attempt cannot modify a running plugin. */
export class PluginInstaller {
  private busy = false;
  constructor(private readonly dataDir: string, private readonly manager: PluginManager,
    private readonly installNpm = runNpmInstall) {}

  installPackage(spec: string): Promise<PluginInfo> {
    const match = /^((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)(?:@([a-zA-Z0-9][a-zA-Z0-9._-]*))?$/.exec(spec);
    if (!match || !validName(match[1])) throw new AppError(400, 'PLUGIN_INVALID_PACKAGE', '请输入 npm 包名，可附带版本或标签；不支持 URL、本地路径或安装参数。');
    return this.install(async () => spec, match[1]);
  }

  installArchive(receive: (target: string) => Promise<void>): Promise<PluginInfo> {
    return this.install(async directory => {
      const target = join(directory, 'upload.tgz');
      await receive(target);
      return target;
    });
  }

  private async install(prepare: (directory: string) => Promise<string>, expectedName?: string): Promise<PluginInfo> {
    if (this.busy) throw new AppError(409, 'PLUGIN_INSTALL_BUSY', '已有插件正在安装，请完成后重试。');
    this.busy = true;
    let directory: string | undefined;
    let committed = false;
    try {
      const data = await realpath(this.dataDir);
      const rootPath = join(data, 'plugins');
      await mkdir(rootPath, { recursive: true });
      const root = await realpath(rootPath);
      const rel = relative(data, root);
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        throw new AppError(400, 'PLUGIN_PATH_ESCAPE', '插件安装目录必须位于 DATA_DIR 内。');
      }
      const id = randomUUID();
      directory = join(root, id);
      await mkdir(directory);
      await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, name: `reader-install-${id}`, version: '1.0.0' }));
      const spec = await prepare(directory);
      await this.installNpm(directory, spec);
      const installed = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      const names = Object.keys(installed.dependencies ?? {});
      const name = names[0];
      if (names.length !== 1 || !validName(name) || (expectedName && name !== expectedName)) {
        throw new AppError(400, 'PLUGIN_INVALID_PACKAGE', '安装包必须包含一个有效的 npm 插件。');
      }
      // Remove download artifacts before committing. Package files and dependency layout stay intact.
      await rm(join(directory, 'upload.tgz'), { force: true });
      await rm(join(directory, '.npm-cache'), { recursive: true, force: true });
      const plugin = await this.manager.install(`installed:${id}:${name}`, { replace: true });
      committed = true;
      return plugin;
    } finally {
      try { if (directory && !committed) await rm(directory, { recursive: true, force: true }); }
      finally { this.busy = false; }
    }
  }
}
