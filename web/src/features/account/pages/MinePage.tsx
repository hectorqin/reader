import { Icon, type IconName } from '../../../ui/icon.tsx';
import { Link } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { useSettingsStore } from '../../../shared/stores/settings.store.ts';
import { themeSummary } from '../../../shared/theme/theme.ts';
import { useThemeState } from '../../../shared/theme/use-theme.ts';
import { readMediaPreferences } from '../../media/services/preferences.ts';
import { DENSITY_LABELS, ShelfSettingsSheet } from '../../../ui/shelf-settings.tsx';
import { OpdsAccess } from '../../../ui/opds-access.tsx';
import { SystemSettings } from '../../../ui/system-settings.tsx';
import { ConfirmSheet } from '../../../ui/sheet.tsx';
import { useSyncStore } from '../../../shared/stores/sync.store.ts';
import { connectionLabel } from '../../../app/AppNav.tsx';
import '../../home/styles/home.css';
import '../styles/mine.css';

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
 * 我的: the settings hub. Every setting in the app is reachable from here, grouped by
 * what it is about rather than by which page happens to own it:
 * - 偏好: how things look and behave for *you* (theme, the shelf, media browsing, playback);
 * - 管理: what an administrator changes for everyone (users, services, media libraries);
 * - 账号: who you are on this server.
 * Each row opens the one place that setting lives; the shelf sheet is a shortcut
 * to a subset of this list, not a separate setting.
 */
export function MinePage() {
  const runtime = useRuntime();
  const user = useAuthStore(state => state.verifiedUser ?? state.session?.user ?? null);
  const settings = useSettingsStore(state => state.settings);
  const admin = user?.role === 'admin';
  const scope = runtime.mediaApi.preferenceScope();
  const themeName = themeSummary(useThemeState(scope).preference);
  const mediaDensity = readMediaPreferences(scope).density === 'compact' ? '紧凑' : '宽松';
  const [sheet, setSheet] = useState<'shelf' | 'opds' | 'system' | 'sign-out' | null>(null);
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
          <small><span className="mine-dot" data-state={connection.state} aria-hidden="true" />{connection.label} {serverHost(runtime.api.baseUrl)}</small>
        </div>
      </section>}
      {/* Two columns on a wide window, each filled top to bottom so uneven groups don't
        * leave holes; on a narrow one the columns dissolve and `order` restores reading order. */}
      <div className="mine-groups">
        <div className="mine-column">
          <Group title="内容" order={1}>
            <Row icon="library" label="书库" to="/library" />
            <Row icon="feed" label="书源" to="/sources" />
            {admin && <Row icon="video" label="媒体库" to="/media/video/settings/libraries" state={{ returnTo: '/me' }} />}
          </Group>
          {admin && <Group title="管理" order={3}>
            <Row icon="settings" label="系统设置" value="用户、注册、服务配置" onClick={() => setSheet('system')} />
            <Row icon="refresh" label="扫描与刮削" to="/media/video/settings/tasks" state={{ returnTo: '/me' }} />
          </Group>}
        </div>
        <div className="mine-column">
          <Group title="偏好" order={2}>
            <Row icon="palette" label="外观与主题" value={themeName} to="/me/theme" />
            <Row icon="grid" label="书架显示" value={DENSITY_LABELS[settings.shelfDensity]} onClick={() => setSheet('shelf')} />
            <Row icon="sliders" label="影音浏览" value={mediaDensity} to="/me/browse" />
            <Row icon="play-circle" label="播放" to="/me/playback" />
          </Group>
          <Group title="账号" order={4}>
            <Row icon="account" label="账号与连接" to="/me/account" />
            <Row icon="logout" label="退出登录" danger onClick={() => setSheet('sign-out')} />
          </Group>
        </div>
      </div>
    </div>
    {/* Outside the media screen, so its sheet styles are the shelf's own, not media's. */}
    {sheet === 'shelf' && <ShelfSettingsSheet settings={settings} onPatch={patch => { void runtime.updateSettings(patch); }} onClose={() => setSheet(null)} onOpenExternalReader={() => setSheet('opds')} />}
    {sheet === 'opds' && <OpdsAccess api={runtime.api} onSignedOut={() => { void runtime.api.signOut(); }} onClose={() => setSheet('shelf')} />}
    {sheet === 'system' && <SystemSettings api={runtime.api} onClose={() => setSheet(null)} />}
    {sheet === 'sign-out' && <ConfirmSheet danger title="退出登录" busy={signingOut} confirmText={signingOut ? '正在退出…' : '退出登录'}
      text={`将退出 ${serverHost(runtime.api.baseUrl)} 上的账号「${name}」，之后需要重新登录才能继续使用。`}
      onCancel={() => setSheet(null)}
      onConfirm={() => { setSigningOut(true); void runtime.api.signOut().finally(() => setSigningOut(false)); }} />}
  </>;
}
