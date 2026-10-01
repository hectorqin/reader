import {FloatingConfirm} from '../ui/floating-confirm.tsx';
import {MediaSelect} from './select.tsx';
import { useEffect, useState, useRef } from '../ui/vendor/preact.ts';
import {ChevronLeft,Search} from 'lucide-preact';
import type { ManagedUser } from '../api/types.ts';
import type { Library, MediaApi } from './api.ts';
import {MediaLoading} from './loading.tsx';
import {MediaScreenError} from './screen-error.tsx';
import {ApiError} from '../api/errors.ts';

export function MediaPermissions({api,library,onSaved,onCancel}:{api:MediaApi;library:Library;onSaved:(access:Library['access'])=>void;onCancel:()=>void}) {
  const [users,setUsers]=useState<ManagedUser[]>([]);
  const [selected,setSelected]=useState<string[]>([]);
  const [access,setAccess]=useState<Library['access']>('restricted');
  const [filter,setFilter]=useState('');
  const [page,setPage]=useState(0),[cause,setCause]=useState<unknown>();
  const [ready,setReady]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  const [leaving,setLeaving]=useState(false);
  const pending=useRef<AbortController|null>(null),original=useRef('');
  const userList=useRef<HTMLDivElement>(null);
  const changePage=(value:number)=>{setPage(value);userList.current?.scrollIntoView?.({block:'start'});};
  const fingerprint=(scope:Library['access'],ids:string[])=>JSON.stringify([scope,[...ids].sort()]);
  const close=()=>{if(saving)return;if(ready&&original.current!==fingerprint(access,selected)){setLeaving(true);return;}onCancel();};
  const visibleUsers=users.filter(user=>(user.username+' '+user.displayName).toLowerCase().includes(filter.trim().toLowerCase()));
  const pages=Math.max(1,Math.ceil(visibleUsers.length/30)),current=Math.min(page,pages-1),pageUsers=visibleUsers.slice(current*30,(current+1)*30);
  useEffect(()=>{
    const controller=new AbortController();setReady(false);setError('');setCause(undefined);
    void Promise.all([api.users(),api.request<{access:Library['access'];userIds:string[]}>(`libraries/${library.id}/configuration`,'GET',undefined,controller.signal)])
      .then(([people,config])=>{if(!controller.signal.aborted){setUsers(people.users);setSelected(config.userIds);setAccess(config.access);original.current=fingerprint(config.access,config.userIds);setReady(true);}})
      .catch(error=>{if(!controller.signal.aborted){setError(error instanceof Error?error.message:'权限加载失败');setCause(error);}});
    return ()=>{controller.abort();pending.current?.abort();};
  },[api,library.id,attempt]);
  const save=async()=>{
    if(pending.current||!ready)return;
    const controller=new AbortController();pending.current=controller;
    setSaving(true);setError('');
    try {await api.request(`libraries/${library.id}/access`,'PUT',{access,userIds:selected},controller.signal);if(!controller.signal.aborted)onSaved(access);}
    catch(error){if(!controller.signal.aborted)setError(error instanceof ApiError&&error.kind==='offline'?'无法连接服务器，请检查连接。当前选择已保留，可以重新保存。':error instanceof ApiError&&error.code==='ADMIN_REQUIRED'?'需要管理员权限才能保存。当前选择已保留。':error instanceof Error?error.message:'保存失败');}
    finally {if(pending.current===controller)pending.current=null;if(!controller.signal.aborted)setSaving(false);}
  };
  return <section className="media-permissions-page"><header className="media-settings-heading"><button className="media-back-button" data-media-back aria-label="返回媒体库" disabled={saving} onClick={close}><ChevronLeft size={20} aria-hidden="true"/></button><h1>访问权限</h1></header>
    {leaving&&<FloatingConfirm theme="media" title="放弃访问权限修改？" text="访问权限尚未保存，离开后将丢弃本次选择。" confirmText="放弃修改" cancelText="继续编辑" onCancel={()=>setLeaving(false)} onConfirm={()=>{setLeaving(false);onCancel();}}/>}
    <form className="media-form media-permissions-form" aria-label="媒体库访问权限" onSubmit={event=>{event.preventDefault();if(ready&&!saving)void save();}}>
    <div className="media-permissions-intro"><h2>{library.name}</h2><p>允许访问的用户共享作品资料，收藏与进度各自独立。</p></div>
    {error&&(ready?<div role="alert" className="media-error">{error}</div>:<MediaScreenError fullPage error={cause} message={error} busy={false} onRetry={()=>setAttempt(value=>value+1)}/>)}
    {!ready&&!error&&<MediaLoading layout="list" square count={4} label="正在加载用户与授权…"/>}
    {ready&&<fieldset disabled={saving} className="media-permission-fields">
      <label>访问范围<MediaSelect aria-label="访问范围" value={access} onChange={event=>setAccess(event.currentTarget.value as Library['access'])}><option value="all">所有用户</option><option value="restricted">指定用户</option></MediaSelect></label>
      <p>{access==='all'?'保存后所有已启用用户均可访问。下方为预选名单，不限制当前访问范围，切换为指定用户时使用。':selected.length?'保存后管理员和名单中已启用的用户可以访问。':'保存后仅管理员可以访问。'}</p>
      <label className="media-user-search"><Search size={17} aria-hidden="true"/><input aria-label="查找用户" type="search" value={filter} placeholder="查找用户名或显示名称" onInput={event=>{setFilter(event.currentTarget.value);setPage(0);}}/></label>
      <small>{access==='all'?'已预选':'已选择'} {selected.length} 位用户 · {filter.trim()?'找到':'共'} {visibleUsers.length} 位用户</small>
      <div className="media-permission-users" ref={userList}>{pageUsers.map(user=><label className="media-user-option" key={user.id}><input type="checkbox" checked={user.role==='admin'||selected.includes(user.id)} disabled={user.role==='admin'||user.disabled&&!selected.includes(user.id)} onChange={event=>setSelected(current=>event.currentTarget.checked?[...new Set([...current,user.id])]:current.filter(id=>id!==user.id))}/><span>{user.displayName||user.username}<small>@{user.username}{user.disabled?' · 已停用':''}{user.role==='admin'?' · 管理员 · 始终可访问':' · 普通用户'}</small></span></label>)}{!visibleUsers.length&&<p role="status">{filter.trim()?'没有匹配的用户，已选名单保留。':'暂无可选择的普通用户。'}</p>}</div>
      {pages>1&&<nav className="media-toolbar media-permission-pagination" aria-label="用户分页"><button type="button" disabled={saving||current===0} onClick={()=>changePage(current-1)}>上一页</button><span>{current+1} / {pages}</span><button type="button" disabled={saving||current+1>=pages} onClick={()=>changePage(current+1)}>下一页</button></nav>}
      <small>管理员始终可以访问。已停用用户不能新增授权。</small>
    </fieldset>}
    {ready&&<div className="media-toolbar media-form-footer"><button type="button" disabled={saving} onClick={close}>取消</button><button className="media-primary" type="submit" disabled={saving}>{saving?'正在保存…':'保存权限'}</button></div>}
  </form></section>;
}
