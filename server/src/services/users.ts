import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.ts';
import type { AppConfig } from '../config/index.ts';
import { hashPassword, verifyPassword } from './passwords.ts';
import { hashToken, newRefreshToken, signAccessToken } from './tokens.ts';
import { conflict, forbidden, notFound, unauthorized } from '../lib/errors.ts';

export type Role = 'admin' | 'member';

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: Role;
  disabled: number;
  created_at: number;
  updated_at: number;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  createdAt: number;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    role: row.role,
    createdAt: row.created_at,
  };
}

export class UserService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  count(): number {
    const row = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users');
    return row?.n ?? 0;
  }

  list(): PublicUser[] {
    return this.db
      .all<UserRow>('SELECT * FROM users ORDER BY created_at ASC')
      .map(toPublicUser);
  }

  byId(id: string): UserRow | undefined {
    return this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
  }

  /**
   * Public registration is only allowed when explicitly enabled. The very first
   * account is always accepted, so a fresh deployment can be claimed by its
   * owner without a pre-seeded password.
   */
  canRegisterPublicly(): boolean {
    if (this.count() === 0) return true;
    return process.env.ALLOW_REGISTRATION === 'true';
  }

  async create(input: {
    username: string;
    password: string;
    displayName?: string;
    role?: Role;
  }): Promise<PublicUser> {
    const username = input.username.trim();
    if (username.length < 3) throw conflict('username must be at least 3 characters', 'USERNAME_TOO_SHORT');
    if (input.password.length < 8) throw conflict('password must be at least 8 characters', 'PASSWORD_TOO_SHORT');
    const existing = this.db.get<{ id: string }>('SELECT id FROM users WHERE username = ? COLLATE NOCASE', username);
    if (existing) throw conflict('username already taken', 'USERNAME_TAKEN');

    const now = Date.now();
    const row: UserRow = {
      id: randomUUID(),
      username,
      display_name: input.displayName?.trim() ?? '',
      password_hash: await hashPassword(input.password),
      // The first user to register owns the instance.
      role: input.role ?? (this.count() === 0 ? 'admin' : 'member'),
      disabled: 0,
      created_at: now,
      updated_at: now,
    };
    this.db.run(
      `INSERT INTO users (id, username, display_name, password_hash, role, disabled, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      row.id, row.username, row.display_name, row.password_hash, row.role, row.disabled, row.created_at, row.updated_at,
    );
    // A new account must see the whole shared library straight away. Without
    // this, a book scanned before the account existed would stay invisible
    // until its file happened to change.
    this.db.run(
      `INSERT OR IGNORE INTO user_books (user_id, book_id, added_at)
       SELECT ?, b.id, ? FROM books b
       WHERE EXISTS (SELECT 1 FROM book_files f WHERE f.book_id = b.id AND f.missing = 0)`,
      row.id, now,
    );
    return toPublicUser(row);
  }

  /**
   * Admin-initiated creation. Unlike the public register endpoint this is not
   * gated by ALLOW_REGISTRATION: an admin is the instance owner and is expected
   * to add family members (§1, 单实例多账号).
   */
  async createAsAdmin(input: {
    username: string;
    password: string;
    displayName?: string;
    role?: Role;
  }): Promise<PublicUser> {
    const requestedRole = input.role ?? 'member';
    return this.create({ ...input, role: requestedRole });
  }

  async login(username: string, password: string, device = ''): Promise<{
    user: PublicUser;
    accessToken: string;
    accessTokenExpiresAt: number;
    refreshToken: string;
    refreshTokenExpiresAt: number;
  }> {
    const row = this.db.get<UserRow>('SELECT * FROM users WHERE username = ? COLLATE NOCASE', username.trim());
    // Always run a hash comparison so a missing user and a wrong password take
    // comparable time and cannot be distinguished by timing.
    const ok = row
      ? await verifyPassword(password, row.password_hash)
      : await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
    if (!row || !ok) throw unauthorized('invalid username or password', 'BAD_CREDENTIALS');
    if (row.disabled === 1) throw forbidden('account disabled', 'ACCOUNT_DISABLED');

    const access = signAccessToken(this.config, { id: row.id, role: row.role });
    const refresh = newRefreshToken();
    const refreshExpiresAt = Date.now() + this.config.refreshTokenTtl * 1000;
    this.db.run(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, device, created_at, expires_at, revoked_at)
       VALUES (?,?,?,?,?,?,NULL)`,
      refresh.id, row.id, refresh.hash, device.slice(0, 200), Date.now(), refreshExpiresAt,
    );
    return {
      user: toPublicUser(row),
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refreshExpiresAt,
    };
  }

  /** Rotates the refresh token: the presented one is revoked in the process. */
  async refresh(refreshToken: string): Promise<{
    user: PublicUser;
    accessToken: string;
    accessTokenExpiresAt: number;
    refreshToken: string;
    refreshTokenExpiresAt: number;
  }> {
    const hash = hashToken(refreshToken);
    const row = this.db.get<{ id: string; user_id: string; expires_at: number; revoked_at: number | null }>(
      'SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = ?',
      hash,
    );
    if (!row || row.revoked_at !== null) throw unauthorized('refresh token invalid', 'REFRESH_INVALID');
    if (row.expires_at <= Date.now()) throw unauthorized('refresh token expired', 'REFRESH_EXPIRED');

    const user = this.byId(row.user_id);
    if (!user || user.disabled === 1) throw unauthorized('account unavailable', 'REFRESH_INVALID');

    this.db.run('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?', Date.now(), row.id);

    const access = signAccessToken(this.config, { id: user.id, role: user.role });
    const next = newRefreshToken();
    const expiresAt = Date.now() + this.config.refreshTokenTtl * 1000;
    this.db.run(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, device, created_at, expires_at, revoked_at)
       VALUES (?,?,?,?,?,?,NULL)`,
      next.id, user.id, next.hash, '', Date.now(), expiresAt,
    );
    return {
      user: toPublicUser(user),
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: next.token,
      refreshTokenExpiresAt: expiresAt,
    };
  }

  /** Revokes a single device session. Silently succeeds when already revoked. */
  revokeByToken(refreshToken: string): void {
    this.db.run(
      'UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
      Date.now(), hashToken(refreshToken),
    );
  }

  revokeAll(userId: string): void {
    this.db.run('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', Date.now(), userId);
  }

  async changePassword(userId: string, currentPassword: string, nextPassword: string): Promise<void> {
    const row = this.byId(userId);
    if (!row) throw notFound('user not found');
    if (!(await verifyPassword(currentPassword, row.password_hash))) {
      throw unauthorized('current password is incorrect', 'BAD_CREDENTIALS');
    }
    if (nextPassword.length < 8) throw conflict('password must be at least 8 characters', 'PASSWORD_TOO_SHORT');
    this.db.run(
      'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
      await hashPassword(nextPassword), Date.now(), userId,
    );
    // A password change must invalidate every other device's session.
    this.revokeAll(userId);
  }

  setDisabled(userId: string, disabled: boolean): void {
    this.db.run('UPDATE users SET disabled = ?, updated_at = ? WHERE id = ?', disabled ? 1 : 0, Date.now(), userId);
    if (disabled) this.revokeAll(userId);
  }

  setRole(userId: string, role: Role): void {
    this.db.run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', role, Date.now(), userId);
  }
}
