import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, readlink, realpath, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MANIFEST = 'reader-backup.json';
const INCOMPLETE = '.reader-backup-incomplete';
interface Entry { path: string; kind: 'file' | 'directory' | 'link'; size?: number; sha256?: string; target?: string }
export interface BackupManifest { format: 'reader-data-backup'; version: 1; createdAt: string; entries: Entry[] }

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

async function digest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function inventory(root: string, rel = ''): Promise<Entry[]> {
  const entries: Entry[] = [];
  for (const name of (await readdir(join(root, rel))).sort()) {
    // SQLite rebuilds shared memory from the database/WAL. Reader locks in this
    // file can change even during a read-only integrity check.
    if (!rel && (name === MANIFEST || name === INCOMPLETE || name === 'reader.db-shm')) continue;
    const path = rel ? `${rel}/${name}` : name;
    const absolute = join(root, path);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) {
      const target = await readlink(absolute);
      if (isAbsolute(target) || !inside(root, resolve(dirname(absolute), target)) || !inside(root, await realpath(absolute))) {
        throw new Error(`不支持指向数据目录外的符号链接：${path}`);
      }
      entries.push({ path, kind: 'link', target });
    } else if (stat.isDirectory()) {
      entries.push({ path, kind: 'directory' });
      entries.push(...await inventory(root, path));
    } else if (stat.isFile()) {
      entries.push({ path, kind: 'file', size: stat.size, sha256: await digest(absolute) });
    } else {
      throw new Error(`数据目录包含不支持的文件类型：${path}`);
    }
  }
  return entries;
}

function checkDatabase(root: string): void {
  // Read the existing schema without running migrations or creating a database.
  const db = new DatabaseSync(join(root, 'reader.db'), { readOnly: true });
  try {
    const rows = db.prepare('PRAGMA integrity_check').all();
    if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') throw new Error('SQLite 完整性校验失败');
    if (db.prepare('PRAGMA foreign_key_check').get()) throw new Error('SQLite 外键完整性校验失败');
    for (const table of ['users', 'books', 'reading_progress', 'notes']) {
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
        throw new Error(`不是当前 reader 数据库：缺少 ${table}`);
      }
    }
  } finally { db.close(); }
}

async function newDestination(source: string, destination: string): Promise<string> {
  const parent = await realpath(dirname(resolve(destination)));
  const target = join(parent, relative(dirname(resolve(destination)), resolve(destination)));
  if (inside(source, target) || inside(target, source)) throw new Error('备份/恢复目录不能与源目录重叠');
  // Exclusive creation: never merge into or overwrite existing user data.
  await mkdir(target, { mode: 0o700 });
  await writeFile(join(target, INCOMPLETE), '操作未完成，请勿用此目录启动服务。\n', { flag: 'wx', mode: 0o600 });
  return target;
}

async function copyEntries(source: string, target: string, entries: Entry[]): Promise<void> {
  for (const entry of entries) {
    const from = join(source, entry.path), to = join(target, entry.path);
    if (entry.kind === 'directory') await mkdir(to, { mode: 0o700 });
    else if (entry.kind === 'file') {
      await copyFile(from, to);
      // Preserve plugin executables without making credentials world-readable.
      await chmod(to, (await lstat(from)).mode & 0o700);
    }
  }
  // Create links last, after all their targets, and never traverse them while copying.
  for (const entry of entries.filter(value => value.kind === 'link')) {
    await symlink(entry.target!, join(target, entry.path), 'file');
  }
}

/** Offline only: stop every server/plugin process using DATA_DIR before calling. */
export async function createBackup(dataDir: string, destination: string): Promise<BackupManifest> {
  const source = await realpath(dataDir);
  if ((await readdir(source)).some(name => name === INCOMPLETE || name === MANIFEST)) {
    throw new Error('源目录是备份或未完成操作目录，不能作为运行数据目录备份');
  }
  checkDatabase(source);
  const entries = await inventory(source);
  const target = await newDestination(source, destination);
  await copyEntries(source, target, entries);
  if (JSON.stringify(await inventory(source)) !== JSON.stringify(entries) ||
      JSON.stringify(await inventory(target)) !== JSON.stringify(entries)) {
    throw new Error('复制期间数据发生变化或校验失败；请停止服务后重新备份到新目录');
  }
  checkDatabase(target);
  const manifest: BackupManifest = { format: 'reader-data-backup', version: 1, createdAt: new Date().toISOString(), entries };
  await writeFile(join(target, MANIFEST), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  await unlink(join(target, INCOMPLETE));
  return manifest;
}

export async function verifyBackup(directory: string): Promise<BackupManifest> {
  const source = await realpath(directory);
  if ((await readdir(source)).includes(INCOMPLETE)) throw new Error('备份未完成，拒绝恢复');
  const manifest = JSON.parse(await readFile(join(source, MANIFEST), 'utf8')) as BackupManifest;
  if (manifest.format !== 'reader-data-backup' || manifest.version !== 1 || !Array.isArray(manifest.entries)) {
    throw new Error('不支持的备份格式');
  }
  // Rebuild from actual files, not manifest paths: a modified manifest cannot
  // instruct restore to write outside the new data directory.
  if (JSON.stringify(await inventory(source)) !== JSON.stringify(manifest.entries)) {
    throw new Error('备份文件校验失败：文件缺失、多余或内容已改变');
  }
  checkDatabase(source);
  return manifest;
}

/** Restore to a new directory; switching the deployed DATA_DIR remains explicit. */
export async function restoreBackup(directory: string, destination: string): Promise<BackupManifest> {
  const source = await realpath(directory);
  const manifest = await verifyBackup(source);
  const target = await newDestination(source, destination);
  await copyEntries(source, target, manifest.entries);
  if (JSON.stringify(await inventory(target)) !== JSON.stringify(manifest.entries)) throw new Error('恢复后文件校验失败');
  checkDatabase(target);
  await unlink(join(target, INCOMPLETE));
  return manifest;
}
