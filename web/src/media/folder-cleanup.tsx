import {useEffect,useRef,useState} from '../ui/vendor/preact.ts';
import {Trash2} from 'lucide-preact';
import {FloatingConfirm} from '../ui/floating-confirm.tsx';
import type {MediaApi} from './api.ts';

export interface CleanupPreview {
  path:string;revision:string;assets:number;parts:number;editions:number;items:number;favorites:number;progress:number;queue:number;
}
export interface CleanupResult extends CleanupPreview {returnPath:string}

export function FolderCleanup({api,libraryId,path,disabled,onBusy,onCleaned}:{
  api:MediaApi;libraryId:string;path:string;disabled:boolean;onBusy:(busy:boolean)=>void;onCleaned:(result:CleanupResult)=>void;
}){
  const [preview,setPreview]=useState<CleanupPreview|null>(null),[message,setMessage]=useState(''),[error,setError]=useState('');
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>{request.current?.abort();},[]);
  async function run(remove=false){
    if(disabled||request.current)return;
    const abort=new AbortController();request.current=abort;onBusy(true);setError('');setMessage('');setPreview(null);
    try{
      const base='libraries/'+encodeURIComponent(libraryId)+'/missing-resources';
      if(remove&&preview){
        const result=await api.request<CleanupResult>(base+'/cleanup','POST',{path,revision:preview.revision},abort.signal);
        if(!abort.signal.aborted)onCleaned(result);
      }else{
        const result=await api.request<CleanupPreview>(base+'?'+new URLSearchParams({path}),'GET',undefined,abort.signal);
        if(!abort.signal.aborted){if(result.assets)setPreview(result);else setMessage('当前目录及子目录没有已标记缺失的资源。');}
      }
    }catch(error){if(!abort.signal.aborted)setError((error instanceof Error?error.message:'清理失败')+(remove?'。请重新预览，核对当前记录后再操作。':''));}
    finally{if(!abort.signal.aborted){request.current=null;onBusy(false);}}
  }
  return <>
    <div className="media-folder-operation"><span><strong>失效资源</strong><small>检查当前目录及子目录的缺失记录</small></span><button disabled={disabled} onClick={()=>void run()}><Trash2 size={16} aria-hidden="true"/>清理失效资源</button></div>
    {message&&<p role="status">{message}</p>}{error&&<p className="media-error" role="alert">{error}</p>}
    {preview&&<FloatingConfirm theme="media" title="清理失效资源" confirmText="确认清理" cancelText="取消" onCancel={()=>setPreview(null)} onConfirm={()=>void run(true)} text={`清理「${path||'库内根目录'}」及其子目录中的 ${preview.assets} 个缺失文件记录。将移除 ${preview.parts} 个播放片段、${preview.editions} 个空版本和 ${preview.items} 个空作品/分类，以及所有用户关联的 ${preview.favorites} 条收藏、${preview.progress} 条播放进度和 ${preview.queue} 条队列记录。不会删除原始文件或仍有资源的作品。此操作不可撤销；如目录暂未挂载，请取消并在恢复后重新扫描。`}/>}
  </>;
}
