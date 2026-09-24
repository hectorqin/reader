import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { Db } from '../db/index.ts';
import { badRequest, notFound } from '../lib/errors.ts';

export type RegistrationMode = 'closed' | 'open' | 'invite';
const digest = (code: string) => createHash('sha256').update(code.trim()).digest('hex');

export class RegistrationService {
  constructor(private readonly db: Db) {}
  mode(): RegistrationMode {
    return this.db.get<{mode:RegistrationMode}>('SELECT mode FROM registration_settings WHERE id = 1')?.mode
      ?? (process.env.ALLOW_REGISTRATION === 'true' ? 'open' : 'closed');
  }
  setMode(mode: unknown): void {
    if (mode !== 'closed' && mode !== 'open' && mode !== 'invite') throw badRequest('无效的注册模式');
    this.db.run('INSERT INTO registration_settings (id,mode) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET mode=excluded.mode',mode);
  }
  invites() {
    return this.db.all<{id:string;label:string;maxUses:number;usedCount:number;expiresAt:number;disabled:number;createdAt:number}>(
      'SELECT id,label,max_uses AS maxUses,used_count AS usedCount,expires_at AS expiresAt,disabled,created_at AS createdAt FROM registration_invites ORDER BY created_at DESC',
    ).map(row=>({...row,disabled:!!row.disabled}));
  }
  create(label: unknown, maxUses: unknown, days: unknown) {
    if (typeof label !== 'string' || label.trim().length > 80 || !Number.isInteger(maxUses) || (maxUses as number) < 1 || (maxUses as number) > 1000 || !Number.isInteger(days) || (days as number) < 1 || (days as number) > 365) throw badRequest('备注限 80 字，次数须为 1–1000，有效期须为 1–365 天');
    const id=randomUUID(),code=randomBytes(18).toString('base64url'),now=Date.now();
    this.db.run('INSERT INTO registration_invites(id,code_hash,label,max_uses,expires_at,created_at) VALUES(?,?,?,?,?,?)',id,digest(code),label.trim(),maxUses as number,now+(days as number)*86400000,now);
    return {code,invite:this.invites().find(invite=>invite.id===id)!};
  }
  disable(id:string): void {
    if (!this.db.get('SELECT id FROM registration_invites WHERE id=?',id)) throw notFound('邀请码不存在');
    this.db.run('UPDATE registration_invites SET disabled=1 WHERE id=?',id);
  }
  /** Called inside the same transaction as account creation, after password hashing. */
  admit(code: unknown): void {
    if (this.db.get<{n:number}>('SELECT count(*) AS n FROM users')!.n === 0) return;
    const mode=this.mode();
    if (mode==='closed') throw badRequest('此实例已关闭公开注册，请联系管理员创建账号','REGISTRATION_DISABLED');
    if (mode==='open') return;
    if (typeof code!=='string' || !code.trim() || code.length>200) throw badRequest('请填写有效的邀请码','INVITE_REQUIRED');
    const row=this.db.get<{id:string}>('SELECT id FROM registration_invites WHERE code_hash=? AND disabled=0 AND used_count<max_uses AND expires_at>?',digest(code),Date.now());
    if (!row) throw badRequest('邀请码无效、已过期或已用完','INVITE_INVALID');
    this.db.run('UPDATE registration_invites SET used_count=used_count+1 WHERE id=?',row.id);
  }
}
