/**
 * Config-loading tests, focused on the failure mode that breaks a plain
 * `docker compose up` on a fresh checkout.
 *
 * The image runs the server as an unprivileged user, so a bind-mounted `/data`
 * whose host directory is root-owned makes the signing-key write fail with a
 * bare `EACCES`. These tests pin down both the happy path and the *explained*
 * error, because a raw errno here is what turns a one-line fix into a support
 * thread.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, chmod, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config/index.ts';

const SECRET_ENV = ['READER_TOKEN_SECRET', 'JWT_SECRET'] as const;

test('refuses to start from a backup or incomplete restore directory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'reader-config-backup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const marker of ['reader-backup.json', '.reader-backup-incomplete']) {
    const data = join(root, marker + '-data'); await mkdir(data);
    await writeFile(join(data, marker), 'marker');
    await withEnv({ DATA_DIR: data, BOOKS_DIR: join(root, 'books') }, () => {
      assert.throws(() => loadConfig(), /backup directory/);
    });
  }
});

async function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => Promise<void> | void,
): Promise<void> {
  const saved = new Map<string, string | undefined>();
  for (const key of [...SECRET_ENV, 'DATA_DIR', 'BOOKS_DIR']) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  Object.assign(process.env, vars);
  try {
    await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('a fresh DATA_DIR gets a persisted, stable secret', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reader-config-'));
  const dataDir = join(root, 'data');
  const booksDir = join(root, 'books');
  await mkdir(booksDir, { recursive: true });

  try {
    await withEnv({ DATA_DIR: dataDir, BOOKS_DIR: booksDir }, async () => {
      const first = loadConfig();
      assert.ok(first.jwtSecret.length >= 16, 'secret is long enough to sign with');

      // Written 0600: the key is a credential, not world-readable config.
      const stat = await readFile(join(dataDir, 'token.secret'), 'utf8');
      assert.equal(stat.trim(), first.jwtSecret);

      // A second boot must reuse it, or every client session would be dropped
      // on restart.
      const second = loadConfig();
      assert.equal(second.jwtSecret, first.jwtSecret);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('READER_TOKEN_SECRET wins and skips the file entirely', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reader-config-'));
  const dataDir = join(root, 'data');
  const booksDir = join(root, 'books');
  await mkdir(booksDir, { recursive: true });

  try {
    await withEnv(
      { DATA_DIR: dataDir, BOOKS_DIR: booksDir, READER_TOKEN_SECRET: 'a-secret-set-by-the-operator' },
      async () => {
        const config = loadConfig();
        assert.equal(config.jwtSecret, 'a-secret-set-by-the-operator');
        // Nothing to persist, so no file is created.
        await assert.rejects(readFile(join(dataDir, 'token.secret'), 'utf8'));
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an unwritable DATA_DIR fails with the fix, not a bare EACCES', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows does not enforce Unix directory permission bits');
    return;
  }
  if (process.getuid?.() === 0) {
    // root bypasses the permission bits, so the failure cannot be reproduced.
    t.skip('running as root; permission bits are not enforced');
    return;
  }

  const root = await mkdtemp(join(tmpdir(), 'reader-config-'));
  const dataDir = join(root, 'data');
  const booksDir = join(root, 'books');
  await mkdir(dataDir, { recursive: true });
  await mkdir(booksDir, { recursive: true });
  await chmod(dataDir, 0o500);

  try {
    await withEnv({ DATA_DIR: dataDir, BOOKS_DIR: booksDir }, async () => {
      assert.throws(
        () => loadConfig(),
        (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          assert.match(message, /cannot write .*token\.secret/);
          assert.match(message, /DATA_DIR must be writable/);
          // The escape hatch is spelled out, so the reader has a way forward.
          assert.match(message, /READER_TOKEN_SECRET/);
          return true;
        },
      );
    });
  } finally {
    await chmod(dataDir, 0o700);
    await rm(root, { recursive: true, force: true });
  }
});

test('DATA_DIR inside BOOKS_DIR is refused before creating the directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reader-config-'));
  const booksDir = join(root, 'books');
  const dataDir = join(booksDir, 'nested', 'data');
  await mkdir(booksDir, { recursive: true });

  try {
    await withEnv({ DATA_DIR: dataDir, BOOKS_DIR: booksDir }, async () => {
      assert.throws(() => loadConfig(), /must not live inside BOOKS_DIR/);
      await assert.rejects(stat(join(booksDir, 'nested')), { code: 'ENOENT' });
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('DATA_DIR equal to BOOKS_DIR is refused before creating either directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reader-config-'));
  const booksDir = join(root, 'not-created');
  try {
    await withEnv({ DATA_DIR: booksDir, BOOKS_DIR: booksDir }, async () => {
      assert.throws(() => loadConfig(), /must not live inside BOOKS_DIR/);
      await assert.rejects(stat(booksDir), { code: 'ENOENT' });
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a sibling DATA_DIR sharing the BOOKS_DIR prefix is permitted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reader-config-'));
  const booksDir = join(root, 'books');
  const dataDir = join(root, 'books-data');
  try {
    await withEnv({ DATA_DIR: dataDir, BOOKS_DIR: booksDir }, async () => {
      assert.equal(loadConfig().dataDir, dataDir);
      assert.ok((await stat(dataDir)).isDirectory());
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
