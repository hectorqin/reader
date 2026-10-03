import { Fragment, useEffect, useState } from 'react';
import type { MediaApi } from '../api/media-api.ts';
import {MediaLoading} from './loading.tsx';
import {MediaScreenError} from './screen-error.tsx';

interface Resource {
  size:number;available:boolean;probe:{status:string;info:null|{duration:number|null;format:string;streams:Array<{index:number;type:string;codec:string;language?:string;title?:string;width?:number;height?:number;channels?:number;profile?:string;level?:number;pixelFormat?:string;sampleRate?:number}>}};
}
export function ResourceInfo({api,assetId,title,expanded=false}:{api:MediaApi;assetId:string;title?:string;expanded?:boolean}) {
  const [open,setOpen]=useState(expanded),[attempt,setAttempt]=useState(0);
  const [resource,setResource]=useState<Resource|null>(null),[error,setError]=useState('');
  const [cause,setCause]=useState<unknown>();
  useEffect(()=>{
    const controller=new AbortController();
    if(open){setResource(null);setError('');setCause(undefined);void api.request<Resource>('assets/'+encodeURIComponent(assetId),'GET',undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setResource(value);}).catch(error=>{if(!controller.signal.aborted){setError(error instanceof Error?error.message:'读取失败');setCause(error);}});}
    return ()=>controller.abort();
  },[api,assetId,open,attempt]);
  const content=open&&(error?<MediaScreenError error={cause} message={error} busy={false} onRetry={()=>setAttempt(value=>value+1)}/>:!resource?<MediaLoading layout="tracks" count={2} label="正在读取文件信息…"/>:<>
    <dl className="media-resource-facts"><dt>文件状态</dt><dd>{resource.available?'可用':'文件缺失'}</dd><dt>文件大小</dt><dd>{(resource.size/1024/1024).toFixed(1)} MB</dd>
      {resource.probe.info&&<><dt>容器格式</dt><dd>{resource.probe.info.format}</dd>{resource.probe.info.duration!==null&&<><dt>时长</dt><dd>{Math.floor(resource.probe.info.duration/60)} 分 {Math.floor(resource.probe.info.duration%60)} 秒</dd></>}{resource.probe.info.streams.filter(stream=>stream.type==='video'||stream.type==='audio').map(stream=><Fragment key={stream.index}><dt>{stream.type==='video'?'视频':'音频'}</dt><dd>{stream.codec||'未知编码'}{stream.width&&stream.height?' · '+stream.width+' × '+stream.height:''}{stream.channels?' · '+stream.channels+' 声道':''}{stream.language?' · '+stream.language:''}</dd></Fragment>)}</>}
    </dl>
    {resource.probe.info?<details><summary>完整技术参数</summary><ul>{resource.probe.info.streams.map(stream=><li key={stream.index}>{({video:'视频',audio:'音频',subtitle:'字幕'} as Record<string,string>)[stream.type]||stream.type} · {stream.codec||'未知编码'}{stream.width&&stream.height?' · '+stream.width+' × '+stream.height:''}{stream.channels?' · '+stream.channels+' 声道':''}{stream.profile?' · 规格 '+stream.profile:''}{stream.level!==undefined?' · Level '+stream.level:''}{stream.pixelFormat?' · '+stream.pixelFormat:''}{stream.sampleRate?' · '+stream.sampleRate+' Hz':''}{stream.language?' · '+stream.language:''}{stream.title?' · '+stream.title:''}</li>)}</ul></details>:<p>{resource.probe.status==='unavailable'?'服务器未配置 ffprobe，技术信息暂不可用。':'技术信息读取失败，可重新扫描。'}</p>}
    <small>播放兼容性取决于当前设备。</small>
  </>);
  return expanded?<section className="media-resource-info media-resource-expanded"><h3>{title||'文件信息'}</h3>{content}</section>:<details className="media-resource-info" onToggle={event=>setOpen(event.currentTarget.open)}><summary>资源信息{title?' · '+title:''}</summary>{content}</details>;
}
