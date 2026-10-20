import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { MediaPageFrame } from '../components/MediaPageFrame.tsx';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { MediaSettings } from '../components/settings.tsx';
import type { SettingsPanel } from '../components/settings.tsx';
import { readMediaPreferences } from '../services/preferences.ts';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';

const panels: readonly SettingsPanel[] = ['home', 'theme', 'browse', 'playback', 'account'];
const titles: Record<SettingsPanel, string> = {
  home: '影音设置', theme: '外观与主题', browse: '浏览偏好', playback: '播放设置',
  account: '账号与连接',
};

function safePanel(value: string | undefined): SettingsPanel {
  return value && panels.includes(value as SettingsPanel) ? value as SettingsPanel : 'home';
}

/**
 * One settings panel, reached from either of two places:
 * - `/media/:channel/settings[/:panel]`, the media channel's own settings (⋯ → 影音设置);
 * - `/me/:panel` (`hub="me"`), a row of 我的. Back returns to 我的, and there is no
 *   media home panel under /me, because 我的 *is* that list.
 */
export function MediaSettingsPage({ hub }: { hub?: 'me' }) {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const { channel: routeChannel, panel: routePanel } = useParams();
  const channel = routeChannel === 'music' || routeChannel === 'audiobook' ? routeChannel : 'video';
  const panel = safePanel(routePanel);
  const admin = useAuthStore(state => state.verifiedUser?.role === 'admin');
  const [preferences, setPreferences] = useState(() => readMediaPreferences(runtime.mediaApi.preferenceScope()));
  if (hub === 'me' && panel === 'home') return <Navigate to="/me" replace />;
  const home = hub === 'me' ? '/me' : `/media/${channel}/settings`;
  const settingsPath = (next: SettingsPanel) => next === 'home'
    ? home
    : hub === 'me' ? `/me/${next}` : `/media/${channel}/settings/${next}`;
  const backLabel = hub === 'me' ? '返回我的' : '返回影音设置';

  return <MediaPageFrame className="media-utility-workspace" title={titles[panel]} {...(panel !== 'home' ? { backTo: home, backLabel } : {})}>
    <MediaSettings
      scope={runtime.mediaApi.preferenceScope()}
      preferences={preferences}
      player={runtime.player}
      admin={admin}
      api={runtime.mediaApi}
      account={runtime.mediaApi.accountInfo()}
      panel={panel}
      backLabel={backLabel}
      onSaved={setPreferences}
      onBack={() => navigate(`/media/${channel}`)}
      onPanelChange={next => navigate(settingsPath(next))}
      onManage={() => navigate(`/media/${channel}/settings/libraries`)}
      onTasks={() => navigate(`/media/${channel}/settings/tasks`, { state: { returnTo: `/media/${channel}/settings` } })}
      onPlayback={() => navigate(`/media/${channel}/player`)}
      onGeneral={() => navigate('/me')}
      onReaderSettings={patch => { void runtime.updateSettings(patch); }}
    />
  </MediaPageFrame>;
}
