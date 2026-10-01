import {FloatingConfirm} from '../ui/floating-confirm.tsx';
import {MediaSelect} from './select.tsx';
import { ChevronDown, ChevronRight } from 'lucide-preact';
import { useEffect, useRef, useState } from '../ui/vendor/preact.ts';
import type { Item, Library, MediaApi, MediaChannel } from './api.ts';
interface Job {id:string;provider:string;state:string;created_at?:number;total?:number;counts?:Record<string,number>;items:Array<{itemId:string;state:string;error:string|null;title?:string;channel?:MediaChannel}>}
const countState=(job:Job,state:string)=>job.counts?.[state]??job.items.filter(row=>row.state===state).length;
const jobTotal=(job:Job)=>job.total??job.items.length;
interface Provider {id:string;label:string;configured:boolean;kinds:string[]}
const names:Record<string,string>={movie:'电影',series:'剧集',season:'季',episode:'集',album:'专辑',artist:'歌手',track:'曲目',audiobook:'有声书',pending:'等待',running:'处理中',matched:'已匹配',review:'待审阅',unmatched:'无匹配',unchanged:'已有匹配',failed:'失败',complete:'处理结束',cancelled:'已取消',interrupted:'已中断'};
const explanations:Record<string,string>={review:'尚未自动保存匹配，请打开作品核对候选。历史任务也可能没有候选。',unmatched:'本次未找到候选，可打开作品调整搜索词或更换来源。',failed:'本项处理失败，可核对原因后重试。',cancelled:'本项未完成，已保存的匹配不会撤销。',interrupted:'本项因服务或账号状态变化而中断，可在恢复后重试。'};
function JobResults({job,api,navigate}:{job:Job;api:MediaApi;navigate:(channel:MediaChannel,id:string)=>void}){
  const [filter,setFilter]=useState('all'),[page,setPage]=useState(0);
  const [result,setResult]=useState<{items:Job['items'];total:number}|null>(null),[status,setStatus]=useState<'loading'|'ready'|'error'>('loading'),[retry,setRetry]=useState(0);
  const revision=JSON.stringify(job.counts);
  useEffect(()=>{
    // Older servers can still return full jobs; use their bounded client pages.
    if(!job.counts)return;
    const controller=new AbortController();setStatus('loading');setResult(null);
    const params=new URLSearchParams({offset:String(page*50),limit:'50'});if(filter!=='all')params.set('state',filter);
    void api.request<{items:Job['items'];total:number}>('scrape-jobs/'+encodeURIComponent(job.id)+'/results?'+params,'GET',undefined,controller.signal).then(value=>{
      if(controller.signal.aborted)return;
      if(page>0&&page*50>=value.total){setPage(0);return;}
      setResult(value);setStatus('ready');
    }).catch(()=>{if(!controller.signal.aborted)setStatus('error');});
    return ()=>controller.abort();
  },[api,job.id,job.state,revision,filter,page,retry]);
  const states=['pending','running','review','unmatched','failed','interrupted','cancelled','matched','unchanged'];
  const legacyRows=job.items.filter(row=>filter==='all'||row.state===filter);
  const total=job.counts?(result?.total??(filter==='all'?jobTotal(job):countState(job,filter))):legacyRows.length;
  const last=Math.max(0,Math.ceil(total/50)-1),current=Math.min(page,last),ready=!job.counts||status==='ready';
  const rows=job.counts?(result?.items??[]):legacyRows.slice(current*50,current*50+50);
  return <section className="media-job-results" aria-label="任务结果">
    <div className="media-toolbar media-job-result-filters"><label>结果状态 <MediaSelect aria-label="结果状态" value={filter} onChange={event=>{setFilter(event.currentTarget.value);setPage(0);}}><option value="all">全部 · {jobTotal(job)}</option>{states.map(state=><option key={state} value={state}>{names[state]} · {countState(job,state)}</option>)}</MediaSelect></label><span>{total} 项</span></div>
    {job.counts&&status==='loading'&&<p role="status">正在读取任务结果…</p>}
    {job.counts&&status==='error'&&<p role="alert">任务结果读取失败。<button onClick={()=>setRetry(value=>value+1)}>重新读取结果</button></p>}
    {ready&&!rows.length&&<p role="status">当前没有此状态的结果。</p>}
    {ready&&rows.map(row=><div className="media-row media-task-result" key={row.itemId}><span>{row.title||'作品已移除'}<small>{names[row.state]||row.state}{row.error?' · '+(row.error==='server-restarted'?'服务重启，处理已中断':row.error):''}</small></span>{row.channel&&row.title&&<button className="media-task-icon" aria-label="查看作品" title="查看作品" onClick={()=>navigate(row.channel!,row.itemId)}><ChevronRight size={18} aria-hidden="true"/></button>}</div>)}
    {explanations[filter]&&<p className="media-task-note">{explanations[filter]}</p>}
    {last>0&&<nav className="media-toolbar" aria-label="任务结果分页"><button disabled={!ready||current===0} onClick={()=>setPage(current-1)}>上一页结果</button><span>{current+1} / {last+1}</span><button disabled={!ready||current===last} onClick={()=>setPage(current+1)}>下一页结果</button></nav>}
  </section>;
}
export function ScrapeJobs({api,libraries,navigate}:{api:MediaApi;libraries:Library[];navigate:(channel:MediaChannel,id:string)=>void}){
  const createForm=useRef<HTMLDetailsElement>(null),history=useRef<HTMLElement>(null);
  const [libraryId,setLibraryId]=useState(libraries[0]?.id||'');
  const [providers,setProviders]=useState<Provider[]>([]),[provider,setProvider]=useState('');
  const [kind,setKind]=useState(''),[offset,setOffset]=useState(0),[total,setTotal]=useState(0),[query,setQuery]=useState('');
  const [matchMode,setMatchMode]=useState<'strong'|'first'|'manual'>('strong');
  const [items,setItems]=useState<Item[]>([]),[selected,setSelected]=useState<string[]>([]);
  const [jobs,setJobs]=useState<Job[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
  const [refresh,setRefresh]=useState(0),[providerRetry,setProviderRetry]=useState(0);
  const [jobsState,setJobsState]=useState<'loading'|'ready'|'error'>('loading'),[jobsRetry,setJobsRetry]=useState(0);
  const [deleteId,setDeleteId]=useState('');
  const [openJobs,setOpenJobs]=useState<string[]>([]);
  const [selectingAll,setSelectingAll]=useState(false);
  const library=libraries.find(lib=>lib.id===libraryId);
  const libraryKinds=library?.kind==='video'?['movie','series','season','episode']:library?.kind==='music'?['album','artist','track']:['audiobook'];
  const compatibleProviders=providers.filter(p=>libraryKinds.some(kind=>p.kinds.includes(kind)));
  const allowed=libraryKinds.filter(value=>providers.find(p=>p.id===provider)?.kinds.includes(value));
  useEffect(()=>{let live=true;void api.request<{items:Provider[]}>('metadata/providers').then(result=>{if(live){setProviders(result.items);setProvider(result.items.find(p=>p.configured)?.id||'');}}).catch(e=>{if(live)setError(String(e));});return ()=>{live=false;};},[api,providerRetry]);
  useEffect(()=>{
    if(!compatibleProviders.some(p=>p.id===provider&&p.configured))setProvider(compatibleProviders.find(p=>p.configured)?.id||'');
  },[libraryId,providers,provider]);
  useEffect(()=>{setKind(allowed[0]||'');setOffset(0);setSelected([]);},[libraryId,provider,providers]);
  useEffect(()=>{
    const controller=new AbortController();setItems([]);setTotal(0);
    if(!libraryId||!kind||!allowed.includes(kind)){setLoading(false);return ()=>controller.abort();}
    setLoading(true);
    void api.items(libraryId,kind,'',offset,controller.signal).then(result=>{if(!controller.signal.aborted){setItems(result.items);setTotal(result.total);}}).catch(e=>{if(!controller.signal.aborted)setError(String(e));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[api,libraryId,kind,provider,providers,offset,refresh]);
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    setJobsState('loading');
    const load=async()=>{try{const result=await api.request<{items:Job[]}>('scrape-jobs?summary=true','GET',undefined,controller.signal);if(controller.signal.aborted)return;setJobs(result.items);setJobsState('ready');if(result.items.some(job=>job.state==='running'))timer=setTimeout(()=>void load(),2000);}catch{if(!controller.signal.aborted)setJobsState('error');}};
    void load();return ()=>{controller.abort();if(timer)clearTimeout(timer);};
  },[api,refresh,jobsRetry]);
  async function action(path:string,body:unknown,method='POST'){setBusy(true);setError('');try{await api.request(path,method,body);setSelected([]);setRefresh(value=>value+1);if(path==='scrape-jobs'){if(createForm.current)createForm.current.open=false;history.current?.focus();}}catch(e){setError(e instanceof Error?e.message:'操作失败');}finally{setBusy(false);}}
  async function selectAllResults(){
    if(selectingAll||loading||!libraryId||!kind)return;setSelectingAll(true);setError('');
    try{const ids:string[]=[];let cursor=0;while(ids.length<500&&cursor<total){const page=await api.items(libraryId,kind,'',cursor);for(const item of page.items){if(!ids.includes(item.id))ids.push(item.id);if(ids.length>=500)break;}if(!page.items.length)break;cursor+=page.items.length;}setSelected(ids);if(total>500)setError('服务端单批最多处理 500 项，已选择前 500 项。');}
    catch(e){setError(e instanceof Error?e.message:'无法选择全部作品');}finally{setSelectingAll(false);}
  }
  const running=jobs.some(job=>job.state==='running');
  const visibleItems=query.trim()?items.filter(item=>item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())):items;
  const taskHistory=<section ref={history} tabIndex={-1} className="media-task-history" aria-label="最近刮削任务">
    <h2 className="media-task-section-title">最近任务</h2>
    {jobsState==='loading'&&<p role="status">正在读取任务状态…</p>}
    {jobsState==='error'&&<p role="alert">任务状态读取失败。{jobs.length?'下方为上次读取的结果，可能已变化。':''}请重新读取后操作。<button disabled={busy} onClick={()=>setJobsRetry(value=>value+1)}>重新读取任务</button></p>}
    {jobsState==='ready'&&!jobs.length&&<p>暂无批量刮削任务。</p>}
    {jobs.map(job=>{const total=jobTotal(job),ended=Math.max(0,total-countState(job,'running')-countState(job,'pending')),review=countState(job,'review'),failed=countState(job,'failed');return <details className="media-scrape-job" key={job.id} onToggle={event=>{const opened=event.currentTarget.open;setOpenJobs(ids=>opened?[...new Set([...ids,job.id])]:ids.filter(id=>id!==job.id));}}><summary aria-label={job.provider+' · '+(names[job.state]||job.state)+' · 已结束 '+ended+'/'+total+' 项'}><span className="media-task-copy"><strong>{providers.find(p=>p.id===job.provider)?.label||job.provider} · 元数据匹配</strong><small>已结束 {ended}/{total} 项{review?' · 待确认 '+review:''}{failed?' · 失败 '+failed:''}</small></span><span className="media-task-state" data-state={job.state==='running'?'running':failed?'failed':review?'review':job.state}>{job.state==='running'?'进行中':failed?'有失败项':review?'待确认':names[job.state]||job.state}</span><ChevronDown className="media-task-chevron" size={16} aria-hidden="true"/>{job.state==='running'&&<progress className="media-task-progress" aria-label="匹配进度" max={total||1} value={ended}/>}</summary>
      {typeof job.created_at==='number'&&Number.isFinite(job.created_at)&&<p>创建时间：<time dateTime={new Date(job.created_at).toISOString()}>{new Date(job.created_at).toLocaleString('zh-CN',{hour12:false})}</time></p>}
      <p>{Object.entries(names).flatMap(([state,label])=>{const count=countState(job,state);return count?[`${label} ${count}`]:[];}).join(' · ')}</p>
      {job.state==='complete'&&<p>任务处理已结束，请核对下方结果；待审阅、无匹配和失败项尚未保存新的匹配。</p>}
      {job.state==='running'?<button disabled={busy||jobsState!=='ready'} onClick={()=>void action('scrape-jobs/'+job.id+'/cancel',{})}>取消任务</button>:<button disabled={busy||jobsState!=='ready'||running||!['failed','interrupted','cancelled'].some(state=>countState(job,state)>0)} onClick={()=>void (job.counts?action('scrape-jobs/'+encodeURIComponent(job.id)+'/retry',{}):action('scrape-jobs',{provider:job.provider,itemIds:job.items.filter(i=>['failed','interrupted','cancelled'].includes(i.state)).map(i=>i.itemId)}))}>重试未完成项</button>}
      {job.state!=='running'&&<button disabled={busy||jobsState!=='ready'} onClick={()=>setDeleteId(job.id)}>删除任务</button>}
      {openJobs.includes(job.id)&&<JobResults job={job} api={api} navigate={navigate}/>}
    </details>;})}
  </section>;
  return <section className="media-scrape-manager" aria-label="批量刮削管理">
    {error&&<p role="alert">{error}<button onClick={()=>{setError('');setRefresh(value=>value+1);if(!providers.length)setProviderRetry(value=>value+1);}}>刷新</button></p>}
    <details ref={createForm} className="media-task-create" open><summary>新建批量匹配</summary>
    <p>将所选作品标题发送给来源，唯一较强匹配经详情复核后保存；已有匹配保留，歧义结果转人工审阅。季集按已确认父剧和编号获取候选，需逐项核对后确认。每批最多 500 项。</p>
    <div className="media-form"><label>媒体库<MediaSelect aria-label="媒体库" value={libraryId} disabled={busy} onChange={e=>{setSelected([]);setItems([]);setLoading(true);setLibraryId(e.currentTarget.value);}}>{libraries.map(lib=><option value={lib.id} key={lib.id}>{lib.name}</option>)}</MediaSelect></label>
    <label>刮削来源<MediaSelect aria-label="刮削来源" value={provider} disabled={busy} onChange={e=>{setSelected([]);setItems([]);setLoading(true);setProvider(e.currentTarget.value);}}>{!provider&&<option value="">无可用来源</option>}{compatibleProviders.map(p=><option key={p.id} value={p.id} disabled={!p.configured}>{p.label}{p.configured?'':'（未配置）'}</option>)}</MediaSelect></label>
    <label>内容类型<MediaSelect aria-label="内容类型" value={kind} disabled={busy||!allowed.length} onChange={e=>{setKind(e.currentTarget.value);setSelected([]);setOffset(0);}}>{!allowed.length&&<option value="">暂无可匹配类型</option>}{allowed.map(value=><option key={value} value={value}>{names[value]}</option>)}</MediaSelect></label>
    <label>匹配方式<MediaSelect aria-label="匹配方式" value={matchMode} disabled={busy} onChange={e=>setMatchMode(e.currentTarget.value as 'strong'|'first'|'manual')}><option value="strong">自动匹配唯一强候选</option><option value="first">默认采用第一条候选</option><option value="manual">手动确认每项匹配</option></MediaSelect></label></div>
    {!provider&&<p role="status">当前媒体库没有已配置的匹配来源。请管理员配置支持此类内容的来源后重试。<button disabled={busy} onClick={()=>{setError('');setProviderRetry(value=>value+1);}}>重新检查来源</button></p>}
    <div className="media-scrape-selection-toolbar"><label className="media-scrape-search">筛选作品<input value={query} placeholder="输入标题过滤本页" onInput={e=>setQuery(e.currentTarget.value)}/></label><div><button disabled={busy||loading||!visibleItems.some(item=>!selected.includes(item.id))||selected.length>=500} onClick={()=>setSelected(current=>[...new Set([...current,...visibleItems.map(item=>item.id)])].slice(0,500))}>选择本页</button><button disabled={busy||loading||selectingAll} onClick={()=>void selectAllResults()}>{selectingAll?'正在选择…':'选择全部结果'}</button><button disabled={busy||loading||!visibleItems.some(item=>selected.includes(item.id))} onClick={()=>setSelected(current=>current.filter(id=>!visibleItems.some(item=>item.id===id)))}>取消本页</button><button disabled={busy||!selected.length} onClick={()=>setSelected([])}>清除选择</button></div></div>
    {loading?<p role="status">正在加载作品…</p>:<div className="media-scrape-item-list">{visibleItems.map(item=><label className="media-user-option" key={item.id}><input type="checkbox" disabled={busy||(!selected.includes(item.id)&&selected.length>=500)} checked={selected.includes(item.id)} onChange={e=>setSelected(current=>e.currentTarget.checked?[...current,item.id]:current.filter(id=>id!==item.id))}/><span>{item.title}</span></label>)}{!visibleItems.length&&<p role="status">本页没有匹配的作品。</p>}</div>}
    <div className="media-scrape-selection-footer"><button disabled={loading||offset===0} onClick={()=>setOffset(value=>Math.max(0,value-60))}>上一页</button><span>{total} 项 · 已选 {selected.length}</span><button disabled={loading||offset+60>=total} onClick={()=>setOffset(value=>value+60)}>下一页</button></div>
    <button disabled={busy||loading||jobsState!=='ready'||running||!selected.length||!allowed.includes(kind)} onClick={()=>void action('scrape-jobs',{provider,itemIds:selected,...(matchMode!=='strong'?{matchMode}: {})})}>开始批量匹配</button>
    </details>
    {taskHistory}
    {deleteId&&<FloatingConfirm theme="media" title="删除刮削任务" text="仅删除这条任务及结果记录，已保存的媒体资料和匹配候选保留。" confirmText="删除记录" cancelText="取消" onCancel={()=>setDeleteId('')} onConfirm={()=>{const id=deleteId;setDeleteId('');void action('scrape-jobs/'+encodeURIComponent(id),undefined,'DELETE');}}/>}
  </section>;
}
