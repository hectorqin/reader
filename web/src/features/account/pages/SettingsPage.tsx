import { useEffect, useRef } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MediaPageFrame } from '../../media/components/MediaPageFrame.tsx';
import { MediaThemeSettings } from '../../media/components/theme-settings.tsx';
import { MediaBrowseSettings } from '../../media/components/settings.tsx';
import { PlaybackSettings } from '../../media/components/playback-settings.tsx';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useSettingsStore } from '../../../shared/stores/settings.store.ts';
import { ShelfSettingsFields } from '../../../ui/shelf-settings.tsx';
import { Icon } from '../../../ui/icon.tsx';
import '../styles/mine.css';

export const SETTINGS_SECTIONS = [
  { id: 'theme', title: '外观与主题' },
  { id: 'shelf', title: '书架' },
  { id: 'browse', title: '影音浏览' },
  { id: 'playback', title: '播放' },
] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number]['id'];

function isSection(value: string | null | undefined): value is SettingsSection {
  return SETTINGS_SECTIONS.some(section => section.id === value);
}

/**
 * 偏好设置 (/me/settings): every personal preference on one page — how the app looks,
 * the shelf, media browsing, playback — so none of them is a sheet in one place and
 * a page in another. Every control applies the moment it changes; there is no save
 * button anywhere on the page.
 *
 * `?section=` scrolls to one section, which is how old links (/me/theme, /me/browse,
 * …) and the jump bar land. The shelf's gear still opens the 书架 fields in a sheet:
 * that is a shortcut to this section, not a second setting.
 */
export function SettingsPage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const settings = useSettingsStore(state => state.settings);
  const scope = runtime.mediaApi.preferenceScope();
  const [params, setParams] = useSearchParams();
  const requested = params.get('section');
  const sections = useRef(new Map<SettingsSection, HTMLElement>());
  useEffect(() => {
    if (isSection(requested)) sections.current.get(requested)?.scrollIntoView({ block: 'start' });
  }, [requested]);
  const jump = (id: SettingsSection) => {
    sections.current.get(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setParams({ section: id }, { replace: true });
  };
  const ref = (id: SettingsSection) => (node: HTMLElement | null) => { if (node) sections.current.set(id, node); else sections.current.delete(id); };
  const patch = (value: Parameters<typeof runtime.updateSettings>[0]) => { void runtime.updateSettings(value); };

  return <MediaPageFrame className="media-secondary-page settings-page" title="偏好设置" backTo="/me" backLabel="返回我的">
    <div className="settings-body">
      <nav className="settings-jump" aria-label="跳到分区">
        {SETTINGS_SECTIONS.map(section => <button type="button" key={section.id} aria-current={requested === section.id ? 'true' : undefined} onClick={() => jump(section.id)}>{section.title}</button>)}
      </nav>

      <section ref={ref('theme')} className="settings-section" aria-labelledby="settings-theme">
        <h2 id="settings-theme">外观与主题</h2>
        <MediaThemeSettings scope={scope} onReaderSettings={patch} />
      </section>

      <section ref={ref('shelf')} className="settings-section shelf-settings" aria-labelledby="settings-shelf">
        <h2 id="settings-shelf">书架</h2>
        <ShelfSettingsFields settings={settings} onPatch={patch} />
        <Link className="settings-link" to="/me/opds" state={{ returnTo: '/me/settings?section=shelf' }}>
          <span><strong>连接外部阅读器</strong><small>通过 OPDS，让其他阅读器只读访问你的书架</small></span>
          <Icon name="chevron-right" size={16} />
        </Link>
      </section>

      <section ref={ref('browse')} className="settings-section media-settings" aria-labelledby="settings-browse">
        <h2 id="settings-browse">影音浏览</h2>
        <p className="settings-note">仅影响影音页面，在当前设备为此服务器和账号保存</p>
        <MediaBrowseSettings scope={scope} />
      </section>

      <section ref={ref('playback')} className="settings-section media-settings" aria-labelledby="settings-playback">
        <h2 id="settings-playback">播放</h2>
        <PlaybackSettings scope={scope} player={runtime.player} onPlayback={() => navigate('/media/video/player')} />
      </section>
    </div>
  </MediaPageFrame>;
}

/**
 * Old addresses of the preference panels: /me/theme, /me/browse, /me/playback (and
 * /me/shelf), and the older media settings home /media/:channel/settings[/:panel].
 * Each lands on its section of 偏好设置; 账号与连接 kept its own page.
 */
export function LegacySettingsRedirect() {
  const { panel } = useParams();
  if (panel === undefined) return <Navigate to="/me/settings" replace />;
  if (panel === 'account') return <Navigate to="/me/account" replace />;
  return <Navigate to={isSection(panel) ? `/me/settings?section=${panel}` : '/me'} replace />;
}
