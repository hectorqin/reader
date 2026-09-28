import { useEffect, useLayoutEffect, useRef, useState } from '../ui/vendor/preact.ts';
import type { Detail, MediaApi } from './api.ts';
import {ApiError} from '../api/errors.ts';

const labels:Record<string,string>={title:'标题',plot:'简介',year:'年份',artist:'歌手',albumArtist:'专辑歌手',album:'专辑',author:'作者',narrator:'演播者'};
const kindLabels:Record<string,string>={movie:'电影',series:'剧集',season:'季',episode:'单集',artist:'歌手',album:'专辑',track:'曲目',audiobook:'有声书'};
const fieldsFor=(kind:string)=>['title','year',...(['artist','album','track'].includes(kind)?['artist','albumArtist','album']:kind==='audiobook'?['author','narrator']:[]),'plot'];
const valueOf=(item:Detail,field:string)=>String(item.overrides[field]??(field==='title'?item.title:item.metadata[field])??'');
const sourceLabels:Record<string,string>={rule:'目录识别规则',filename:'文件名识别',tag:'文件内嵌标签',nfo:'本地 NFO 文件',tmdb:'TMDB 在线资料',musicbrainz:'MusicBrainz 在线资料'};
const baseSource=(item:Detail,field:string)=>{
  if(item.metadata[field]===undefined||item.metadata[field]===null||item.metadata[field]==='')return '暂无信息';
  const source=(item.metadata.sources as Record<string,unknown>|undefined)?.[field];
  return typeof source==='string'&&Object.hasOwn(sourceLabels,source)?sourceLabels[source]!:'来源未标注';
};

export interface MetadataEditState {dirty:boolean;busy:boolean}
export function MetadataEditor({api,item,onUpdated,onStateChange}:{api:MediaApi;item:Detail;onUpdated:(item:Detail)=>void;onStateChange?:(state:MetadataEditState)=>void}) {
  const [changes,setChanges]=useState<Record<string,string|null>>({});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const pending=useRef<AbortController|null>(null);
  const dirty=Object.entries(changes).some(([field,value])=>value===null?Object.hasOwn(item.overrides,field):value!==valueOf(item,field));
  const overrideFields=fieldsFor(item.kind).filter(field=>Object.hasOwn(item.overrides,field));
  useEffect(()=>{onStateChange?.({dirty,busy});},[dirty,busy,onStateChange]);
  useLayoutEffect(()=>{
    setChanges({});setError('');setBusy(false);
    return ()=>{pending.current?.abort();pending.current=null;};
  },[api,item]);
  const save=async()=>{
    const patch:Record<string,string|number|null>={};
    for(const [field,value] of Object.entries(changes)) {
      if(value!==null&&value===valueOf(item,field))continue;
      if(field==='year'&&value!==null){
        if(!/^\d{1,4}$/.test(value)){setError('年份请输入 0–9999 的整数，或使用“撤销人工修正”。');return;}
        patch[field]=Number(value);
      }else patch[field]=value;
    }
    if(!Object.keys(patch).length){setChanges({});return;}
    const controller=new AbortController();pending.current=controller;setBusy(true);setError('');
    try {const updated=await api.request<Detail>('items/'+item.id+'/metadata','PATCH',patch,controller.signal);if(!controller.signal.aborted){setChanges({});onUpdated(updated);}}
    catch(error){if(!controller.signal.aborted)setError(error instanceof ApiError&&error.kind==='offline'?'无法连接服务器，当前修改已保留。请检查连接后重新保存。':error instanceof ApiError&&error.code==='ADMIN_REQUIRED'?'需要管理员权限才能保存。当前修改已保留。':error instanceof Error?error.message:'保存失败');}
    finally {if(!controller.signal.aborted)setBusy(false);}
  };
  return <form className="media-form media-metadata-editor" onSubmit={event=>{event.preventDefault();if(!busy)void save();}}>
    <h2>编辑元数据</h2>
    <p>修改字段后作为人工修正保存，重新扫描不会覆盖它。</p>
    <div className="media-metadata-fields">{fieldsFor(item.kind).map(field=>{
      const reset=changes[field]===null;
      const value=reset?String(item.metadata[field]??''):changes[field]??valueOf(item,field);
      const source=Object.hasOwn(item.overrides,field)?'人工修正':baseSource(item,field);
      return <div className={'media-metadata-field'+(['title','plot'].includes(field)?' media-metadata-wide':'')+(field==='title'?' media-metadata-title':'')} key={field}><label><span className="media-metadata-field-label">{labels[field]}{field==='title'&&<span className="media-metadata-priority" aria-hidden="true">人工优先</span>}</span>{field==='plot'?<textarea value={value} disabled={busy||reset} maxLength={32000} onInput={event=>setChanges(current=>({...current,[field]:event.currentTarget.value}))}/>:<input aria-label={labels[field]} value={value} required={field==='title'&&!reset} disabled={busy||reset} inputMode={field==='year'?'numeric':undefined} maxLength={field==='year'?4:32000} onInput={event=>setChanges(current=>({...current,[field]:event.currentTarget.value}))}/>}</label><div className="media-metadata-field-source"><small>{reset?'保存后恢复：'+baseSource(item,field):'当前来源：'+source}</small>{Object.hasOwn(item.overrides,field)&&<><p className="media-metadata-original" title={String(item.metadata[field]??'')}>来源值：{String(item.metadata[field]??'')||'暂无信息'}</p><button type="button" disabled={busy} onClick={()=>setChanges(current=>{const next={...current};if(reset)delete next[field];else next[field]=null;return next;})}>{reset?'保留人工修正':'撤销人工修正'}</button></>}</div></div>;
    })}<div className="media-metadata-kind"><span>作品类型</span><strong>{kindLabels[item.kind]||item.kind}</strong><small>由媒体库和作品结构确定</small></div></div>
    {error&&<p role="alert" className="media-error">{error}</p>}
    <div className="media-metadata-footer"><button type="submit" className="media-primary" disabled={busy||!dirty}>{busy?'正在保存…':'保存修改'}</button><button type="button" disabled={busy||(!dirty&&!overrideFields.length)} onClick={()=>setChanges(Object.fromEntries(overrideFields.map(field=>[field,null])))}>恢复来源值</button></div>
  </form>;
}
