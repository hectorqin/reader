import {FloatingConfirm} from '../../../ui/floating-confirm.tsx';
import { useEffect, useRef, useState } from 'react';
import type { Library, MediaApi, MediaChannel } from '../api/media-api.ts';
import { newId } from '../../../core/id.ts';
import {ChevronLeft} from 'lucide-react';
import {MediaSelect} from './select.tsx';

const labels = { video: '影视', music: '音乐', audiobook: '有声书' };
export function MediaLibraryCreate({ api, channel, disabled, onCreated, onJobs,onCancel }: {
  api: MediaApi; channel: MediaChannel; disabled: boolean;
  onCreated: (library: Library) => void; onJobs: (id: string) => Promise<void>;
  onCancel?:()=>void;
}) {
  const [kind,setKind]=useState<MediaChannel>(channel),[dirty,setDirty]=useState(false),[leaving,setLeaving]=useState(false);
  const [storage,setStorage]=useState<'local'|'openlist'>('local');
  const [created, setCreated] = useState<Library | null>(null);
  const [scanStarted, setScanStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  const close=()=>{if(busy||disabled)return;if(dirty&&!created){setLeaving(true);return;}onCancel?.();};
  const submission = useRef<{fingerprint: string; requestId: string} | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (pending.current || disabled) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError('');
    try { await action(controller.signal); }
    catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '请求失败，请核对当前状态'); }
    finally { if (pending.current === controller) pending.current = null; if (!controller.signal.aborted) setBusy(false); }
  };
  const scan = async (library: Library, signal: AbortSignal) => {
    await api.request(`libraries/${library.id}/scan`, 'POST', undefined, signal);
    if (signal.aborted) return;
    setScanStarted(true);
    await onJobs(library.id);
  };
  return <section className="media-library-create">
    {onCancel?<header className="media-settings-heading"><button className="media-back-button" data-media-back aria-label="← 返回内容" disabled={busy||disabled} onClick={close}><ChevronLeft size={20} aria-hidden="true"/></button><h1>新建媒体库</h1></header>:<h2>新建{labels[channel]}媒体库</h2>}
    {leaving&&<FloatingConfirm theme="media" title="放弃新建媒体库？" text="媒体库尚未创建，离开后将丢弃已填写的内容。" confirmText="放弃修改" cancelText="继续编辑" onCancel={()=>setLeaving(false)} onConfirm={()=>{setLeaving(false);onCancel?.();}}/>}
    {error && <p className="media-error" role="alert">{error}</p>}
    {created ? <>
      <p role="status">媒体库“{created.name}”已创建。{scanStarted ? '扫描请求已提交，可查看任务结果。' : '尚未确认扫描启动，请先查看任务；如无任务，再启动扫描。'}</p>
      <div className="media-toolbar">
        {!scanStarted && <button disabled={busy || disabled} onClick={() => void run(signal => scan(created, signal))}>启动此库扫描</button>}
        <button disabled={busy || disabled} onClick={() => void run(() => onJobs(created.id))}>查看此库任务</button>
        <button disabled={busy || disabled} onClick={() => { submission.current = null; setCreated(null); setDirty(false); setScanStarted(false); setError(''); }}>继续新建</button>
      </div>
    </> : <form className="media-form" onInput={()=>setDirty(true)} onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      void run(async signal => {
        const input = { name: String(data.get('name') || '').trim(), root: String(data.get('root') || '').trim(), kind, access: data.get('access'), storage,
          ...(storage==='openlist'?{openlist:{baseUrl:String(data.get('baseUrl')||'').trim(),token:String(data.get('token')||'').trim(),password:String(data.get('password')||'')}}:{}) };
        const fingerprint = JSON.stringify(input);
        if (submission.current?.fingerprint !== fingerprint) submission.current = { fingerprint, requestId: newId() };
        const library = await api.request<Library>('libraries', 'POST', { ...input, requestId: submission.current.requestId }, signal);
        if (signal.aborted) return;
        setCreated(library); onCreated(library);
        await scan(library, signal);
      });
    }}>
      <fieldset disabled={busy || disabled} className="media-permission-fields">
        <label>名称<input name="name" placeholder={`例如：${channel==='video'?'家庭影院':channel==='music'?'音乐收藏':'有声书收藏'}`} required maxLength={200}/></label>
        <div className="media-library-fields"><label>内容类型<MediaSelect aria-label="内容类型" value={kind} onChange={event=>{setKind(event.currentTarget.value as MediaChannel);setDirty(true);}}>{Object.entries(labels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</MediaSelect></label><label>接入方式<MediaSelect aria-label="接入方式" value={storage} onChange={event=>{setStorage(event.currentTarget.value as 'local'|'openlist');setDirty(true);}}><option value="local">服务器目录</option><option value="openlist">OpenList</option></MediaSelect></label></div>
        {storage==='openlist'&&<>
          <label>OpenList 服务地址<input name="baseUrl" type="url" placeholder="https://openlist.example.com" required autoComplete="url" spellCheck={false}/></label>
          <div className="media-library-fields"><label>访问令牌<input name="token" type="password" autoComplete="new-password" placeholder="可选，允许访客访问时可留空" spellCheck={false}/></label><label>目录密码<input name="password" type="password" autoComplete="new-password" placeholder="可选，仅密码保护目录需要"/></label></div>
        </>}
        <label>{storage==='openlist'?'远端目录':'服务器目录'}<input key={storage} name="root" placeholder={storage==='openlist'?'/影视':`/media/${kind==='video'?'videos':kind==='music'?'music':'audiobooks'}`} required/></label>
        <p className="media-manager-note">{storage==='openlist'?'填写 OpenList 中的绝对目录路径。服务端读取目录并代理播放；可读取同目录的 NFO、封面、歌词和字幕，暂不读取远程文件的内嵌标签与章节。':'填写服务端可访问的目录，包括已挂载的 NAS。扫描只读取文件，优先读取 NFO、标签和同目录图片。在线匹配可在扫描与刮削页面发起。'}</p>
        <label>访问范围<MediaSelect name="access" aria-label="访问范围"><option value="restricted">仅管理员（之后可授权）</option><option value="all">所有用户</option></MediaSelect></label>
      </fieldset>
      {error && <small>保持表单内容不变重试会恢复同一次创建。若已刷新页面或修改配置，请先核对媒体库列表，避免重复创建。</small>}
      <div className="media-form-footer">{onCancel&&<button type="button" disabled={busy||disabled} onClick={close}>取消</button>}<button className="media-primary" type="submit" disabled={busy || disabled}>{busy ? '正在创建…' : '创建并扫描'}</button></div>
    </form>}
  </section>;
}
