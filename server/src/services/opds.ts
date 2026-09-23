import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Db } from '../db/index.ts';
import { badRequest, unauthorized } from '../lib/errors.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Read-only application passwords, deliberately separate from Reader sessions. */
export class OpdsCredentials {
  constructor(private readonly db: Db) {}

  list(userId: string) {
    return this.db.all<{ id: string; name: string; createdAt: number; expiresAt: number }>(
      'SELECT id,name,created_at AS createdAt,expires_at AS expiresAt FROM opds_credentials WHERE user_id=? ORDER BY created_at DESC', userId,
    );
  }

  create(userId: string, name: unknown) {
    if (typeof name !== 'string' || !name.trim() || name.length > 80) throw badRequest('请输入不超过 80 字的客户端名称');
    if (this.list(userId).length >= 20) throw badRequest('最多保存 20 个 OPDS 客户端，请先撤销不用的凭据');
    const id = randomUUID(), password = randomBytes(32).toString('base64url');
    const createdAt = Date.now(), expiresAt = createdAt + 365 * 86400_000;
    this.db.run('INSERT INTO opds_credentials(id,user_id,name,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)',
      id, userId, name.trim(), digest(password), createdAt, expiresAt);
    return { id, name: name.trim(), username: id, password, createdAt, expiresAt };
  }

  revoke(userId: string, id: string): void {
    this.db.run('DELETE FROM opds_credentials WHERE user_id=? AND id=?', userId, id);
  }

  authenticate(header: string | undefined): string {
    if (!header?.startsWith('Basic ') || header.length > 512) throw unauthorized('OPDS client credentials required', 'OPDS_AUTH_REQUIRED');
    const value = Buffer.from(header.slice(6), 'base64').toString('utf8'), split = value.indexOf(':');
    const row = this.db.get<{ user_id: string }>(
      `SELECT c.user_id FROM opds_credentials c JOIN users u ON u.id=c.user_id
       WHERE c.id=? AND c.token_hash=? AND c.expires_at>? AND u.disabled=0`,
      value.slice(0, split), digest(value.slice(split + 1)), Date.now(),
    );
    if (split < 1 || !row) throw unauthorized('OPDS client credentials invalid or expired', 'OPDS_AUTH_REQUIRED');
    return row.user_id;
  }
}

export const xml = (value: string | number) => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  .replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
