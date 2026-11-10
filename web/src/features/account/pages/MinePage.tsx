import { Icon, type IconName } from '../../../ui/icon.tsx';
import { Link } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { themeSummary } from '../../../shared/theme/theme.ts';
import { useThemeState } from '../../../shared/theme/use-theme.ts';
import { ConfirmSheet } from '../../../ui/sheet.tsx';
import { useSyncStore } from '../../../shared/stores/sync.store.ts';
import { connectionLabel } from '../../../app/AppNav.tsx';
import '../../home/styles/home.css';
import '../styles/mine.css';
import { useMediaEnabled } from '../../../shared/stores/features.ts';

function Row({ icon, label, value, to, state, onClick, danger = false }: { icon: IconName; label: string; value?: string; to?: string; state?: unknown; onClick?: () => void; danger?: boolean }) {
  const body = <>
    <span className="mine-row-icon" aria-hidden="true"><Icon name={icon} size={18} /></span>
    <span className="mine-row-label">{label}</span>
    {value && <span className="mine-row-value">{value}</span>}
    {!danger && <Icon name="chevron-right" size={16} className="mine-row-chevron" />}
  </>;
  const className = danger ? 'mine-row is-danger' : 'mine-row';
  return to
    ? <Link className={className} to={to} state={state}>{body}</Link>
    : <button type="button" className={className} onClick={onClick}>{body}</button>;
}

function Group({ title, order, children }: { title: string; order: number; children: ReactNode }) {
  return <section className="mine-group" aria-label={title} style={{ order }}><h2>{title}</h2><div className="mine-card">{children}</div></section>;
}

function serverHost(baseUrl: string): string {
  try { return new URL(baseUrl).host; } catch { return baseUrl; }
}

/**
 * 我的: the hub. Every row opens a page under /me (or the page it names), never a
 * sheet, so the whole screen behaves one way:
 * - 内容: where your things are (书库, 书源, statistics, media libraries);
 * - 偏好: one row, 偏好设置 — theme, the shelf, media browsing and playback are
 *   sections of a single page, so there is one place to look for any of them;
 * - 管理: what an administrator changes for everyone, one page per job;
 * - 账号: who you are on this server and which outside readers may see your shelf.
 * Signing out is the one exception: a confirmation, not a place.
 */
export function MinePage() {
  const media=useMediaEnabled();
  const runtime = useRuntime();
  const user = useAuthStore(state => state.verifiedUser ?? state.session?.user ?? null);
  const admin = user?.role === 'admin';
  const scope = runtime.mediaApi.preferenceScope();
  const themeName = themeSummary(useThemeState(scope).preference);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const name = user?.displayName || user?.username || '';
  // The same sync-engine verdict the sidebar shows; on a phone this page is the only place it appears.
  const connection = connectionLabel(useSyncStore(state => state.status.state));
  return <>
    <div className="media-screen media-page mine-page">
      <header className="home-header"><h1>我的</h1></header>
      {user && <section className="mine-profile" aria-label="当前账号">
        <div className="mine-avatar" aria-hidden="true">{Array.from(name)[0]}</div>
        <div className="mine-profile-text">
          <strong>{name}<span className="mine-role">{admin ? '管理员' : '成员'}</span></strong>
          <small><span className="mine-dot" data-state={connection.state} aria-hidden="true" />{connection.label} {serverHost(runtime.api.baseUrl)}{connection.state !== 'online' && <Link className="mine-status-link" to="/me/account">查看原因</Link>}</small>
        </div>
      </section>}
      {/* Two columns on a wide window, each filled top to bottom so uneven groups don't
        * leave holes; on a narrow one the columns dissolve and `order` restores reading order. */}
      <div className="mine-groups">
        <div className="mine-column">
          <Group title="内容" order={1}>
            <Row icon="library" label="书库" to="/library" />
            <Row icon="feed" label="书源" to="/sources" />
            <Row icon="clock" label="时长统计" value={media?'阅读、观影、听书':'阅读'} to="/me/stats" />
            {admin && media && <Row icon="video" label="媒体库" to="/media/video/settings/libraries" state={{ returnTo: '/me' }} />}
          </Group>
          {admin && <Group title="管理" order={3}>
            <Row icon="users" label="用户管理" to="/me/admin/users" />
            <Row icon="invite" label="注册与邀请" to="/me/admin/registration" />
            <Row icon="server" label="服务配置" value={media?'功能模块、朗读、AI、刮削、备份':'功能模块、朗读、AI、备份'} to="/me/admin/services" />
            {media&&<Row icon="refresh" label="扫描与刮削" to="/media/video/settings/tasks" state={{ returnTo: '/me' }} />}
          </Group>}
        </div>
        <div className="mine-column">
          <Group title="偏好" order={2}>
            <Row icon="sliders" label="偏好设置" value={themeName} to="/me/settings" />
          </Group>
          <Group title="账号" order={4}>
            <Row icon="account" label="账号与连接" to="/me/account" />
            <Row icon="connect" label="外部阅读器" value="OPDS" to="/me/opds" />
            <Row icon="logout" label="退出登录" danger onClick={() => setSignOutOpen(true)} />
          </Group>
        </div>
      </div>
    </div>
    {signOutOpen && <ConfirmSheet danger title="退出登录" busy={signingOut} confirmText={signingOut ? '正在退出…' : '退出登录'}
      text={`将退出 ${serverHost(runtime.api.baseUrl)} 上的账号「${name}」，之后需要重新登录才能继续使用。`}
      onCancel={() => setSignOutOpen(false)}
      onConfirm={() => { setSigningOut(true); void runtime.api.signOut().finally(() => setSigningOut(false)); }} />}
  </>;
}
