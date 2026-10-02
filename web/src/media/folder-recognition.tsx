import {useEffect,useRef,useState} from '../ui/vendor/preact.ts';
import {Settings2} from 'lucide-preact';
import './folder-recognition.css';
import {Modal} from '../ui/modal.tsx';
import {FloatingConfirm} from '../ui/floating-confirm.tsx';
import {MediaSelect} from './select.tsx';
import type {MediaApi} from './api.ts';
type Mode='auto'|'movie'|'series'|'season'|'ignore';
interface Rule {path:string;mode:Mode;title?:string;season?:number|string;year?:number;stripLeadingNumber?:boolean;filePattern?:string}
interface Proposal {assetId:string;ref:string;before:{id:string;title:string;kind:string}|null;status:'ready'|'review'|'protected'|'ignored';reason:string;after:{kind:string;confidence:string;metadata:{title:string;show?:string;season?:number|string;episode?:number}}}
interface Preview {id:string;items:Proposal[]}
const labels:Record<Mode,string>={auto:'自动识别',movie:'电影目录',series:'剧集目录',season:'指定季目录',ignore:'忽略目录'};

export function FolderRecognition({api,libraryId,path,disabled,onBusy,onApplied,menuOnly=false}:{api:MediaApi;libraryId:string;path:string;disabled:boolean;onBusy:(busy:boolean)=>void;onApplied:()=>void;menuOnly?:boolean}){
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [mode,setMode]=useState<Mode|'inherit'>('inherit'),[title,setTitle]=useState(''),[season,setSeason]=useState(''),[year,setYear]=useState(''),[strip,setStrip]=useState(false),[filePattern,setFilePattern]=useState('');
  const [revision,setRevision]=useState(''),[inherited,setInherited]=useState<Rule|null>(null),[preview,setPreview]=useState<Preview|null>(null),[selected,setSelected]=useState<string[]>([]),[confirm,setConfirm]=useState(false),[page,setPage]=useState(0);
  const pending=useRef<AbortController|null>(null);
  useEffect(()=>()=>pending.current?.abort(),[]);
  const base='libraries/'+encodeURIComponent(libraryId);
  async function work(action:(signal:AbortSignal)=>Promise<void>){
    if(pending.current)return;const abort=new AbortController();pending.current=abort;setBusy(true);onBusy(true);setError('');setNotice('');
    try{await action(abort.signal);}catch(error){if(!abort.signal.aborted)setError(error instanceof Error?error.message:'操作失败');}
    finally{if(!abort.signal.aborted){pending.current=null;setBusy(false);onBusy(false);}}
  }
  function show(){setOpen(true);setRevision('');setPreview(null);setSelected([]);void work(async signal=>{
    const result=await api.request<{rule:Rule|null;inherited:Rule|null;revision:string}>(base+'/recognition-rule?'+new URLSearchParams({path}),'GET',undefined,signal);
    if(signal.aborted)return;
    setRevision(result.revision);setInherited(result.inherited);setMode(result.rule?.mode??'inherit');setTitle(result.rule?.title??'');setSeason(result.rule?.season===undefined?'':String(result.rule.season));setYear(result.rule?.year===undefined?'':String(result.rule.year));setStrip(result.rule?.stripLeadingNumber??false);setFilePattern(result.rule?.filePattern??'');setPreview(null);setSelected([]);
  });}
  function invalidate(){setPreview(null);setSelected([]);setNotice('');}
  async function save(signal:AbortSignal){
    const episodic=mode==='series'||mode==='season';
    const rule:Rule|null=mode==='inherit'?null:{path,mode,...(episodic&&title.trim()?{title:title.trim()}:{}),...(episodic&&season.trim()?{season:/^\d+$/.test(season.trim())?Number(season):season.trim()}:{}),...(mode!=='ignore'&&year!==''?{year:Number(year)}:{}),...(filePattern.trim()?{filePattern:filePattern.trim()}:{}),stripLeadingNumber:strip};
    const result=await api.request<{revision:string}>(base+'/recognition-rule','PUT',{path,rule,revision},signal);
    if(!signal.aborted){setRevision(result.revision);setNotice('目录规则已保存。已有作品尚未更改。');}
  }
  const seasonLabel=(season:number|string|undefined)=>typeof season==='number'&&Number.isFinite(season)?`第 ${season} 季`:String(season??'正片');
  const description=(row:Proposal)=>row.after.kind==='ignore'?'跳过扫描':row.after.kind==='episode'?`${row.after.metadata.show} · ${seasonLabel(row.after.metadata.season)}第 ${row.after.metadata.episode} 集`:`电影 · ${row.after.metadata.title}`;
  const selectable=(row:Proposal)=>['ready','review'].includes(row.status);
  const visible=preview?.items.slice(page*30,page*30+30)??[];
  const selectRows=(rows:Proposal[])=>setSelected(current=>[...new Set([...current,...rows.filter(selectable).map(row=>row.assetId)])]);
  return <>
    <>{menuOnly?<button disabled={disabled} onClick={show}><Settings2 size={16} aria-hidden="true"/>识别规则与预览</button>:<div className="media-folder-operation"><span><strong>影视识别</strong><small>设置当前目录及子目录的识别规则</small></span><button disabled={disabled} onClick={show}><Settings2 size={16} aria-hidden="true"/>识别规则与预览</button></div>}</>
    {open&&<Modal className="media-modal" title="目录识别规则" busy={busy} onClose={()=>setOpen(false)}><div className="media-form media-recognition-form">
      <p className="media-folder-note">{path||'库内根目录'} · 包含子目录，子目录自己的规则优先。目录内文件统一应用下方文件正则。规则保存后用于后续扫描；已有作品通过下方预览确认重新识别。</p>
      {inherited&&<p>继承自「{inherited.path||'库内根目录'}」：{labels[inherited.mode]}{inherited.title?' · '+inherited.title:''}</p>}
      {error&&<p className="media-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
      <label>解析类型<MediaSelect aria-label="解析类型" disabled={busy||!revision} value={mode} onChange={e=>{setMode(e.currentTarget.value as Mode|'inherit');invalidate();}}><option value="inherit">继承上级（无上级则自动）</option>{Object.entries(labels).map(([value,label])=><option value={value}>{label}</option>)}</MediaSelect></label>
      {(mode==='series'||mode==='season')&&<>
        <label>剧名<input aria-label="剧名" disabled={busy} maxLength={200} value={title} placeholder="留空使用上级剧名或目录名" onInput={e=>{setTitle(e.currentTarget.value);invalidate();}}/></label>
        <label>{mode==='season'?'季/版本名称（必填）':'默认季/版本名称（可选）'}<input aria-label="季/版本名称" disabled={busy} value={season} placeholder="如：第1季、特别版、4K版、OVA" onInput={e=>{setSeason(e.currentTarget.value);invalidate();}}/></label>
      </>}
      {mode!=='ignore'&&mode!=='inherit'&&<label>目录内文件名解析正则（可选）<input aria-label="目录内文件名解析正则" disabled={busy} maxLength={1000} value={filePattern} placeholder="如：(?<name>[^\\s]+)(?<year>[0-9]{4})(?<order>[0-9]+)" onInput={e=>{setFilePattern(e.currentTarget.value);invalidate();}}/><small>对当前目录及子目录内的所有文件统一应用。支持具名组：name、year、season、episode、order、artist、album、author、narrator、edition 等。</small></label>}
      {mode!=='ignore'&&mode!=='inherit'&&<>
        <label>年份（可选）<input aria-label="年份" disabled={busy} type="number" min={1800} max={2199} value={year} onInput={e=>{setYear(e.currentTarget.value);invalidate();}}/></label>
        <label className="media-recognition-check"><input type="checkbox" disabled={busy} checked={strip} onChange={e=>{setStrip(e.currentTarget.checked);invalidate();}}/>移除文件名开头的排列编号（如 001.；电影年份与续集数字需核对）</label>
      </>}
      {mode==='ignore'&&<p>后续扫描跳过该目录的新文件。已有作品和文件保留，不会因此被标记缺失。</p>}
      <div className="media-toolbar"><button disabled={busy||!revision} onClick={()=>void work(async signal=>{await save(signal);if(!signal.aborted){invalidate();setNotice('目录规则已保存。已有作品尚未更改。');}})}>保存规则</button><button className="media-primary" disabled={busy||!revision} onClick={()=>void work(async signal=>{await save(signal);if(signal.aborted)return;const result=await api.request<Preview>(base+'/recognition-preview','POST',{path},signal);if(!signal.aborted){setPreview(result);setSelected(result.items.filter(row=>row.status==='ready').map(row=>row.assetId));setPage(0);}})}>{busy?'正在处理…':'保存并预览重新识别'}</button></div>
      {preview&&<section className="media-recognition-preview" aria-label="重新识别预览"><h3>识别结果 · {preview.items.length} 个文件</h3><p>待确认结果默认不选；已人工整理、在线确认或共享多版本的作品保留。确认后保留资源、版本和播放片段 ID，已有播放进度与队列继续有效。</p>
        <div className="media-recognition-bulk"><p role="status">已选 {selected.length} / {preview.items.filter(selectable).length} 项（跨页保留）</p><div className="media-toolbar">
          <button disabled={busy||!visible.some(selectable)} onClick={()=>selectRows(visible)}>全选本页</button>
          <button disabled={busy||!preview.items.some(selectable)} onClick={()=>selectRows(preview.items)}>全选可应用项</button>
          <button disabled={busy||!selected.length} onClick={()=>setSelected([])}>清空选择</button>
          <button className="media-primary" disabled={busy||!selected.length} onClick={()=>setConfirm(true)}>应用所选 {selected.length} 项</button>
        </div><p>全选包含待确认结果，请先核对；受保护与忽略项不会选中。</p></div>
        {!preview.items.length&&<p>没有已扫描且可用的资源，请先扫描媒体库。</p>}
        {preview.items.slice(page*30,page*30+30).map(row=><label key={row.assetId} className="media-recognition-row"><input type="checkbox" aria-label={'应用 '+row.ref} disabled={busy||!['ready','review'].includes(row.status)} checked={selected.includes(row.assetId)} onChange={e=>setSelected(e.currentTarget.checked?[...selected,row.assetId]:selected.filter(id=>id!==row.assetId))}/><span><strong>{row.ref}</strong><small>当前：{row.before?.title??'未关联'}</small><b>{description(row)}</b><small>{({ready:'可应用',review:'待确认',protected:'保留现有',ignored:'已忽略'} as const)[row.status]} · {row.reason}</small></span></label>)}
        {preview.items.length>30&&<nav className="media-toolbar" aria-label="识别预览分页"><button disabled={busy||!page} onClick={()=>setPage(page-1)}>上一页</button><span>{page+1} / {Math.ceil(preview.items.length/30)}</span><button disabled={busy||(page+1)*30>=preview.items.length} onClick={()=>setPage(page+1)}>下一页</button></nav>}
      </section>}
    </div></Modal>}
    {confirm&&<FloatingConfirm theme="media" title="确认重新识别" text={`将按预览调整 ${selected.length} 个文件的标题和作品归属。同一剧、季、集的版本可能合并到一个作品，收藏随之保留。不修改原文件，保留播放进度与队列。`} confirmText="应用识别结果" onCancel={()=>setConfirm(false)} onConfirm={()=>{setConfirm(false);void work(async signal=>{await api.request(base+'/recognition-apply','POST',{path,previewId:preview!.id,assetIds:selected},signal);if(!signal.aborted){setOpen(false);onApplied();}});}}/>}
  </>;
}
