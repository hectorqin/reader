import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import JSZip from 'jszip';
import { verifyBackup } from './backup.ts';

export interface WebDavOptions {
  url: string;
  username: string;
  password: string;
  name: string;
  maxBytes?: number;
  signal?: AbortSignal;
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** Publish an immutable, verified backup ZIP to an existing WebDAV collection. */
export async function uploadBackup(directory: string, options: WebDavOptions) {
  const base = new URL(options.url);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(base.hostname))) {
    throw new Error('WebDAV 必须使用 HTTPS（本机测试可用 HTTP）');
  }
  if (base.username || base.password || base.search || base.hash) throw new Error('WebDAV URL 不得包含凭据、查询或片段');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\.zip$/.test(options.name)) throw new Error('备份名称必须是安全的 .zip 文件名');
  if (options.username.includes(':') || !options.username || !options.password) throw new Error('需要有效的 WebDAV 账号和密码');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const limit = options.maxBytes ?? 2 * 1024 ** 3;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 4 * 1024 ** 3 - 1) throw new Error('备份上限必须介于 1 字节与 4 GiB 之间');
  const manifest = await verifyBackup(directory);
  if (manifest.entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0) > limit) throw new Error('备份超过配置大小上限');
  if (manifest.entries.length > 60000) throw new Error('备份文件过多，超出 ZIP32 支持范围');
  const scratch = await mkdtemp(join(tmpdir(), 'reader-webdav-'));
  const archive = join(scratch, 'backup.zip');
  const destination = new URL(options.name, base), temporary = new URL('.reader-upload-' + randomUUID() + '.zip', base);
  const authorization = 'Basic ' + Buffer.from(options.username + ':' + options.password).toString('base64');
  const request = (url: URL, init: RequestInit = {}) => fetch(url, {
    ...init, redirect: 'manual', headers: { authorization, ...init.headers },
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
  });
  let staged = false;
  try {
    const zip = new JSZip();
    for (const entry of manifest.entries) {
      options.signal?.throwIfAborted();
      if (entry.kind === 'directory') zip.folder(entry.path);
      else if (entry.kind === 'link') zip.file(entry.path, entry.target!, { unixPermissions: 0o120777 });
      else zip.file(entry.path, createReadStream(join(directory, entry.path)), { unixPermissions: (await stat(join(directory, entry.path))).mode });
    }
    zip.file('reader-backup.json', await readFile(join(directory, 'reader-backup.json')), { unixPermissions: 0o100600 });
    await pipeline(zip.generateNodeStream({ streamFiles: true, platform: 'UNIX', compression: 'STORE' }), createWriteStream(archive, { flags: 'wx', mode: 0o600 }), ...(options.signal ? [{ signal: options.signal }] : []));
    await verifyBackup(directory);
    const size = (await stat(archive)).size;
    if (size > limit) throw new Error('打包后超过配置大小上限');
    const sha256 = await hashFile(archive);
    const existing = await request(destination, { method: 'HEAD' });
    await existing.body?.cancel();
    if (existing.status !== 404) throw new Error(existing.ok ? '远端同名备份已存在，不会覆盖' : `检查远端失败 HTTP ${existing.status}`);
    for (let attempt = 0; attempt < 3; attempt++) {
      options.signal?.throwIfAborted();
      staged = true;
      const input = createReadStream(archive);
      let response: Response;
      try {
        response = await request(temporary, { method: 'PUT', body: input, duplex: 'half', headers: { 'content-type': 'application/zip', 'content-length': String(size) } } as RequestInit);
      } catch {
        if (options.signal?.aborted) options.signal.throwIfAborted();
        if (attempt < 2) continue;
        throw new Error('WebDAV 上传连接失败，临时文件将尝试清理');
      } finally { input.destroy(); }
      await response.body?.cancel();
      if (response.ok) break;
      if (attempt === 2 || ![408, 429, 500, 502, 503, 504].includes(response.status)) throw new Error(`WebDAV 上传失败 HTTP ${response.status}`);
    }
    const uploaded = await request(temporary);
    if (!uploaded.ok || !uploaded.body) { await uploaded.body?.cancel(); throw new Error(`远端校验读取失败 HTTP ${uploaded.status}`); }
    const remoteHash = createHash('sha256'); let bytes = 0;
    for await (const chunk of uploaded.body) {
      bytes += chunk.byteLength;
      if (bytes > size) throw new Error('远端校验失败：长度不一致');
      remoteHash.update(chunk);
    }
    if (bytes !== size || remoteHash.digest('hex') !== sha256) throw new Error('远端校验失败：内容不一致');
    const moved = await request(temporary, { method: 'MOVE', headers: { destination: destination.href, overwrite: 'F' } });
    await moved.body?.cancel();
    if (moved.status !== 201) throw new Error(`WebDAV 发布失败 HTTP ${moved.status}；请核对远端，未自动重试 MOVE`);
    staged = false;
    return { name: options.name, bytes: size, sha256 };
  } finally {
    if (staged) {
      await fetch(temporary, { method: 'DELETE', headers: { authorization }, redirect: 'manual', signal: AbortSignal.timeout(10_000) })
        .then(response => response.body?.cancel()).catch(() => {});
    }
    const cleanupPath = relative(resolve(tmpdir()), resolve(scratch));
    if (!cleanupPath || isAbsolute(cleanupPath) || cleanupPath.startsWith('..')) throw new Error('Unsafe cleanup path');
    await rm(scratch, { recursive: true, force: true });
  }
}
