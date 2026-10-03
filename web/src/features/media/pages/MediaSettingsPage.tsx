import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MediaPageFrame } from '../components/MediaPageFrame.tsx';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { MediaSettings } from '../components/settings.tsx';
import type { SettingsPanel } from '../components/settings.tsx';
import { readMediaPreferences } from '../services/preferences.ts';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';

const panels: readonly SettingsPanel[] = ['home', 'theme', 'browse', 'playback', 'plugins', 'account'];
const titles: Record<SettingsPanel, string> = {
  home: '影音设置', theme: '主题外观', browse: '浏览偏好', playback: '播放设置',
  plugins: '来源与刮削', account: '账号与连接',
};

function safePanel(value: string | undefined): SettingsPanel {
  return value && panels.includes(value as SettingsPanel) ? value as SettingsPanel : 'home';
}

export function MediaSettingsPage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const { channel: routeChannel, panel: routePanel } = useParams();
  const channel = routeChannel === 'music' || routeChannel === 'audiobook' ? routeChannel : 'video';
  const panel = safePanel(routePanel);
  const admin = useAuthStore(state => state.verifiedUser?.role === 'admin');
  const [preferences, setPreferences] = useState(() => readMediaPreferences(runtime.mediaApi.preferenceScope()));
  const settingsPath = (next: SettingsPanel) => next === 'home'
    ? `/media/${channel}/settings`
    : `/media/${channel}/settings/${next}`;

  return <MediaPageFrame className="media-utility-workspace" title={titles[panel]}>
    <MediaSettings
      scope={runtime.mediaApi.preferenceScope()}
      preferences={preferences}
      player={runtime.player}
      admin={admin}
      api={runtime.mediaApi}
      account={runtime.mediaApi.accountInfo()}
      panel={panel}
      onSaved={setPreferences}
      onBack={() => navigate(`/media/${channel}`)}
      onPanelChange={next => navigate(settingsPath(next))}
      onPersonal={view => navigate(view === 'favorites' ? '/media/favorites' : view === 'queue' ? '/media/queue' : `/media/${channel}/history`)}
      onManage={() => navigate(`/media/${channel}/settings/libraries`)}
      onTasks={() => navigate(`/media/${channel}/settings/tasks`)}
      onPlayback={() => navigate(`/media/${channel}/player`)}
    />
  </MediaPageFrame>;
}
