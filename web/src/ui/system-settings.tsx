import { Select } from './select.tsx';
import { useEffect, useState } from 'react';
import type { ReaderApi } from '../api/client.ts';
import type { ManagedUser, RegistrationSettings } from '../api/types.ts';
import { ConfirmSheet } from './sheet.tsx';
import { FloatingNotice } from './floating-notice.tsx';

/**
 * Administration of the server's accounts, split by job: 用户管理 and 注册与邀请
 * are each a page of 我的 › 管理 (服务配置 is BusinessSettings). Each panel loads
 * what it shows, runs one write at a time, re-fetches after it, and only then
 * reports — never a guess at what the server now holds.
 */
function useAdminWork<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState<{ text: string; run: () => Promise<unknown> } | null>(null);
  async function work(action: () => Promise<unknown>, success = '已保存') {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { await action(); setData(await load()); setConfirmation(null); setMessage(success); }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void work(async () => {}, ''); }, []);
  const notice = <>
    <FloatingNotice message={error || message} error={!!error} kind="success" />
    {confirmation && <ConfirmSheet text={confirmation.text} onCancel={() => setConfirmation(null)} onConfirm={() => { const run = confirmation.run; setConfirmation(null); void work(run); }} />}
  </>;
  return { data, busy, work, confirm: setConfirmation, notice };
}

export function UserManagement({ api,onSaved }: { api: ReaderApi;onSaved?:()=>void }) {
  const { data, busy, work, confirm, notice } = useAdminWork(async () => (await api.adminUsers()).users);
  const users: ManagedUser[] = data ?? [];
  const [form, setForm] = useState(false), [username, setUsername] = useState(''), [password, setPassword] = useState(''), [displayName, setDisplayName] = useState(''), [role, setRole] = useState<'admin' | 'member'>('member');
  const [reset, setReset] = useState<ManagedUser | null>(null), [query, setQuery] = useState('');
  const self = api.currentSession()?.user.id;
  const [globalMedia,setGlobalMedia]=useState(true),[defaultMedia,setDefaultMedia]=useState(true),[mediaEnabled,setMediaEnabled]=useState<boolean|undefined>();
  useEffect(()=>{
    let active=true;
    if(api.businessSettingsRequest)void api.businessSettingsRequest<{groups:Array<{group:string;values:Record<string,boolean>}>}>().then(result=>{
      const modules=result.groups.find(group=>group.group==='modules');
      if(active&&modules){setGlobalMedia(modules.values.mediaEnabled!==false);setDefaultMedia(modules.values.newUserMediaEnabled!==false);}
    }).catch(()=>undefined);
    return()=>{active=false;};
  },[api]);
  return <div className="user-management">
    {notice}
    {!globalMedia&&<p role="status">全站影音已关闭；用户影音权限将在重新开启后生效。</p>}
    <div className="user-manager-actions"><input aria-label="筛选用户" placeholder="搜索用户名或显示名" value={query} onInput={e => setQuery(e.currentTarget.value)} /><button className="button primary" disabled={busy} onClick={() => { setForm(!form); setReset(null); setPassword(''); }}>新增用户</button></div>
    {form && <form className="user-manager-form" onSubmit={e => { e.preventDefault(); void work(async () => { await api.adminCreateUser({ username: username.trim(), password, displayName: displayName.trim(), role,...(mediaEnabled===undefined?{}:{mediaEnabled}) }); setForm(false); setUsername(''); setPassword(''); setDisplayName(''); setRole('member');setMediaEnabled(undefined); }, '用户已创建'); }}>
      <label>用户名<input required minLength={3} maxLength={100} value={username} onInput={e => setUsername(e.currentTarget.value)} /></label>
      <label>初始密码<input required type="password" autoComplete="new-password" minLength={8} maxLength={1024} value={password} onInput={e => setPassword(e.currentTarget.value)} /></label>
      <label>显示名<input maxLength={100} value={displayName} onInput={e => setDisplayName(e.currentTarget.value)} /></label>
      <label>账号角色<Select value={role} onChange={e => setRole(e.currentTarget.value as 'admin' | 'member')}><option value="member">普通用户</option><option value="admin">管理员</option></Select></label>
      <label className="business-setting-toggle">允许使用影音<input type="checkbox" checked={mediaEnabled??defaultMedia} onChange={event=>setMediaEnabled(event.currentTarget.checked)}/></label>
      <button className="button primary" disabled={busy}>创建账号</button>
    </form>}
    {reset && <form className="user-manager-form" onSubmit={e => { e.preventDefault(); void work(async () => { await api.adminResetPassword(reset.id, password); setReset(null); setPassword(''); }, '密码已重置，旧会话已失效'); }}><p>重置 {reset.username} 的密码，所有旧会话将立即失效。</p><label>新密码<input type="password" required minLength={8} maxLength={1024} autoComplete="new-password" value={password} onInput={e => setPassword(e.currentTarget.value)} /></label><button className="button primary" disabled={busy}>确认重置密码</button><button type="button" className="button" disabled={busy} onClick={() => { setReset(null); setPassword(''); }}>取消重置</button></form>}
    <p className="muted">共 {users.length} 个账号</p>
    <ul className="user-manager-list">{users.filter(user => (user.username + ' ' + user.displayName).toLowerCase().includes(query.toLowerCase())).map(user => <li key={user.id}>
      <div><strong>{user.displayName}</strong><span className="muted"> @{user.username}{user.id === self ? ' · 当前账号' : ''}</span></div>
      <p>{user.role === 'admin' ? '管理员' : '普通用户'} · {user.disabled ? '已停用' : '正常'}</p>
      <p>影音：{user.mediaEnabled===false?'未启用':'已启用'}{!globalMedia?'（全站已关闭）':''}</p>
      <button className="button" disabled={busy} onClick={()=>confirm({text:`${user.mediaEnabled===false?'允许':'禁止'} ${user.username} 使用影音？${user.mediaEnabled===false?'原有媒体库权限仍然有效。':'播放将停止，影音数据保留，阅读不受影响。'}`,run:async()=>{await api.adminUpdateUser(user.id,{mediaEnabled:user.mediaEnabled===false});onSaved?.();}})}>{user.mediaEnabled===false?'启用影音':'关闭影音'}</button>
      {user.id !== self && <div className="user-manager-actions">
        <button className="button" disabled={busy} onClick={() => confirm({ text: `确定${user.disabled ? '启用' : '停用'} ${user.username}？${user.disabled ? '' : '旧会话将立即失效。'}`, run: () => api.adminUpdateUser(user.id, { disabled: !user.disabled }) })}>{user.disabled ? '启用' : '停用'}</button>
        <button className="button" disabled={busy} onClick={() => confirm({ text: `将 ${user.username} ${user.role === 'admin' ? '改为普通用户' : '设为管理员（可管理全部用户及实例设置）'}？`, run: () => api.adminUpdateUser(user.id, { role: user.role === 'admin' ? 'member' : 'admin' }) })}>{user.role === 'admin' ? '移除管理员' : '设为管理员'}</button>
        <button className="button" disabled={busy} onClick={() => { setReset(user); setForm(false); setPassword(''); }}>重置密码</button>
      </div>}
    </li>)}</ul>
  </div>;
}

export function RegistrationManagement({ api }: { api: ReaderApi }) {
  const { data: settings, busy, work, confirm, notice } = useAdminWork<RegistrationSettings>(() => api.registrationSettings());
  const [label, setLabel] = useState(''), [maxUses, setMaxUses] = useState(1), [days, setDays] = useState(7), [code, setCode] = useState('');
  return <div className="user-management">
    {notice}
    {settings && <>
      <label className="user-manager-mode">注册方式<Select aria-label="注册方式" value={settings.mode} disabled={busy} onChange={e => { const mode = e.currentTarget.value as RegistrationSettings['mode']; confirm({ text: `将注册方式修改为${mode === 'closed' ? '关闭注册' : mode === 'open' ? '开放注册（任何访问者都可创建账号）' : '仅邀请码注册'}？`, run: () => api.setRegistrationMode(mode) }); }}><option value="closed">关闭注册</option><option value="open">开放注册</option><option value="invite">仅邀请码注册</option></Select></label>
      <p className="muted">关闭注册时仍可由管理员创建账号。设置立即生效并在重启后保留。</p>
      <details><summary>创建邀请码</summary><form className="user-manager-form" onSubmit={e => { e.preventDefault(); void work(async () => { setCode((await api.createInvite({ label, maxUses, days })).code); }, '邀请码已创建'); }}><label>备注<input maxLength={80} value={label} onInput={e => setLabel(e.currentTarget.value)} /></label><label>可用次数<input type="number" required min={1} max={1000} value={maxUses} onInput={e => setMaxUses(Number(e.currentTarget.value))} /></label><label>有效天数<input type="number" required min={1} max={365} value={days} onInput={e => setDays(Number(e.currentTarget.value))} /></label><button className="button primary" disabled={busy}>生成邀请码</button></form></details>
      {code && <label className="user-manager-mode">新邀请码（仅本次显示，请复制保存）<input aria-label="新邀请码" readOnly value={code} onFocus={e => e.currentTarget.select()} /></label>}
      <ul className="user-manager-list">{settings.invites.map(invite => <li key={invite.id}><strong>{invite.label || '未备注邀请码'}</strong><p>已用 {invite.usedCount} / {invite.maxUses} 次 · {invite.disabled ? '已停用' : invite.expiresAt <= Date.now() ? '已过期' : invite.usedCount >= invite.maxUses ? '已用完' : '可用'}</p><p className="muted">有效至 {new Date(invite.expiresAt).toLocaleString()}</p>{!invite.disabled && <button className="button" disabled={busy} onClick={() => confirm({ text: '停用此邀请码？已注册账号不受影响。', run: () => api.disableInvite(invite.id) })}>停用邀请码</button>}</li>)}</ul>
    </>}
  </div>;
}
