import {ApiError} from '../api/errors.ts';
import {CloudOff,FolderX,LockKeyhole,TriangleAlert} from 'lucide-preact';

export function MediaScreenError({error,message,busy,onRetry,onBack,fullPage=false,retryLabel='重试',backLabel='返回频道'}:{error:unknown;message:string;busy:boolean;onRetry:()=>void;onBack?:(()=>void)|undefined;fullPage?:boolean;retryLabel?:string;backLabel?:string}){
  let title='',hint='';
  if(error instanceof ApiError){
    if(error.code==='MEDIA_STARTING'){
      title='影音服务正在准备';hint='稍后可重新读取，阅读功能仍可使用。';
    }else if(error.code==='MEDIA_UNAVAILABLE'){
      title='影音服务暂不可用';hint='请管理员检查影音服务日志，恢复后重新读取。';
    }else if(error.kind==='offline'){
      title='无法连接服务器';hint='请检查网络和服务器连接后重试。';
    }else if(error.kind==='forbidden'&&error.code==='ADMIN_REQUIRED'){
      title='需要管理员权限';hint='此功能仅管理员可用，可以返回继续浏览已授权的内容。';
    }else if(error.kind==='forbidden'&&!error.isAuthFailure){
      title='没有访问权限';hint='可联系管理员确认媒体库授权，或返回浏览其他内容。';
    }else if(error.kind==='not_found'){
      title='内容已不可用';hint='内容可能已移除，可返回浏览其他作品。';
    }
  }
  const Icon=error instanceof ApiError&&error.kind==='offline'?CloudOff:error instanceof ApiError&&error.kind==='not_found'?FolderX:error instanceof ApiError&&error.kind==='forbidden'&&!error.isAuthFailure?LockKeyhole:TriangleAlert;
  const detail=error instanceof ApiError&&error.kind==='offline'?'暂时无法获取内容。':error instanceof ApiError&&error.code==='ADMIN_REQUIRED'?'当前账号无法读取此内容。':message;
  if(fullPage){
    const forbidden=error instanceof ApiError&&error.kind==='forbidden'&&!error.isAuthFailure&&error.code!=='ADMIN_REQUIRED';
    const unavailable=error instanceof ApiError&&(error.kind==='offline'||error.code==='MEDIA_UNAVAILABLE');
    return <section className="media-error media-screen-error is-page" role="alert">
      <span className="media-state-icon">{forbidden?<LockKeyhole size={30} strokeWidth={1.7} aria-hidden="true"/>:<TriangleAlert size={30} strokeWidth={1.7} aria-hidden="true"/>}</span>
      <strong>{forbidden?'暂时无法访问这部作品':unavailable?'暂时连接不上服务':title||'读取内容失败'}</strong>
      <p>{forbidden?'你的账号没有当前媒体库的访问权限。可以返回频道选择其他内容。':unavailable?'媒体内容不会丢失。请检查服务是否运行，连接恢复后重试。':hint||detail}</p>
      <div className="media-screen-error-actions">{forbidden&&onBack?<button type="button" className="media-primary" onClick={onBack}>{backLabel}</button>:<button type="button" className="media-primary" disabled={busy} onClick={onRetry}>{unavailable?'重新连接':retryLabel}</button>}</div>
    </section>;
  }
  return <div className={'media-error media-screen-error'+(fullPage?' is-page':'')} role="alert">
    {fullPage&&<Icon size={38} strokeWidth={1.4} aria-hidden="true"/>}
    {(title||fullPage)&&<strong>{title||'读取内容失败'}</strong>}
    <p>{detail}</p>{hint&&<p>{hint}</p>}
    <div className="media-screen-error-actions"><button type="button" className={fullPage?'media-primary':undefined} disabled={busy} onClick={onRetry}>{retryLabel}</button>{onBack&&<button type="button" onClick={onBack}>{backLabel}</button>}</div>
  </div>;
}
