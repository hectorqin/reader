import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { MediaPageFrame } from '../components/MediaPageFrame.tsx';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { MediaSettings, SETTINGS_TITLES, type SettingsPanel } from '../components/settings.tsx';
import { readMediaPreferences } from '../services/preferences.ts';

function isPanel(value: string | undefined): value is SettingsPanel {
  return (Object.keys(SETTINGS_TITLES) as string[]).includes(value ?? '');
}

/**
 * One settings panel of 我的, at /me/:panel. Back returns to 我的. An unknown panel,
 * and the old media settings home (/media/:channel/settings[/:panel]), lead to 我的.
 */
export function MediaSettingsPage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const { channel: routeChannel, panel } = useParams();
  const channel = routeChannel === 'music' || routeChannel === 'audiobook' ? routeChannel : 'video';
  const [preferences, setPreferences] = useState(() => readMediaPreferences(runtime.mediaApi.preferenceScope()));
  if (!isPanel(panel)) return <Navigate to="/me" replace />;

  return <MediaPageFrame className="media-utility-workspace" title={SETTINGS_TITLES[panel]} backTo="/me" backLabel="返回我的">
    <MediaSettings
      scope={runtime.mediaApi.preferenceScope()}
      preferences={preferences}
      player={runtime.player}
      account={runtime.mediaApi.accountInfo()}
      panel={panel}
      onSaved={setPreferences}
      onBack={() => navigate('/me')}
      onPlayback={() => navigate(`/media/${channel}/player`)}
      onReaderSettings={patch => { void runtime.updateSettings(patch); }}
    />
  </MediaPageFrame>;
}

/** Old links to the media settings home and its panels: the panels now live in 我的. */
export function LegacyMediaSettingsRedirect() {
  const { panel } = useParams();
  return <Navigate to={isPanel(panel) ? `/me/${panel}` : '/me'} replace />;
}
