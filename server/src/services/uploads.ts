import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { Db } from '../db/index.ts';
import type { AppConfig } from '../config/index.ts';
import type { BrowseService } from './browse.ts';
import { resolveInside } from '../lib/paths.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { ZipArchive, ZipError } from '../indexer/formats/zip-reader.ts';
import type { Scanner, ScanResult } from '../indexer/scanner.ts';

/**
 * Uploading books into the library. BOOKS_DIR may be mounted read-only for a
 * browse-only deployment or writable for administrator file management. When
 * writable, uploads stage incoming bytes in DATA_DIR before moving them into
 * BOOKS_DIR. Placement uses rename on one filesystem or copy/unlink across
 * filesystems; the latter is not atomic.
 *
 *  1. **Nothing is written to the library until its bytes are complete.** The
 *     stream goes to a scratch file in `DATA_DIR/uploads`, which is the
 *     server's own writable space, and only a finished file is moved into
 *     `BOOKS_DIR` (with a cross-filesystem copy fallback). An interrupted incoming
 *     stream therefore does not write an incomplete download to BOOKS_DIR.
 *  2. **The name is not the path.** A client sends a file name, never a path:
 *     slashes, `..`, control characters and the leading dots that would hide a
 *     file from the scanner are all rewritten or refused. `resolveInside` is
 *     still applied, because that is the boundary and it does not get to have
 *     exceptions.
 *  3. **The library is left indexed, not just written.** A file that is on disk
 *     but not in the index is the exact state the file-manager screen exists to
 *     explain, so an upload finishes with an incremental scan of the paths it
 *     touched rather than waiting for the scheduler.
 */

/** How deep an imported archive's directory tree may be. */
const MAX_ARCHIVE_DEPTH = 12;
/** How many entries one imported archive may contribute. */
const MAX_ARCHIVE_ENTRIES = 5000;
/**
 * Per-entry ceiling for an imported archive.
 *
 * A zip carried in over HTTP is untrusted input and the entry sizes in its
 * central directory are the *author's* claim, not a fact. Bounding each entry
 * keeps the scratch copy from growing past what the disk can take before the
 * import notices, and `read()` enforces the same bound while inflating.
 */
const MAX_ARCHIVE_ENTRY_BYTES = 4 * 1024 * 1024 * 1024;

/**
 * One part received but not yet placed.
 *
 * Exists because the destination directory and the conflict policy arrive as
 * form fields that a client is free to send after the file, so a part cannot be
 * placed while it is still being read. The bytes go to scratch — `DATA_DIR`,
 * never the library — and the decisions happen once the whole form is in hand.
 */
export interface StagedUpload {
  /** Scratch directory owned by this part, removed when the request ends. */
  dir: string;
  /** Where the bytes are being written. */
  stagedPath: string;
  /** Sanitised destination name. */
  name: string;
  /** Name exactly as the client sent it, so a report can name what the user saw. */
  originalName: string;
  stream: Readable;
  /** Byte count, filled in once the part has been written. */
  size?: number;
}

export interface UploadResultItem {
  /** Library-relative path the file now lives at. */
  path: string;
  originalName: string;
  /** Name after the conflict policy was applied; differs when a suffix was added. */
  name: string;
  size: number;
  /** `'file'` for the uploaded file itself, `'archive-entry'` for a zip member. */
  kind: 'file' | 'archive-entry';
  /** Book id once indexed. Absent when the file is not a format the server reads. */
  bookId?: string | undefined;
  title?: string | undefined;
}

export interface UploadResult {
  uploaded: UploadResultItem[];
  /** Files that were not stored, with the reason, rather than failing the batch. */
  skipped: Array<{ name: string; reason: string }>;
  scan: ScanResult;
}

export interface UploadInput {
  /** Original filename, exactly as the client sent it. */
  name: string;
  /** Bytes, streamed. Never buffered whole. */
  stream: Readable;
  /** Directory the client asked for. Validated here, not by the caller. */
  target: string;
  /**
   * What to do when the destination name is taken.
   *
   *  - `rename` (default): keep both, with `书名 (2).epub`.
   *  - `skip`: keep the one already on disk and report this one as skipped.
   *  - `overwrite`: replace it — the same path, so the index sees an in-place
   *    edit and the book keeps its identity.
   *  - `fail`: refuse the whole request with `409 DESTINATION_EXISTS`.
   */
  onConflict?: ConflictPolicy;
}

export type ConflictPolicy = 'rename' | 'skip' | 'overwrite' | 'fail';

const CONFLICT_POLICIES: readonly ConflictPolicy[] = ['rename', 'skip', 'overwrite', 'fail'];

export function parseConflictPolicy(value: unknown): ConflictPolicy {
  if (value === undefined || value === null || value === '') return 'rename';
  if (typeof value !== 'string' || !CONFLICT_POLICIES.includes(value as ConflictPolicy)) {
    throw badRequest(`onConflict must be one of ${CONFLICT_POLICIES.join(', ')}`, 'BAD_CONFLICT_POLICY');
  }
  return value as ConflictPolicy;
}

/**
 * Hard-linked rename refuses with `EXDEV` when the source and the destination are
 * different filesystems, which is the normal case here rather than an exotic one:
 * the scratch directory lives in `DATA_DIR` (a container's writable layer, a
 * different volume) and the library is a mount of its own.
 *
 * The fallback still behaves like a move: `copyFile` + `unlink` leaves no
 * scratch copy behind, and it is only reached after `rename` has already said
 * the two paths cannot share an inode. Cross-filesystem placement is not atomic;
 * readers may observe the destination while it is being copied.
 */
export async function moveIntoLibrary(
  source: string,
  destination: string,
  move: typeof rename = rename,
): Promise<void> {
  try {
    await move(source, destination);
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
  }
  // Different filesystems: copy the bytes, then drop the scratch original.
  await copyFile(source, destination);
  await unlink(source).catch(() => undefined);
}

export class UploadService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly browse: BrowseService,
    private readonly scanner: Scanner,
  ) {}

  /** `DATA_DIR/uploads`, created on demand. Never inside the library. */
  private scratchRoot(): string {
    return join(this.config.dataDir, 'uploads');
  }

  /**
   * Receives one part and parks it in scratch.
   *
   * The *only* thing that happens while a request body is being read. Every
   * decision — where it lands, what it is called, whether it is a zip — happens
   * afterwards, in `commit`, because those decisions depend on form fields that
   * may arrive after the file and on names that must all be validated before any
   * of them is honoured.
   */
  async stage(stream: Readable, filename: string): Promise<StagedUpload> {
    const name = sanitizeUploadName(filename);
    await mkdir(this.scratchRoot(), { recursive: true });
    const dir = await mkdtemp(join(this.scratchRoot(), 'up-'));
    return { dir, stagedPath: join(dir, 'part'), name, originalName: filename, stream };
  }

  /**
   * Writes a staged part's bytes, then places and indexes every staged file.
   *
   * Split from `stage` so the caller can drain the whole request first: a field
   * that names the destination directory may arrive after the file, and a client
   * that sends two files must not have the first one committed before the second
   * one has proved it can be received.
   */
  async receive(staged: StagedUpload): Promise<void> {
    await this.write(staged.stream, staged.stagedPath);
    staged.size = (await stat(staged.stagedPath)).size;
    if (staged.size === 0) throw badRequest('the uploaded file is empty', 'EMPTY_UPLOAD');
  }

  /**
   * Places everything staged so far, then indexes once.
   *
   * One scan for the whole request rather than one per file: a forty-volume
   * series is one library change, and running the scanner forty-one times would
   * make the last file's response depend on the queue of the first.
   *
   * A file whose *content* is unusable (an archive entry that cannot be
   * inflated, a name that is taken under `skip`) is reported in `skipped`,
   * because losing thirty-nine good volumes to one bad entry is the failure this
   * feature would be judged on. A request that is wrong — a destination outside
   * the library, a read-only mount — throws, and it throws before anything is
   * written into the library.
   */
  async commit(staged: StagedUpload[], target: string, policy: ConflictPolicy): Promise<UploadResult> {
    if (staged.length === 0) throw badRequest('no file was uploaded', 'NO_FILES');
    const resolved = this.resolveTarget(target);
    await this.guardWritable(resolved);

    // Everything that can be known without moving a byte is checked first.
    //
    // `fail` is a client saying "do not guess", and the only honest answer to a
    // batch is to apply none of it: a request that stores three of five files
    // and then refuses has left a library the user has to reason about, and no
    // response can describe it. Later policies (`rename`, `skip`) resolve
    // conflicts rather than refusing, so they never reach this check.
    if (policy === 'fail') await this.assertNoConflicts(staged, resolved);

    const uploaded: UploadResultItem[] = [];
    const skipped: Array<{ name: string; reason: string }> = [];
    const written: string[] = [];
    try {
      for (const item of staged) {
        if (isZipContainer(item.name)) {
          await this.importArchive(item.stagedPath, item.name, resolved, policy, uploaded, skipped, written);
        } else {
          const placed = await this.place(item.stagedPath, resolved, item.name, item.originalName, policy);
          if (placed) {
            uploaded.push(placed);
            written.push(placed.path);
          } else {
            skipped.push({ name: item.originalName, reason: '同名文件已存在' });
          }
        }
      }
      const scan = await this.scanner.scan();
      this.attachBookIds(uploaded);
      return { uploaded, skipped, scan };
    } catch (err) {
      // A failure partway through placing still has to leave nothing behind.
      // The library is the one place in this product where a half-finished
      // write is not recoverable by trying again, so the rollback is explicit
      // rather than left to the caller.
      await this.rollback(written);
      throw err;
    } finally {
      // The scratch copy holds one full copy of every byte received, so it goes
      // even when the request failed: a failed upload must cost the user nothing
      // but the attempt.
      await Promise.all(staged.map((item) => rm(item.dir, { recursive: true, force: true }).catch(() => undefined)));
    }
  }

  /**
   * Removes files this request wrote, deepest first.
   *
   * Only ever called when the request failed, so the cost of getting it slightly
   * wrong is confined to a failure path. Directories are left alone: the target
   * may have existed before, and a rollback that removed a directory the user
   * already had would be worse than the failure it was cleaning up.
   */
  private async rollback(paths: string[]): Promise<void> {
    for (const relPath of [...paths].reverse()) {
      const abs = resolveInside(this.config.booksDir, relPath);
      await rm(abs, { force: true }).catch(() => undefined);
    }
  }

  /**
   * Whether any staged file would land on a name that is already taken.
   *
   * Asked per member rather than per archive: an archive is not one destination,
   * and a client uploading `系列.zip` on top of an existing `系列/` deserves the
   * same answer as one uploading the files directly.
   */
  private async assertNoConflicts(staged: StagedUpload[], target: string): Promise<void> {
    for (const item of staged) {
      if (!isZipContainer(item.name)) {
        if (await this.existingName(target, item.name)) {
          throw conflict(`${target === '' ? '' : `${target}/`}${item.name} is already taken`, 'DESTINATION_EXISTS');
        }
        continue;
      }
      // An archive's destination names are only knowable by opening it, so the
      // check happens inside the import rather than here; the archive itself
      // being refused whole is `importArchive`'s job.
      await this.assertArchiveHasFreeNames(item.stagedPath, item.name, target);
    }
  }

  /** The archive's own names, checked against the library before anything moves. */
  private async assertArchiveHasFreeNames(stagedPath: string, archiveName: string, target: string): Promise<void> {
    let archive: ZipArchive;
    try {
      archive = await ZipArchive.open(stagedPath);
    } catch (err) {
      throw badRequest(
        `cannot read ${archiveName} as an archive: ${err instanceof Error ? err.message : String(err)}`,
        'INVALID_ARCHIVE',
      );
    }
    const entries = archive.files().filter((entry) => !entry.isDirectory);
    const firstSegments = segmentsOf(entries[0]?.name ?? '');
    const flattenDepth = firstSegments.length > 1 ? 1 : 0;
    for (const entry of entries) {
      const segments = sanitizeArchiveSegments(segmentsOf(entry.name));
      const relative = segments.slice(flattenDepth);
      if (relative.length === 0) continue;
      const subdir = relative.slice(0, -1).join('/');
      const dir = subdir === '' ? target : target === '' ? subdir : `${target}/${subdir}`;
      if (await this.existingName(dir, relative[relative.length - 1]!)) {
        throw conflict(`${entry.name} is already taken in the library`, 'DESTINATION_EXISTS');
      }
    }
  }

  /** Removes scratch copies without placing anything. Used when a request dies. */
  async discard(staged: StagedUpload[]): Promise<void> {
    await Promise.all(staged.map((item) => rm(item.dir, { recursive: true, force: true }).catch(() => undefined)));
  }

  /**
   * Store one uploaded file end to end: stage, receive, commit.
   *
   * Kept as one call for the in-process callers (and the tests) that have no
   * form fields to wait for.
   */
  async store(input: UploadInput): Promise<UploadResult> {
    const staged = await this.stage(input.stream, input.name);
    try {
      await this.receive(staged);
      return await this.commit([staged], input.target, input.onConflict ?? 'rename');
    } catch (err) {
      // `commit` cleans up once it has been entered; a failure before that
      // (an empty body, an unreadable stream) has to clean up here.
      await this.discard([staged]);
      throw err;
    }
  }

  /** Exposed for tests: no scratch directory may outlive a request. */
  scratchDirectory(): string {
    return this.scratchRoot();
  }

  // ---- destination rules ----

  private resolveTarget(input: string): string {
    if (input === '') return '';
    const rel = this.browse.assertDestination(input);
    // `..`, an absolute path and a trailing slash all resolve through the same
    // check the file-manager endpoints use; there is one boundary and this is
    // not a second implementation of it.
    return resolveInside(this.config.booksDir, rel) === this.config.booksDir ? '' : rel;
  }

  private async guardWritable(target: string): Promise<void> {
    const abs = resolveInside(this.config.booksDir, target);
    const info = await stat(abs).catch(() => null);
    if (!info) throw notFound('no such directory', 'DIR_NOT_FOUND');
    if (!info.isDirectory()) throw badRequest('target is not a directory', 'NOT_A_DIRECTORY');
    // The probe answers "can this mount be written at all", which is the only
    // question that produces a clean 403 on a `:ro` bind mount instead of an
    // `EROFS` from six layers down.
    if (!(await this.browse.writable(abs))) {
      throw forbidden(
        'the library mount is read-only; remount it without `:ro` to upload into it',
        'READ_ONLY_MOUNT',
      );
    }
  }

  /**
   * Move a finished file into the library under a free name.
   *
   * The incoming file is already staged in DATA_DIR. moveIntoLibrary uses an
   * atomic rename on the same filesystem and a copy fallback across mounts.
   *
   * `subdir` is how an archive member keeps the structure it arrived in. A comic
   * stored as `系列/第01卷/001.jpg` is a *directory book* to the scanner, and
   * flattening it would destroy exactly the layout that makes it readable — so
   * the directories are recreated and each member lands where the archive said it
   * belongs, bounded by the sanitised segment list the caller already built.
   */
  private async place(
    stagedPath: string,
    target: string,
    name: string,
    originalName: string,
    policy: ConflictPolicy,
    kind: 'file' | 'archive-entry' = 'file',
    subdir = '',
  ): Promise<UploadResultItem | null> {
    const dir = subdir === '' ? target : target === '' ? subdir : `${target}/${subdir}`;
    const existing = await this.existingName(dir, name);
    let finalName = name;

    if (existing) {
      if (policy === 'fail') {
        throw conflict(`${dir === '' ? '' : `${dir}/`}${name} is already taken`, 'DESTINATION_EXISTS');
      }
      if (policy === 'skip') return null;
      if (policy === 'rename') finalName = await this.freeName(dir, name);
    }

    const relPath = dir === '' ? finalName : `${dir}/${finalName}`;
    const abs = resolveInside(this.config.booksDir, relPath);
    await mkdir(dirname(abs), { recursive: true });
    await moveIntoLibrary(stagedPath, abs);
    const info = await stat(abs);
    return { path: relPath, originalName, name: finalName, size: info.size, kind };
  }

  /** The name already at `dir/name`, or `null`. Compared case-insensitively. */
  private async existingName(dir: string, name: string): Promise<string | null> {
    const abs = resolveInside(this.config.booksDir, dir === '' ? name : `${dir}/${name}`);
    const info = await stat(abs).catch(() => null);
    if (info) return name;
    // A case-insensitive filesystem (macOS, SMB shares) would make `三体.EPUB`
    // and `三体.epub` one file. Listing the directory rather than guessing at the
    // filesystem's rules keeps the answer the same as what the user will see.
    const entries = await readdir(resolveInside(this.config.booksDir, dir)).catch(() => []);
    const lower = name.toLowerCase();
    return entries.find((entry) => entry.toLowerCase() === lower) ?? null;
  }

  /** `三体.epub` -> `三体 (2).epub`, the first suffix that is free. */
  private async freeName(dir: string, name: string): Promise<string> {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${stem} (${index})${ext}`;
      if (!(await this.existingName(dir, candidate))) return candidate;
    }
    throw conflict('too many files with that name', 'DESTINATION_EXISTS');
  }

  // ---- transport ----

  /**
   * Stream the request body to a scratch file.
   *
   * Streamed rather than buffered because the thing being uploaded is routinely
   * a scanned PDF or a comic volume of several hundred megabytes, and holding
   * one in the server's heap would make "upload a book" an off switch for a
   * small NAS.
   */
  private async write(stream: Readable, destination: string): Promise<void> {
    await mkdir(dirname(destination), { recursive: true });
    try {
      await pipeline(stream, createWriteStream(destination));
    } catch (err) {
      // A part that fails to arrive in full is a client-side failure, not a
      // server error. The stream's own error is passed through unchanged when it
      // is not one of the shapes a broken connection takes, so a genuine server
      // fault is still a 500 rather than being dressed up as the client's.
      const code = (err as NodeJS.ErrnoException).code;
      if (
        code === 'ECONNRESET'
        || code === 'ERR_STREAM_PREMATURE_CLOSE'
        || code === 'EPIPE'
        || code === 'ERR_STREAM_DESTROYED'
        || !code
      ) {
        throw badRequest(
          `the upload was interrupted before it finished: ${err instanceof Error ? err.message : String(err)}`,
          'UPLOAD_INCOMPLETE',
        );
      }
      throw err;
    }
  }

  // ---- archives ----

  /**
   * Unpack a zip-like container into the target directory.
   *
   * The whole point of accepting a zip is a series that arrived as one file: a
   * folder of forty volumes is what a reader actually downloads, and asking them
   * to unpack it first and upload forty files, one at a time, over a phone, is
   * not a feature.
   *
   * What this deliberately does **not** do is trust anything inside the archive.
   * Every entry name is rebuilt from its own segments (`sanitizeUploadName` per
   * segment, depth bounded), so `../../etc/passwd` and an absolute path and a
   * name made of control characters all resolve to something inside the target
   * directory. That is a stronger guarantee than checking for `..`: it cannot be
   * defeated by an encoding the check did not anticipate.
   *
   * Only one book-ish level of nesting is flattened. Deeper trees are preserved,
   * because a comic stored as `系列/第01卷/001.jpg` is a *directory book* and
   * flattening it would destroy the very structure the scanner reads.
   */
  private async importArchive(
    stagedPath: string,
    archiveName: string,
    target: string,
    policy: ConflictPolicy,
    uploaded: UploadResultItem[],
    skipped: Array<{ name: string; reason: string }>,
    written: string[],
  ): Promise<void> {
    let archive: ZipArchive;
    try {
      archive = await ZipArchive.open(stagedPath);
    } catch (err) {
      throw badRequest(
        `cannot read ${archiveName} as an archive: ${err instanceof Error ? err.message : String(err)}`,
        'INVALID_ARCHIVE',
      );
    }

    const entries = archive.files().filter((entry) => !entry.isDirectory);
    if (entries.length === 0) throw badRequest(`${archiveName} contains no files`, 'EMPTY_ARCHIVE');
    if (entries.length > MAX_ARCHIVE_ENTRIES) {
      throw badRequest(`${archiveName} has too many entries (${entries.length})`, 'ARCHIVE_TOO_LARGE');
    }

    // The shallowest entry decides the flattening: a zip of one folder is the
    // normal shape and that folder is the series the user is uploading, while a
    // zip of loose files has nothing to flatten. Anything deeper keeps its
    // structure, because a nested tree is what a comic volume layout *is*.
    const firstSegments = segmentsOf(entries[0]!.name);
    const flattenDepth = firstSegments.length > 1 ? 1 : 0;

    const scratch = join(dirname(stagedPath), 'unpacked');
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      if (entry.uncompressedSize > MAX_ARCHIVE_ENTRY_BYTES) {
        skipped.push({ name: entry.name, reason: '压缩包内条目过大' });
        continue;
      }
      const segments = sanitizeArchiveSegments(segmentsOf(entry.name));
      if (segments.length === 0) continue;
      const relative = segments.slice(flattenDepth);
      if (relative.length === 0) continue;
      if (relative.length > MAX_ARCHIVE_DEPTH) {
        skipped.push({ name: entry.name, reason: '目录嵌套过深' });
        continue;
      }

      const destination = join(scratch, ...relative);
      try {
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, await archive.read(entry.name));
      } catch (err) {
        // One unreadable entry in a real-world archive is common (an encrypted
        // file, a method nobody uses). It must not lose the other thirty-nine.
        skipped.push({
          name: entry.name,
          reason: err instanceof ZipError ? `无法解压（${err.code}）` : '无法解压',
        });
        continue;
      }

      const leaf = relative[relative.length - 1]!;
      const subdir = relative.slice(0, -1).join('/');
      // The member lands in the directory it arrived in, and `place` reports the
      // path it really took — renaming within that directory when the name was
      // taken. Reporting `target/leaf` instead is what turned the second volume
      // of an archive into a file beside the first one.
      const item = await this.place(
        destination,
        target,
        leaf,
        entry.name,
        policy,
        'archive-entry',
        subdir,
      );
      if (!item) {
        skipped.push({ name: entry.name, reason: '同名文件已存在' });
        continue;
      }
      uploaded.push(item);
      written.push(item.path);
    }
  }

  /** Fills in `bookId`/`title` from the index after the scan has run. */
  private attachBookIds(items: UploadResultItem[]): void {
    for (const item of items) {
      const row = this.db.get<{ book_id: string; title: string }>(
        `SELECT f.book_id AS book_id, b.title AS title
         FROM book_files f JOIN books b ON b.id = f.book_id
         WHERE f.rel_path = ?`,
        item.path,
      );
      if (!row) continue;
      item.bookId = row.book_id;
      item.title = row.title;
    }
    // A directory book (a comic stored as a folder of images) is indexed under
    // the *folder*, so its members have no row of their own. Reporting the
    // nearest enclosing book is what makes "I uploaded 40 pages" answer with
    // something the reader can open instead of an empty result.
    //
    // Walked upwards rather than one level: an archive of `系列/第01卷/001.jpg`
    // is indexed under `系列`, and the page itself is two levels below it.
    for (const item of items) {
      if (item.bookId) continue;
      let dir = dirname(item.path);
      while (dir !== '.' && dir !== '' && dir !== '/') {
        const row = this.db.get<{ book_id: string; title: string }>(
          `SELECT f.book_id AS book_id, b.title AS title
           FROM book_files f JOIN books b ON b.id = f.book_id
           WHERE f.rel_path = ?`,
          dir,
        );
        if (row) {
          item.bookId = row.book_id;
          item.title = row.title;
          break;
        }
        dir = dirname(dir);
      }
    }
  }

}

// ---- name handling ----

const ZIP_CONTAINER_EXTENSIONS = new Set(['.zip', '.cbz']);

function isZipContainer(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return false;
  return ZIP_CONTAINER_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function segmentsOf(entryName: string): string[] {
  return entryName.replace(/\\/g, '/').split('/').filter((segment) => segment.length > 0);
}

/**
 * Reduce an archive entry name to safe segments, dropping rather than fixing.
 *
 * A segment that sanitizes down to `.` or `..` or to something starting with a
 * dot is dropped entirely: it only ever appears in a path that was trying to
 * walk out of the target or to hide itself from the scanner, and both of those
 * are reasons to leave it out rather than to find a legal spelling for it.
 */
function sanitizeArchiveSegments(segments: string[]): string[] {
  const out: string[] = [];
  for (const segment of segments) {
    // A `.`/`..` segment is only ever an attempt to walk out of the destination,
    // so the whole path is dropped rather than spelled differently.
    if (segment === '.' || segment === '..') return [];
    // A name that was absolute (`/包/书.txt`) or an SMB path (`C:\\x\\书.txt`)
    // keeps only its own part: it is a name for a file, and where the client
    // thought it lived is not something this side can honour.
    if (segment.endsWith(':')) return out.length > 1 ? out.slice(0, 1) : out;
    const clean = sanitizeSegment(segment);
    if (clean === '') return [];
    out.push(clean);
  }
  return out;
}

/**
 * A single file name that is safe to create inside the library.
 *
 * Not a blacklist of bad characters: the result is a name, not a path, so any
 * separator becomes `-` and anything unprintable or leading disappears. `.` and
 * `..` are refused outright — they are the two names that mean something to the
 * filesystem rather than being a name for a file.
 */
export function sanitizeUploadName(input: string): string {
  // Windows and SMB clients send a whole path in the filename field. Only the
  // leaf is meaningful, and taking `basename` first is what keeps `C:\x\三体.epub`
  // from becoming a name with a colon in it.
  const leaf = input.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
  const clean = sanitizeSegment(leaf);
  if (clean === '' || clean === '.' || clean === '..') {
    throw badRequest('the uploaded file needs a usable name', 'BAD_NAME');
  }
  return clean;
}

function sanitizeSegment(input: string): string {
  const stripped = input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\]/g, '-')
    .trim();
  // Trailing dots and spaces are invisible on Windows and get dropped by SMB, so
  // leaving them would make the file the user sees differ from the one indexed.
  const trimmed = stripped.replace(/[. ]+$/g, '');
  // A leading dot is not cosmetic: the scanner skips dot-prefixed entries by
  // design, so a book uploaded as `.三体.epub` would be on disk and absent from
  // the shelf forever. The dot is dropped rather than the name refused, because
  // the user did nothing wrong.
  return trimmed.replace(/^\.+/, '').slice(0, 255);
}

/** Exported for tests: the same split the archive import and the scanner use. */
export { segmentsOf };
