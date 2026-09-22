import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Runtime configuration.
 *
 * BOOKS_DIR follows filesystem permissions: a read-only mount supports reading,
 * while a writable mount enables administrator file management. Server-owned
 * state (database, cover cache, scan journal) stays in DATA_DIR, outside BOOKS_DIR.
 */
export interface AppConfig {
  /** User's book directory; may be mounted read-only or writable. */
  booksDir: string;
  /** Writable directory owned by this server. Never inside booksDir. */
  dataDir: string;
  host: string;
  port: number;
  /** Persistent token signing secret, auto generated on first boot if absent. */
  jwtSecret: string;
  /** Access token lifetime in seconds. */
  accessTokenTtl: number;
  /** Refresh token lifetime in seconds (long, self-hosted users upgrade rarely). */
  refreshTokenTtl: number;
  /** Scan interval in seconds; 0 disables the scheduler. */
  scanInterval: number;
  /** Polling watcher interval in seconds; 0 disables it. */
  watchInterval: number;
  logLevel: string;
  /** Public base URL advertised to clients (used by download links). */
  publicUrl: string;
  /**
   * Origins allowed to call the API from a browser.
   *
   * Empty means "reflect any origin", which is the right default for a
   * self-hosted server on a LAN: the reader does not know the IP it will be
   * reached on, and there are no cookies in the design, so a permissive policy
   * does not hand out ambient authority the way it would for a session-cookie
   * API.
   *
   * Set it when the instance is on the public internet and is meant to be used
   * only by a specific H5 deployment.
   */
  corsOrigins: string[];
  /**
   * Directory containing the built H5 client, served at `/`.
   *
   * Optional: the client can also be hosted separately (or loaded from
   * `file://` inside the Android shell). When present, `GET /` returns the app,
   * which is what makes "open the NAS IP in a browser" work with no extra
   * setup.
   */
  webDir: string;
}

const DATA_DIR_DEFAULT_NAME = 'data';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Load or create the persistent secret. Regenerating it on every boot would
 * silently invalidate every client session, so it is persisted in DATA_DIR.
 */
function loadOrCreateSecret(dataDir: string, file = 'token.secret'): string {
  const fromEnv = process.env.READER_TOKEN_SECRET ?? process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;

  const secretPath = join(dataDir, file);
  if (existsSync(secretPath)) {
    const existing = readFileSync(secretPath, 'utf8').trim();
    if (existing.length >= 16) return existing;
  }
  const generated = randomBytes(48).toString('base64url');
  try {
    writeFileSync(secretPath, generated, { mode: 0o600 });
  } catch (err) {
    // A bare EACCES here is the single most common self-hosting failure: /data
    // is a bind mount whose host directory is root-owned while the server runs
    // as an unprivileged user. Say so, instead of surfacing a bare errno.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
      throw new Error(
        `cannot write ${secretPath} (${code}); DATA_DIR must be writable by the server. ` +
          `If /data is a bind mount, fix its ownership on the host (e.g. \`chown -R 100:100 ./data\`) ` +
          `or set READER_TOKEN_SECRET to a value of at least 16 characters to skip the file entirely.`,
      );
    }
    throw err;
  }
  return generated;
}

export function loadConfig(): AppConfig {
  const booksDir = resolve(process.env.BOOKS_DIR ?? '/books');
  const dataDir = resolve(process.env.DATA_DIR ?? join(process.cwd(), DATA_DIR_DEFAULT_NAME));
  const dataRelativeToBooks = relative(booksDir, dataDir);
  const insideBooks = dataRelativeToBooks === '' || (
    dataRelativeToBooks !== '..' && !dataRelativeToBooks.startsWith(`..${sep}`) && !isAbsolute(dataRelativeToBooks)
  );
  if (insideBooks) {
    throw new Error(
      `DATA_DIR (${dataDir}) must not live inside BOOKS_DIR (${booksDir}); server-owned data must stay outside the book directory.`,
    );
  }
  mkdirSync(dataDir, { recursive: true });

  return {
    booksDir,
    dataDir,
    host: process.env.HOST ?? '0.0.0.0',
    port: envInt('PORT', 8080),
    jwtSecret: loadOrCreateSecret(dataDir),
    accessTokenTtl: envInt('ACCESS_TOKEN_TTL', 60 * 60 * 24),
    refreshTokenTtl: envInt('REFRESH_TOKEN_TTL', 60 * 60 * 24 * 365),
    scanInterval: envInt('SCAN_INTERVAL', 60 * 30),
    watchInterval: envInt('WATCH_INTERVAL', 60),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    publicUrl: process.env.PUBLIC_URL ?? '',
    corsOrigins: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    // The built H5 bundle. `WEB_DIR` is unset in a server-only deployment, and
    // when it is also absent on disk the static routes are simply not registered
    // (see `registerWebRoutes`), so /api/* is never shadowed by a fallback.
    webDir: resolve(process.env.WEB_DIR ?? join(process.cwd(), 'web')),
  };
}
