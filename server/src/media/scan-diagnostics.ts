export type ScanPhase='list'|'probe'|'stat'|'metadata'|'publish';
export interface ScanDiagnostics {
  elapsedMs:number;
  active:Array<{phase:ScanPhase;ref?:string;elapsedMs:number}>;
  timings:Record<ScanPhase,number>;
  logs:Array<{at:number;message:string}>;
}
export interface ScanLogger { info(data:object,message:string):void; warn(data:object,message:string):void }

/** Bounded diagnostic history; never records upstream errors, URLs or credentials. */
export class ScanTrace {
  private readonly started=Date.now();
  private readonly active=new Map<symbol,{phase:ScanPhase;ref?:string;started:number}>();
  private readonly timings:Record<ScanPhase,number>={list:0,probe:0,stat:0,metadata:0,publish:0};
  private readonly logs:ScanDiagnostics['logs']=[];
  constructor(private readonly jobId:string,private readonly libraryId:string,private readonly logger?:ScanLogger){}
  note(message:string,failed=false){
    this.logs.push({at:Date.now(),message});if(this.logs.length>30)this.logs.shift();
    const data={jobId:this.jobId,libraryId:this.libraryId,...this.snapshot()};
    if(failed)this.logger?.warn(data,message);else this.logger?.info(data,message);
  }
  begin(phase:ScanPhase,ref?:string){
    const key=Symbol(),started=Date.now();this.active.set(key,{phase,ref,started});
    return ()=>{const elapsed=Date.now()-started;this.timings[phase]+=elapsed;this.active.delete(key);
      if(elapsed>=2000)this.note(`慢操作：${phase}，耗时 ${(elapsed/1000).toFixed(1)} 秒${ref?' · '+ref:''}`);
    };
  }
  async measure<T>(phase:ScanPhase,ref:string|undefined,operation:()=>Promise<T>):Promise<T>{
    const end=this.begin(phase,ref);try{return await operation();}
    catch(error){this.note(`操作中断：${phase}${ref?' · '+ref:''}`,true);throw error;}
    finally{end();}
  }
  snapshot():ScanDiagnostics {
    const now=Date.now();return {elapsedMs:now-this.started,timings:{...this.timings},
      active:[...this.active.values()].map(({phase,ref,started})=>({phase,ref,elapsedMs:now-started})),logs:[...this.logs]};
  }
}
