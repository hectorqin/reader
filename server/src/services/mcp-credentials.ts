import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Db } from '../db/index.ts';
import { badRequest, unauthorized } from '../lib/errors.ts';

export type McpScope = 'read' | 'write';

export interface McpCredentialInfo {
  id: string;
  name: string;
  scope: McpScope;
  createdAt: number;
  expiresAt: number;
}

export interface McpPrincipal {
  userId: string;
  scope: McpScope;
  credentialId: string;
}

const TOKEN_PREFIX = 'rdr_';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Long-lived personal API tokens for MCP clients (Claude Desktop, Claude Code,
 * Cursor, OpenClaw, etc.), deliberately separate from short-lived Reader JWTs.
 */
export class McpCredentials {
  constructor(private readonly db: Db) {}

  list(userId: string): McpCredentialInfo[] {
    return this.db.all<McpCredentialInfo>(
      `SELECT id, name, scope, created_at AS createdAt, expires_at AS expiresAt
       FROM mcp_credentials WHERE user_id = ? ORDER BY created_at DESC`,
      userId,
    );
  }

  create(userId: string, name: unknown, scope: unknown = 'read'): McpCredentialInfo & { token: string } {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
      throw badRequest('请输入不超过 80 字的客户端名称');
    }
    const resolvedScope: McpScope = scope === undefined ? 'read' : (scope as McpScope);
    if (resolvedScope !== 'read' && resolvedScope !== 'write') {
      throw badRequest('权限范围须为 read 或 write');
    }
    if (this.list(userId).length >= 20) {
      throw badRequest('最多保存 20 个 MCP 凭据，请先撤销不用的凭据');
    }
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const createdAt = Date.now();
    const expiresAt = createdAt + 365 * 86400_000;
    const trimmed = name.trim();
    this.db.run(
      'INSERT INTO mcp_credentials(id, user_id, name, token_hash, scope, created_at, expires_at) VALUES(?,?,?,?,?,?,?)',
      id,
      userId,
      trimmed,
      digest(secret),
      resolvedScope,
      createdAt,
      expiresAt,
    );
    return {
      id,
      name: trimmed,
      scope: resolvedScope,
      token: `${TOKEN_PREFIX}${id}.${secret}`,
      createdAt,
      expiresAt,
    };
  }

  revoke(userId: string, id: string): void {
    this.db.run('DELETE FROM mcp_credentials WHERE user_id = ? AND id = ?', userId, id);
  }

  authenticate(header: string | undefined): McpPrincipal {
    if (!header?.startsWith('Bearer ') || header.length > 512) {
      throw unauthorized('MCP bearer token required', 'MCP_AUTH_REQUIRED');
    }
    const raw = header.slice('Bearer '.length).trim();
    if (!raw.startsWith(TOKEN_PREFIX)) {
      throw unauthorized('MCP bearer token invalid', 'MCP_AUTH_REQUIRED');
    }
    const rest = raw.slice(TOKEN_PREFIX.length);
    const dot = rest.indexOf('.');
    if (dot < 1 || dot === rest.length - 1) {
      throw unauthorized('MCP bearer token invalid', 'MCP_AUTH_REQUIRED');
    }
    const id = rest.slice(0, dot);
    const secret = rest.slice(dot + 1);
    const row = this.db.get<{ user_id: string; scope: McpScope }>(
      `SELECT c.user_id, c.scope FROM mcp_credentials c
       JOIN users u ON u.id = c.user_id
       WHERE c.id = ? AND c.token_hash = ? AND c.expires_at > ? AND u.disabled = 0`,
      id,
      digest(secret),
      Date.now(),
    );
    if (!row) {
      throw unauthorized('MCP bearer token invalid or expired', 'MCP_AUTH_REQUIRED');
    }
    return { userId: row.user_id, scope: row.scope, credentialId: id };
  }
}
