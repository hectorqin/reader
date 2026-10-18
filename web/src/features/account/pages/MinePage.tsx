import { Link } from 'react-router-dom';
import { ChevronRight, Film, LibraryBig, LogOut, Palette, PlayCircle, Rss, UserRound, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { mediaThemes, readMediaTheme } from '../../media/services/theme.ts';
import '../../home/styles/home.css';
import '../styles/mine.css';

function Row({ icon: Icon, label, value, to, onClick, danger = false }: { icon: LucideIcon; label: string; value?: string; to?: string; onClick?: () => void; danger?: boolean }) {
  const body = <>
    <span className="mine-row-icon" aria-hidden="true"><Icon size={18} /></span>
    <span className="mine-row-label">{label}</span>
    {value && <span className="mine-row-value">{value}</span>}
    {!danger && <ChevronRight size={16} aria-hidden="true" className="mine-row-chevron" />}
  </>;
  const className = danger ? 'mine-row is-danger' : 'mine-row';
  return to
    ? <Link className={className} to={to}>{body}</Link>
    : <button type="button" className={className} onClick={onClick}>{body}</button>;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className="mine-group" aria-label={title}><h2>{title}</h2><div className="mine-card">{children}</div></section>;
}

function serverHost(baseUrl: string): string {
  try { return new URL(baseUrl).host; } catch { return baseUrl; }
}

/**
 * 我的: the one place for who you are, what is connected, and the settings that
 * already exist elsewhere. It owns no settings of its own: every row links to the
 * page that does, so there is still exactly one place to change each thing.
 */
export function MinePage() {
  const runtime = useRuntime();
  const user = useAuthStore(state => state.verifiedUser ?? state.session?.user ?? null);
  const admin = user?.role === 'admin';
  const choice = readMediaTheme(runtime.mediaApi.preferenceScope());
  const themeName = choice === 'system' ? '跟随系统' : (mediaThemes.find(theme => theme.id === choice)?.name ?? '跟随系统');
  const name = user?.displayName || user?.username || '';
  return <div className="media-screen media-page mine-page">
    <header className="home-header"><h1>我的</h1></header>
    {user && <section className="mine-profile" aria-label="当前账号">
      <div className="mine-avatar" aria-hidden="true">{Array.from(name)[0]}</div>
      <div className="mine-profile-text">
        <strong>{name}</strong>
        <small><span className="mine-dot" aria-hidden="true" />{serverHost(runtime.api.baseUrl)} · {admin ? '管理员' : '成员'}</small>
      </div>
    </section>}
    <Group title="内容">
      <Row icon={LibraryBig} label="书库" to="/library" />
      <Row icon={Rss} label="书源" to="/sources" />
      {admin && <Row icon={Film} label="媒体库" to="/media/video/settings/libraries" />}
    </Group>
    <Group title="偏好">
      <Row icon={Palette} label="外观与主题" value={themeName} to="/media/video/settings/theme" />
      <Row icon={PlayCircle} label="播放" to="/media/video/settings/playback" />
    </Group>
    <Group title="账号">
      <Row icon={UserRound} label="账号与连接" to="/media/video/settings/account" />
      <Row icon={LogOut} label="退出登录" danger onClick={() => { void runtime.api.signOut(); }} />
    </Group>
  </div>;
}
