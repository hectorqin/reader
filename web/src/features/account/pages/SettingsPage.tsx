import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MediaPageFrame } from '../../media/components/MediaPageFrame.tsx';
import { MediaThemeSettings } from '../../media/components/theme-settings.tsx';
import { MediaBrowseSettings } from '../../media/components/settings.tsx';
import { PlaybackSettings } from '../../media/components/playback-settings.tsx';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useSettingsStore } from '../../../shared/stores/settings.store.ts';
import { ShelfSettingsFields } from '../../../ui/shelf-settings.tsx';
import { Icon } from '../../../ui/icon.tsx';
import { playerPath } from '../../media/stores/playback.store.ts';
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
 * 偏好设置 (/me/settings): every personal preference in one place — how the app looks,
 * the shelf, media browsing, playback — so none of them is a sheet in one place and
 * a page in another. The four kinds are tabs: one panel shows at a time, chosen by
 * `?section=` (外观与主题 when absent), which is also how old links (/me/theme,
 * /me/browse, …) land. Switching replaces the entry, so back still leaves for 我的.
 * Every control applies the moment it changes; there is no save button.
 *
 * The shelf's gear still opens the 书架 fields in a sheet: a shortcut to this tab,
 * not a second setting.
 */
export function SettingsPage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const settings = useSettingsStore(state => state.settings);
  const scope = runtime.mediaApi.preferenceScope();
  const [params, setParams] = useSearchParams();
  const requested = params.get('section');
  const active: SettingsSection = isSection(requested) ? requested : 'theme';
  const select = (id: SettingsSection, focus = false) => {
    setParams(id === 'theme' ? {} : { section: id }, { replace: true });
    if (focus) document.getElementById(`settings-tab-${id}`)?.focus();
  };
  const patch = (value: Parameters<typeof runtime.updateSettings>[0]) => { void runtime.updateSettings(value); };

  return <MediaPageFrame className="media-secondary-page settings-page" title="偏好设置" backTo="/me" backLabel="返回我的">
    <div className="settings-body">
      <div className="settings-tabs" role="tablist" aria-label="设置分类">
        {SETTINGS_SECTIONS.map((section, index) => <button type="button" role="tab" key={section.id} id={`settings-tab-${section.id}`}
          aria-selected={active === section.id} aria-controls="settings-panel" tabIndex={active === section.id ? 0 : -1}
          onClick={() => select(section.id)}
          onKeyDown={event => {
            // Arrow keys move between tabs, one tab stop for the row (WAI-ARIA tabs).
            const last = SETTINGS_SECTIONS.length - 1;
            const target = event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
              : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
              : event.key === 'Home' ? 0 : event.key === 'End' ? last : -1;
            if (target < 0) return;
            event.preventDefault();
            select(SETTINGS_SECTIONS[target]!.id, true);
          }}>{section.title}</button>)}
      </div>

      <section id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${active}`}
        className={'settings-section' + (active === 'shelf' ? ' shelf-settings' : active === 'browse' || active === 'playback' ? ' media-settings' : '')}>
        {active === 'theme' && <MediaThemeSettings scope={scope} onReaderSettings={patch} />}
        {active === 'shelf' && <>
          <ShelfSettingsFields settings={settings} onPatch={patch} />
          <Link className="settings-link" to="/me/opds" state={{ returnTo: '/me/settings?section=shelf' }}>
            <span><strong>连接外部阅读器</strong><small>通过 OPDS，让其他阅读器只读访问你的书架</small></span>
            <Icon name="chevron-right" size={16} />
          </Link>
        </>}
        {active === 'browse' && <>
          <p className="settings-note">仅影响影音页面，在当前设备为此服务器和账号保存</p>
          <MediaBrowseSettings scope={scope} />
        </>}
        {active === 'playback' && <PlaybackSettings scope={scope} player={runtime.player} onPlayback={() => navigate(playerPath(runtime.playback.snapshot()))} />}
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
