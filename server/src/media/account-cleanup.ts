import type {MediaDatabase} from './read-database.ts';
import type {MediaAccounts} from './accounts.ts';

/** Bounded reconciliation of isolated FK placeholders; authority is never cached. */
export class MediaAccountCleanup {
  private cursor='';
  constructor(private readonly db:MediaDatabase,private readonly accounts:MediaAccounts){}
  sweep():number {
    const rows=this.db.all<{id:string}>('SELECT id FROM users WHERE id>? ORDER BY id LIMIT 100',this.cursor);
    let removed=0;
    this.db.transaction(()=>{
      for(const {id} of rows){
        // Disabled accounts retain their data. Missing accounts lose references
        // via the same FK cascades that applied before storage was separated.
        if(!this.accounts.get(id)){this.db.run('DELETE FROM users WHERE id=?',id);removed++;}
      }
    });
    this.cursor=rows.length===100?rows.at(-1)!.id:'';
    return removed;
  }
}
