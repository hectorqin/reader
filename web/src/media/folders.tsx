import {FolderRecognition} from './folder-recognition.tsx';
import {FolderCleanup} from './folder-cleanup.tsx';
import {MediaSelect} from './select.tsx';
import {useEffect,useRef,useState} from '../ui/vendor/preact.ts';
import {Folder,FolderOpen,File,ChevronRight,ChevronLeft,ArrowUpRight} from 'lucide-preact';
import type {Detail,MediaApi,Part} from './api.ts';
import {EditionDetails,type ChapterPosition} from './edition-details.tsx';
import {ResourceInfo} from './resource-info.tsx';
import {MediaLoading} from './loading.tsx';
import {MediaScreenError} from './screen-error.tsx';
import {ApiError} from '../api/errors.ts';
interface Entry {name:string;path:string;kind:'folder'|'file';assetId:string|null;files:number;availableFiles:number;size:number}
interface Listing {path:string;total:number;items:Entry[]}
interface FileDetail {assetId:string;path:string;available:boolean;items:Detail[]}
export interface FolderLocation {path:string;offset:number;assetId:string|null;editions:Record<string,string>;chapters:Record<string,ChapterPosition>}
function FileWork({api,item,busy,selected,onSelect,positions,onPosition,onPlay,onQueue,onDetail,onRefresh}:{api:MediaApi;item:Detail;busy:boolean;selected:string;onSelect:(id:string)=>void;positions:Record<string,ChapterPosition>;onPosition:(id:string,position:ChapterPosition)=>void;onPlay:(parts:Part[],index:number)=>void;onQueue:(ids:string[])=>void;onDetail:()=>void;onRefresh:()=>void}){
  const edition=item.editions.find(value=>value.id===selected)||item.editions[0];
  return <section className="media-folder-work"><div className="media-folder-work-heading"><h3>{item.title}</h3><button aria-label="完整作品详情" title="完整作品详情" disabled={busy} onClick={onDetail}><ArrowUpRight size={18} aria-hidden="true"/><span>作品详情</span></button></div>
    {item.editions.length>1&&<label className="media-edition-picker">此文件的版本<MediaSelect aria-label={item.title+' 文件版本'} value={edition?.id} disabled={busy} onChange={event=>onSelect(event.currentTarget.value)}>{item.editions.map(value=><option key={value.id} value={value.id}>{value.label}</option>)}</MediaSelect></label>}
    {edition&&<EditionDetails key={edition.id} api={api} item={item} edition={edition} busy={busy} showTools={false} position={positions[edition.id]??{query:'',page:0}} onPositionChange={position=>onPosition(edition.id,position)} onPlay={onPlay} onQueue={onQueue} onRefresh={onRefresh} onChooseVersion={onDetail}/>}
  </section>;
}
export function MediaFolders({api,admin=false,video=false,libraryId,initialLocation,onLocationChange,onPlay,onQueue,onDetail}:{api:MediaApi;admin?:boolean;video?:boolean;libraryId:string;initialLocation?:FolderLocation|undefined;onLocationChange?:(location:FolderLocation)=>void;onPlay:(parts:Part[],index:number,title:string)=>Promise<void>;onQueue:(ids:string[])=>Promise<void>;onDetail:(id:string,location:FolderLocation)=>void}){
  const [path,setPath]=useState(initialLocation?.path??''),[offset,setOffset]=useState(initialLocation?.offset??0),[assetId,setAssetId]=useState<string|null>(initialLocation?.assetId??null),[retry,setRetry]=useState(0);
  const [editions,setEditions]=useState(initialLocation?.editions??{}),[chapters,setChapters]=useState(initialLocation?.chapters??{});
  const [listing,setListing]=useState<Listing|null>(null),[file,setFile]=useState<FileDetail|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [loading,setLoading]=useState(true),[cause,setCause]=useState<unknown>(),[actionError,setActionError]=useState('');
  const [cleanupNotice,setCleanupNotice]=useState('');
  const generation=useRef(0);
  useEffect(()=>{
    const abort=new AbortController();++generation.current;setLoading(true);setListing(null);setFile(null);setError('');setCause(undefined);setActionError('');setNotice('');setBusy(false);
    void (async()=>{try{
      if(assetId){const result=await api.request<FileDetail>('assets/'+encodeURIComponent(assetId)+'/catalog','GET',undefined,abort.signal);if(!abort.signal.aborted)setFile(result);}
      else{const query=new URLSearchParams({path,offset:String(offset),limit:'60'});const result=await api.request<Listing>('libraries/'+encodeURIComponent(libraryId)+'/folders?'+query,'GET',undefined,abort.signal);if(!abort.signal.aborted){if(offset>0&&offset>=result.total)setOffset(Math.max(0,Math.floor((result.total-1)/60)*60));else setListing(result);}}
    }catch(error){if(!abort.signal.aborted){setError(error instanceof Error?error.message:'无法读取文件夹');setCause(error);}}finally{if(!abort.signal.aborted)setLoading(false);}})();
    return ()=>{abort.abort();++generation.current;};
  },[api,libraryId,path,offset,assetId,retry]);
  useEffect(()=>{onLocationChange?.({path,offset,assetId,editions,chapters});},[path,offset,assetId]);
  function open(next:string){setCleanupNotice('');setPath(next);setOffset(0);setAssetId(null);}
  async function action(run:()=>Promise<void>,queue=false){if(busy)return;const current=generation.current;setBusy(true);setActionError('');setNotice('');try{await run();if(current===generation.current)setNotice(queue?'已加入队列':'');}catch(error){if(current===generation.current)setActionError((error instanceof ApiError&&error.kind==='offline'?'无法连接服务器':error instanceof Error?error.message:'操作失败')+(queue?'。加入结果尚未确认，请先到待播队列核对，再决定是否重新添加。':'。可以重新选择章节播放。'));}finally{if(current===generation.current)setBusy(false);}}
  const segments=path?path.split('/'):[];
  return <section className="media-folders" aria-label="影音文件夹">
    <nav className="media-folder-path" aria-label="目录位置"><button disabled={busy} onClick={()=>open('')}>库内根目录</button>{segments.map((segment,index)=><button key={index} disabled={busy} onClick={()=>open(segments.slice(0,index+1).join('/'))}>/ {segment}</button>)}</nav>
    {(path||assetId)&&<button className="media-folder-back" disabled={busy} aria-label={'← '+(assetId?'返回文件列表':'上级目录')} onClick={()=>assetId?setAssetId(null):open(segments.slice(0,-1).join('/'))}><ChevronLeft size={16} aria-hidden="true"/>{assetId?'返回文件列表':'上级目录'}</button>}
    {error&&<MediaScreenError fullPage error={cause} message={error} busy={loading} retryLabel="重新加载" onRetry={()=>setRetry(value=>value+1)}/>}{actionError&&<div className="media-error" role="alert">{actionError}</div>}{notice&&<p role="status">{notice}</p>}
    {loading&&<MediaLoading layout={assetId?'tracks':'list'} square label={assetId?'正在读取文件与章节…':'正在读取目录…'}/>}
    {listing&&admin&&<button disabled={busy||loading} onClick={()=>void action(async()=>{await api.aiFolderScan(libraryId,path);setCleanupNotice('AI 扫描任务已创建，请到“扫描与刮削 → AI 扫描任务”查看进度和每批返回结果。');})}>{busy?'正在提交…':'AI 扫描当前目录'}</button>}
    {cleanupNotice&&<p role="status">{cleanupNotice}</p>}
    {listing&&<>{admin&&video&&<FolderRecognition key={libraryId+'-rules-'+path} api={api} libraryId={libraryId} path={path} disabled={busy||loading} onBusy={setBusy} onApplied={()=>{setCleanupNotice('已应用识别结果，原文件与播放进度保留。');setRetry(value=>value+1);}}/>}{admin&&<FolderCleanup key={libraryId+'-'+path} api={api} libraryId={libraryId} path={path} disabled={busy||loading} onBusy={setBusy} onCleaned={result=>{setCleanupNotice('已清理 '+result.assets+' 个失效资源记录'+(result.returnPath!==path?'，已返回上级有效目录。':'。'));setPath(result.returnPath);setOffset(0);setRetry(value=>value+1);}}/>}{listing.items.map(entry=><div className="media-row media-folder-row" key={entry.path}><button disabled={busy} onClick={()=>entry.kind==='folder'?open(entry.path):setAssetId(entry.assetId)}>{entry.kind==='folder'?<Folder size={21} strokeWidth={1.5} aria-hidden="true"/>:<File size={21} strokeWidth={1.5} aria-hidden="true"/>}<span><strong>{entry.name}</strong><small>{entry.kind==='folder'?`${entry.files} 个媒体文件 · ${entry.availableFiles} 个可用`:`${(entry.size/1024/1024).toFixed(1)} MB · ${entry.availableFiles?'文件可用':'文件缺失'}`}</small></span><ChevronRight size={17} aria-hidden="true"/></button></div>)}{!listing.total&&<p className="media-empty">暂无已扫描媒体文件，请先扫描媒体库。</p>}{listing.total>60&&<nav className="media-toolbar" aria-label="文件分页"><button disabled={busy||!offset} onClick={()=>setOffset(Math.max(0,offset-60))}>上一页</button><span>{Math.floor(offset/60)+1} / {Math.ceil(listing.total/60)}</span><button disabled={busy||offset+60>=listing.total} onClick={()=>setOffset(offset+60)}>下一页</button></nav>}<p className="media-folder-note">按最近扫描结果显示媒体文件；不包含空目录及其他文件。原始目录只读。</p></>}
    {file&&<><header className="media-folder-file-heading"><File size={27} strokeWidth={1.4} aria-hidden="true"/><div><h2>{file.path.split('/').at(-1)}</h2><small>{file.available?'文件可用':'文件已缺失'} · {file.items.length} 部关联作品</small></div></header>
      <div className="media-folder-file-layout"><div>{file.items.map(item=><FileWork key={file.assetId+'-'+item.id} api={api} item={item} busy={busy} selected={editions[item.id]??''} onSelect={id=>setEditions({...editions,[item.id]:id})} positions={chapters} onPosition={(id,position)=>setChapters({...chapters,[id]:position})} onDetail={()=>onDetail(item.id,{path,offset,assetId,editions,chapters})} onRefresh={()=>setRetry(value=>value+1)} onPlay={(parts,index)=>void action(()=>onPlay(parts,index,item.title))} onQueue={ids=>void action(()=>onQueue(ids),true)}/>)}{!file.items.length&&<div className="media-folder-unlinked"><FolderOpen size={30} strokeWidth={1.4} aria-hidden="true"/><h3>暂未关联作品</h3><p>{file.available?'请管理员重新扫描媒体库，读取文件资料。':'恢复文件并重新扫描后可播放。'}</p></div>}</div><aside className="media-folder-file-resources"><h2>文件信息</h2><ResourceInfo key={file.assetId} api={api} assetId={file.assetId}/><p className="media-folder-note">仅显示此文件关联的版本片段。完整章节和其他文件中的版本，请打开作品详情。原始文件只读。</p></aside></div></>}
  </section>;
}
