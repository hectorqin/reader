import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import JSZip from 'jszip';
import { Db } from '../src/db/index.ts';
import { FileAcquisitions } from '../src/sources/acquisitions.ts';
import type { SourceContext, SourceInstance, SourceProvider } from '../src/sources/types.ts';

function fixture(root: string): { db: Db; config: { dataDir: string }; context: SourceContext } {
  const db = new Db(join(root, 'reader.db'));
  db.run(
    `INSERT INTO users (id, username, display_name, password_hash, role, disabled, created_at, updated_at)
     VALUES ('u1', 'u1', '', 'x', 'member', 0, 0, 0)`,
  );
  db.run(
    `INSERT INTO source_instances (id, plugin_id, source_type, name, config_json, enabled, created_at)
     VALUES ('s1', 'demo', 'demo', 'Demo', '{}', 1, 0)`,
  );
  const instance: SourceInstance = {
    id: 's1', pluginId: 'demo', sourceType: 'demo', name: 'Demo', config: {}, enabled: true,
  };
  return { db, config: { dataDir: root }, context: { instance, userId: 'u1', signal: new AbortController().signal } };
}

function provider(body: Buffer | Readable, mediaType = 'text/plain'): SourceProvider {
  return {
    descriptor: { id: 'demo', label: 'Demo', version: '1', capabilities: ['detail', 'acquire.file'] },
    async detail() { return { ref: 'entry-1', title: 'Remote title', authors: ['Author'] }; },
    async acquire() { return { kind: 'file', acquisitionRef: 'file-1', mediaType, filename: 'remote.txt' }; },
    async openFile() { return { mediaType, data: Buffer.isBuffer(body) ? body : undefined, stream: Buffer.isBuffer(body) ? undefined : body }; },
  };
}

describe('FileAcquisitions', () => {
  test('downloads, parses, persists, and shelves a file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reader-acquisition-'));
    const { db, config, context } = fixture(root);
    try {
      const importer = new FileAcquisitions(db, config);
      const bytes = Buffer.from('第一章\nhello\n', 'utf8');
      const bookId = await importer.acquire(
        provider(bytes), context, { entryRef: 'entry-1', optionId: 'txt' },
        { kind: 'file', acquisitionRef: 'file-1', mediaType: 'text/plain', filename: 'remote.txt' },
        { ref: 'entry-1', title: 'Remote title', authors: ['Author'] },
      );
      const hash = createHash('sha256').update(bytes).digest('hex');
      const book = db.get<{ title: string; content_hash: string; source: string }>('SELECT title, content_hash, source FROM books WHERE id = ?', bookId);
      assert.deepEqual({ ...book }, { title: 'Remote title', content_hash: hash, source: 'provider:demo' });
      assert.equal(db.get('SELECT book_id FROM user_books WHERE user_id = ? AND book_id = ? AND hidden = 0', 'u1', bookId)?.book_id, bookId);
      const acquired = db.get<{ rel_path: string; size: number }>('SELECT rel_path, size FROM acquired_files WHERE book_id = ?', bookId);
      assert.equal(acquired?.size, bytes.byteLength);
      assert.deepEqual(await readFile(join(config.dataDir, acquired!.rel_path)), bytes);
      assert.equal(db.get('SELECT book_id FROM source_acquisitions WHERE source_id = ? AND user_id = ? AND entry_ref = ? AND option_id = ?', 's1', 'u1', 'entry-1', 'txt')?.book_id, bookId);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test('serial repeat reuses the committed file and does not create another copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reader-acquisition-'));
    const { db, config, context } = fixture(root);
    try {
      const importer = new FileAcquisitions(db, config);
      const body = Buffer.from('same bytes');
      const args = [provider(body), context, { entryRef: 'entry-1', optionId: '' },
        { kind: 'file', acquisitionRef: 'file-1', mediaType: 'text/plain', filename: 'same.txt' },
        { ref: 'entry-1', title: 'Same' }] as const;
      const first = await importer.acquire(...args);
      const second = await importer.acquire(...args);
      assert.equal(second, first);
      assert.equal((await readdir(join(root, 'acquired'))).length, 1);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects an oversized response and cleans temporary files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reader-acquisition-'));
    const { db, config, context } = fixture(root);
    try {
      const importer = new FileAcquisitions(db, config, { maxBytes: 4 });
      await assert.rejects(
        importer.acquire(
          provider(Buffer.from('12345')), context, { entryRef: 'large' },
          { kind: 'file', acquisitionRef: 'large', mediaType: 'text/plain' }, { ref: 'large', title: 'Large' },
        ),
        (error: unknown) => (error as { code?: string }).code === 'ACQUISITION_TOO_LARGE',
      );
      assert.equal((await readdir(join(root, 'acquired'))).length, 0);
      assert.equal(db.get('SELECT COUNT(*) AS n FROM books')?.n, 0);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test('cancellation after provider response leaves no acquired file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reader-acquisition-'));
    const { db, config, context: original } = fixture(root);
    try {
      const controller = new AbortController();
      const context = { ...original, signal: controller.signal };
      const source: SourceProvider = {
        ...provider(Buffer.from('cancel me')),
        async openFile() {
          controller.abort();
          return { mediaType: 'text/plain', stream: Readable.from([Buffer.from('cancel me')]) };
        },
      };
      const importer = new FileAcquisitions(db, config);
      await assert.rejects(importer.acquire(
        source, context, { entryRef: 'cancel' },
        { kind: 'file', acquisitionRef: 'cancel', mediaType: 'text/plain' }, { ref: 'cancel', title: 'Cancel' },
      ), { name: 'AbortError' });
      assert.equal((await readdir(join(root, 'acquired'))).length, 0);
      assert.equal(db.get('SELECT COUNT(*) AS n FROM books')?.n, 0);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test('concurrent requests for one acquisition download once and restore a hidden shelf entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reader-acquisition-'));
    const { db, config, context } = fixture(root);
    try {
      const importer = new FileAcquisitions(db, config);
      let calls = 0;
      const source = provider(Buffer.from('same bytes'));
      source.openFile = async () => {
        calls += 1;
        return { mediaType: 'text/plain', stream: Readable.from([Buffer.from('same bytes')]) };
      };
      const acquire = () => importer.acquire(source, context, { entryRef: 'same' },
        { kind: 'file', acquisitionRef: 'same', mediaType: 'text/plain' }, { ref: 'same', title: 'Same' });
      const [first, second] = await Promise.all([acquire(), acquire()]);
      assert.equal(first, second);
      assert.equal(calls, 1);
      db.run('UPDATE user_books SET hidden = 1 WHERE user_id = ? AND book_id = ?', context.userId, first);
      assert.equal(await acquire(), first);
      assert.equal(db.get('SELECT hidden FROM user_books WHERE user_id = ? AND book_id = ?', context.userId, first)?.hidden, 0);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test('concurrent sources with identical bytes share one file and preserve existing metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reader-acquisition-'));
    const { db, config, context } = fixture(root);
    try {
      const importer = new FileAcquisitions(db, config);
      const body = Buffer.from('the same publication');
      const acquire = (entryRef: string, title: string) => importer.acquire(
        provider(body), context, { entryRef }, { kind: 'file', acquisitionRef: entryRef, mediaType: 'text/plain' },
        { ref: entryRef, title },
      );
      const [first, second] = await Promise.all([acquire('first', 'First'), acquire('second', 'Second')]);
      assert.equal(first, second);
      assert.equal((await readdir(join(root, 'acquired'))).length, 1);
      assert.equal(db.get('SELECT COUNT(*) AS n FROM source_acquisitions')?.n, 2);
      db.run('UPDATE books SET title = ?, author = ?, source = ? WHERE id = ?', 'Edited title', 'Edited author', 'embedded', first);
      await acquire('third', 'Different catalog title');
      assert.deepEqual({ ...db.get('SELECT title, author, source FROM books WHERE id = ?', first) },
        { title: 'Edited title', author: 'Edited author', source: 'embedded' });
      assert.equal((await readdir(join(root, 'acquired'))).length, 1);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects HTML pretending to be a PDF without adding a book', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reader-acquisition-'));
    const { db, config, context } = fixture(root);
    try {
      const importer = new FileAcquisitions(db, config);
      await assert.rejects(importer.acquire(
        provider(Buffer.from('<html>login required</html>'), 'application/pdf'), context, { entryRef: 'pdf' },
        { kind: 'file', acquisitionRef: 'pdf', mediaType: 'application/pdf' }, { ref: 'pdf', title: 'PDF' },
      ), (error: unknown) => (error as { code?: string }).code === 'INVALID_RESOURCE');
      assert.equal((await readdir(join(root, 'acquired'))).length, 0);
      assert.equal(db.get('SELECT COUNT(*) AS n FROM books')?.n, 0);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test('a database failure rolls back rows and removes downloaded file and extracted cover', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reader-acquisition-'));
    const { db, config, context } = fixture(root);
    try {
      const zip = new JSZip();
      zip.file('mimetype', 'application/epub+zip');
      zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>');
      zip.file('book.opf', `<package><metadata><dc:identifier>test-book</dc:identifier><dc:title>Embedded</dc:title>
        <meta name="cover" content="cover"/></metadata><manifest>
        <item id="c1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
        <item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>
        </manifest><spine><itemref idref="c1"/></spine></package>`);
      zip.file('chapter.xhtml', '<html><body>Text</body></html>');
      zip.file('cover.png', Buffer.from([137, 80, 78, 71]));
      const bytes = await zip.generateAsync({ type: 'nodebuffer' });
      const importer = new FileAcquisitions(db, config);
      const missingUser = { ...context, userId: 'missing' };
      await assert.rejects(importer.acquire(
        provider(bytes, 'application/epub+zip'), missingUser, { entryRef: 'epub' },
        { kind: 'file', acquisitionRef: 'epub', mediaType: 'application/epub+zip' }, { ref: 'epub', title: 'Catalog' },
      ), /FOREIGN KEY constraint failed/);
      assert.equal(db.get('SELECT COUNT(*) AS n FROM books')?.n, 0);
      assert.equal(db.get('SELECT COUNT(*) AS n FROM acquired_files')?.n, 0);
      assert.equal((await readdir(join(root, 'acquired'))).length, 0);
      assert.equal((await readdir(join(root, 'covers'))).length, 0);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
