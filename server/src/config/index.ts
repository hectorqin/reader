import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Runtime configuration.
 *
 * Hard constraint (product design §6): the book library directory is mounted
 * READ-ONLY. This server must never write into it. Every write (sqlite db,
 * extracted cover cache, scan journal) goes into DATA_DIR instead.
 */
export interface AppConfig {
  /** Read-only mount of the user's book directory. */
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
  writeFileSync(secretPath, generated, { mode: 0o600 });
  return generated;
}

export function loadConfig(): AppConfig {
  const booksDir = resolve(process.env.BOOKS_DIR ?? '/books');
  const dataDir = resolve(process.env.DATA_DIR ?? join(process.cwd(), DATA_DIR_DEFAULT_NAME));
  mkdirSync(dataDir, { recursive: true });

  if (booksDir === dataDir || dataDir.startsWith(`${booksDir}/`)) {
    throw new Error(
      `DATA_DIR (${dataDir}) must not live inside BOOKS_DIR (${booksDir}); the library mount is read-only.`,
    );
  }

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
    webDir: resolve(process.env.WEB_DIR ?? join(process.cwd(), 'web')),
  };
}
