import {FloatingConfirm} from '../../../ui/floating-confirm.tsx';
import { useEffect, useRef, useState } from 'react';
import type { Library, LibraryConfiguration, MediaApi } from '../api/media-api.ts';
import {ChevronLeft} from 'lucide-react';

type Configuration = LibraryConfiguration;
const kinds = { video: '影视', music: '音乐', audiobook: '有声书' };

export function MediaLibraryEditor({ api, library, onSaved, onCancel }: {
  api: MediaApi; library: Library; onSaved: (library: Library) => void; onCancel: () => void;
}) {
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [name, setName] = useState(library.name);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [token,setToken]=useState(''),[password,setPassword]=useState('');
  const [clearToken,setClearToken]=useState(false),[clearPassword,setClearPassword]=useState(false);
  const [leaving,setLeaving]=useState(false);
  const close=()=>{if(saving)return;if(configuration&&(name!==configuration.name||token||password||clearToken||clearPassword)){setLeaving(true);return;}onCancel();};
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setConfiguration(null); setError('');setToken('');setPassword('');setClearToken(false);setClearPassword(false);
    void api.request<Configuration>(`libraries/${library.id}/configuration`, 'GET', undefined, controller.signal)
      .then(config => { if (!controller.signal.aborted) { setConfiguration(config); setName(config.name); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '媒体库配置读取失败'); });
    return () => { controller.abort(); pending.current?.abort(); };
  // The runtime owns one MediaApi instance for the lifetime of the app. Keeping
  // it out of this dependency list also prevents a parent render that creates a
  // thin adapter object from resetting an in-progress edit.
  }, [library.id, attempt]);

  const save = async () => {
    if (!configuration || pending.current || !name.trim()) return;
    const controller = new AbortController(); pending.current = controller;
    setSaving(true); setError('');
    try {
      const credentials={...(clearToken?{token:''}:token.trim()?{token:token.trim()}:{}),...(clearPassword?{password:''}:password?{password}:{})};
      const updated = await api.request<Library>(`libraries/${library.id}`, 'PATCH', { name: name.trim(),...(configuration.storage==='openlist'&&Object.keys(credentials).length?{openlist:credentials}:{}) }, controller.signal);
      if (!controller.signal.aborted) onSaved(updated);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '保存失败，请重试');
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  };

  return <section className="media-library-workspace"><header className="media-settings-heading"><button className="media-back-button" data-media-back aria-label="返回媒体库" disabled={saving} onClick={close}><ChevronLeft size={20} aria-hidden="true"/></button><h1>编辑媒体库</h1></header>
    {leaving&&<FloatingConfirm theme="media" title="放弃媒体库修改？" text="媒体库修改尚未保存，离开后将丢弃本次修改。" confirmText="放弃修改" cancelText="继续编辑" onCancel={()=>setLeaving(false)} onConfirm={()=>{setLeaving(false);onCancel();}}/>}
    <form className="media-form media-library-editor" aria-label="媒体库配置" onSubmit={event => { event.preventDefault(); void save(); }}>
    {error && <div role="alert" className="media-error">{error}{!configuration && <button type="button" onClick={() => setAttempt(value => value + 1)}>重试读取配置</button>}</div>}
    {!configuration && !error && <p role="status">正在读取媒体库配置…</p>}
    <label>媒体库名称<input name="name" required maxLength={200} value={name} disabled={!configuration || saving} onInput={event => setName(event.currentTarget.value)}/></label>
    {configuration && <>
      <div className="media-library-fields"><div><span>内容类型</span><p className="media-readonly-field">{kinds[configuration.kind]}</p></div><div><span>接入方式</span><p className="media-readonly-field">{configuration.storage==='openlist'?'OpenList':'服务器目录'}</p></div></div>
      {configuration.storage==='openlist'&&<div className="media-library-field"><span>OpenList 服务地址</span><p className="media-readonly-field media-library-path">{configuration.openlist?.baseUrl}</p></div>}
      <div className="media-library-field"><span>{configuration.storage==='openlist'?'远端目录':'服务器目录'}</span><p className="media-readonly-field media-library-path">{configuration.root}</p></div>
      {configuration.storage==='openlist'&&<fieldset disabled={saving} className="media-permission-fields media-openlist-credentials"><legend>访问凭据</legend>
        <label>访问令牌<input name="token" type="password" autoComplete="new-password" value={token} disabled={clearToken} placeholder={configuration.openlist?.hasToken?'已配置，留空保留原令牌':'未配置，可选填'} onInput={event=>setToken(event.currentTarget.value)}/></label>
        {configuration.openlist?.hasToken&&<label className="media-credential-clear"><input type="checkbox" checked={clearToken} onChange={event=>setClearToken(event.currentTarget.checked)}/>清除已保存的令牌</label>}
        <label>目录密码<input name="password" type="password" autoComplete="new-password" value={password} disabled={clearPassword} placeholder={configuration.openlist?.hasPassword?'已配置，留空保留原密码':'未配置，可选填'} onInput={event=>setPassword(event.currentTarget.value)}/></label>
        {configuration.openlist?.hasPassword&&<label className="media-credential-clear"><input type="checkbox" checked={clearPassword} onChange={event=>setClearPassword(event.currentTarget.checked)}/>清除已保存的目录密码</label>}
      </fieldset>}
      <p className="media-manager-note">{configuration.storage==='openlist'?'可更新访问凭据；服务地址、目录和内容类型保持建库时的配置。':'扫描只读取目录内文件。已建库的目录和类型不能在此修改。'}</p>
      <div className="media-library-field"><span>访问范围</span><p className="media-readonly-field">{configuration.access === 'all' ? '所有用户' : '指定用户（管理员始终可访问）'}</p><small>可返回媒体库管理，通过“权限”调整访问范围。</small></div>
    </>}
    <div className="media-toolbar media-form-footer"><button type="button" disabled={saving} onClick={close}>取消</button><button className="media-primary" disabled={!configuration || saving || !name.trim()} type="submit" onClick={event => { event.preventDefault(); if (configuration && !saving && name.trim()) void save(); }}>{saving ? '正在保存…' : '保存修改'}</button></div>
  </form></section>;
}
