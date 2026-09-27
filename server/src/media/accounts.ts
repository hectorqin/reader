import type { MediaDatabase } from './read-database.ts';
import {badRequest} from '../lib/errors.ts';

export interface MediaAccount {
  id: string;
  role: 'admin' | 'member';
  disabled: number;
  auth_version: number;
}

/** Resolve current authority on every use; media storage is not an account cache. */
export interface MediaAccounts { get(id: string): MediaAccount | undefined }

export class DatabaseMediaAccounts implements MediaAccounts {
  constructor(private readonly db: Pick<MediaDatabase, 'get'>) {}
  get(id: string): MediaAccount | undefined {
    return this.db.get<MediaAccount>('SELECT id,role,disabled,auth_version FROM users WHERE id=?', id);
  }
}

/** FK identities only. This never copies roles, passwords or token versions. */
export class MediaAccountReferences {
  constructor(private readonly db:MediaDatabase,private readonly accounts:MediaAccounts){}
  ensure(id:string):void {
    const account=this.accounts.get(id);
    if(!account)throw badRequest('unknown user');
    if(this.db.get('SELECT id FROM users WHERE id=?',id))return;
    if(account.disabled!==0)throw badRequest('disabled user');
    this.db.run('INSERT OR IGNORE INTO users(id) VALUES(?)',id);
  }
}
