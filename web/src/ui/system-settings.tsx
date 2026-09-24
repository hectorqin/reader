import { useEffect, useState } from './vendor/preact.ts';
import type { ReaderApi } from '../api/client.ts';
import type { ManagedUser, RegistrationSettings } from '../api/types.ts';
import { Modal } from './modal.tsx';

export function SystemSettings({api,onClose}:{api:ReaderApi;onClose():void}) {
  const [users,setUsers]=useState<ManagedUser[]>([]),[settings,setSettings]=useState<RegistrationSettings|null>(null);
  const [tab,setTab]=useState<'users'|'registration'>('users'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [form,setForm]=useState(false),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[displayName,setDisplayName]=useState(''),[role,setRole]=useState<'admin'|'member'>('member');
  const [reset,setReset]=useState<ManagedUser|null>(null),[confirmation,setConfirmation]=useState<{text:string;run:()=>Promise<unknown>}|null>(null);
  const [label,setLabel]=useState(''),[maxUses,setMaxUses]=useState(1),[days,setDays]=useState(7),[code,setCode]=useState('');
  const [query,setQuery]=useState('');
  async function load() { const [list,config]=await Promise.all([api.adminUsers(),api.registrationSettings()]);setUsers(list.users);setSettings(config); }
  async function work(action:()=>Promise<unknown>,success='已保存') { if(busy)return;setBusy(true);setError('');setMessage('');try{await action();await load();setConfirmation(null);setMessage(success);}catch(e){setError(e instanceof Error?e.message:'操作失败');}finally{setBusy(false);} }
  useEffect(()=>{void work(async()=>{},'');},[]);
  const self=api.currentSession()?.user.id;
  return <Modal title="系统设置" busy={busy} onClose={onClose}><div className="user-management source-modal-content">
    <nav className="extension-tabs" aria-label="系统设置分类"><button aria-pressed={tab==='users'} onClick={()=>setTab('users')}>用户管理</button><button aria-pressed={tab==='registration'} onClick={()=>setTab('registration')}>注册与邀请</button></nav>
    {error && <p role="alert" className="notice">{error}</p>}{message && <p role="status">{message}</p>}
    {confirmation && <section className="notice" role="alert"><p>{confirmation.text}</p><button className="button primary" disabled={busy} onClick={()=>void work(confirmation.run)}>确认操作</button> <button className="button" disabled={busy} onClick={()=>setConfirmation(null)}>取消操作</button></section>}
    {tab==='users' ? <>
      <div className="user-manager-actions"><input aria-label="筛选用户" placeholder="搜索用户名或显示名" value={query} onInput={e=>setQuery(e.currentTarget.value)} /><button className="button primary" disabled={busy} onClick={()=>{setForm(!form);setReset(null);setPassword('');}}>新增用户</button></div>
      {form && <form className="user-manager-form" onSubmit={e=>{e.preventDefault();void work(async()=>{await api.adminCreateUser({username:username.trim(),password,displayName:displayName.trim(),role});setForm(false);setUsername('');setPassword('');setDisplayName('');setRole('member');},'用户已创建');}}>
        <label>用户名<input required minLength={3} maxLength={100} value={username} onInput={e=>setUsername(e.currentTarget.value)} /></label>
        <label>初始密码<input required type="password" autoComplete="new-password" minLength={8} maxLength={1024} value={password} onInput={e=>setPassword(e.currentTarget.value)} /></label>
        <label>显示名<input maxLength={100} value={displayName} onInput={e=>setDisplayName(e.currentTarget.value)} /></label>
        <label>账号角色<select value={role} onChange={e=>setRole(e.currentTarget.value as 'admin'|'member')}><option value="member">普通用户</option><option value="admin">管理员</option></select></label>
        <button className="button primary" disabled={busy}>创建账号</button>
      </form>}
      {reset && <form className="user-manager-form" onSubmit={e=>{e.preventDefault();void work(async()=>{await api.adminResetPassword(reset.id,password);setReset(null);setPassword('');},'密码已重置，旧会话已失效');}}><p>重置 {reset.username} 的密码，所有旧会话将立即失效。</p><label>新密码<input type="password" required minLength={8} maxLength={1024} autoComplete="new-password" value={password} onInput={e=>setPassword(e.currentTarget.value)} /></label><button className="button primary" disabled={busy}>确认重置密码</button><button type="button" className="button" disabled={busy} onClick={()=>{setReset(null);setPassword('');}}>取消重置</button></form>}
      <p className="muted">共 {users.length} 个账号</p><ul className="user-manager-list">{users.filter(user=>(user.username+' '+user.displayName).toLowerCase().includes(query.toLowerCase())).map(user=><li key={user.id}>
        <div><strong>{user.displayName}</strong><span className="muted"> @{user.username}{user.id===self?' · 当前账号':''}</span></div>
        <p>{user.role==='admin'?'管理员':'普通用户'} · {user.disabled?'已停用':'正常'}</p>
        {user.id!==self && <div className="user-manager-actions"><button className="button" disabled={busy} onClick={()=>setConfirmation({text:`确定${user.disabled?'启用':'停用'} ${user.username}？${user.disabled?'':'旧会话将立即失效。'}`,run:()=>api.adminUpdateUser(user.id,{disabled:!user.disabled})})}>{user.disabled?'启用':'停用'}</button><button className="button" disabled={busy} onClick={()=>setConfirmation({text:`将 ${user.username} ${user.role==='admin'?'改为普通用户':'设为管理员（可管理全部用户及实例设置）'}？`,run:()=>api.adminUpdateUser(user.id,{role:user.role==='admin'?'member':'admin'})})}>{user.role==='admin'?'移除管理员':'设为管理员'}</button><button className="button" disabled={busy} onClick={()=>{setReset(user);setForm(false);setPassword('');}}>重置密码</button></div>}
      </li>)}</ul>
    </> : settings && <>
      <label className="user-manager-mode">注册方式<select aria-label="注册方式" value={settings.mode} disabled={busy} onChange={e=>{const mode=e.currentTarget.value as RegistrationSettings['mode'];setConfirmation({text:`将注册方式修改为${mode==='closed'?'关闭注册':mode==='open'?'开放注册（任何访问者都可创建账号）':'仅邀请码注册'}？`,run:()=>api.setRegistrationMode(mode)});}}><option value="closed">关闭注册</option><option value="open">开放注册</option><option value="invite">仅邀请码注册</option></select></label>
      <p className="muted">关闭注册时仍可由管理员创建账号。设置立即生效并在重启后保留。</p>
      <details><summary>创建邀请码</summary><form className="user-manager-form" onSubmit={e=>{e.preventDefault();void work(async()=>{setCode((await api.createInvite({label,maxUses,days})).code);},'邀请码已创建');}}><label>备注<input maxLength={80} value={label} onInput={e=>setLabel(e.currentTarget.value)} /></label><label>可用次数<input type="number" required min={1} max={1000} value={maxUses} onInput={e=>setMaxUses(Number(e.currentTarget.value))} /></label><label>有效天数<input type="number" required min={1} max={365} value={days} onInput={e=>setDays(Number(e.currentTarget.value))} /></label><button className="button primary" disabled={busy}>生成邀请码</button></form></details>
      {code && <label className="user-manager-mode">新邀请码（仅本次显示，请复制保存）<input aria-label="新邀请码" readOnly value={code} onFocus={e=>e.currentTarget.select()} /></label>}
      <ul className="user-manager-list">{settings.invites.map(invite=><li key={invite.id}><strong>{invite.label||'未备注邀请码'}</strong><p>已用 {invite.usedCount} / {invite.maxUses} 次 · {invite.disabled?'已停用':invite.expiresAt<=Date.now()?'已过期':invite.usedCount>=invite.maxUses?'已用完':'可用'}</p><p className="muted">有效至 {new Date(invite.expiresAt).toLocaleString()}</p>{!invite.disabled && <button className="button" disabled={busy} onClick={()=>setConfirmation({text:'停用此邀请码？已注册账号不受影响。',run:()=>api.disableInvite(invite.id)})}>停用邀请码</button>}</li>)}</ul>
    </>}
  </div></Modal>;
}
