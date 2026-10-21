import { createPortal } from 'react-dom';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { usePlaybackStore } from '../stores/playback.store.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { PlaybackControls, type PlaybackPanel } from '../components/playback-controls.tsx';
import { VideoControls } from '../components/video-controls.tsx';
import { restorePlaybackEntries } from '../services/restore-playback.ts';
import { useEffect, useState } from 'react';
import { resolveAppTheme, themes } from '../../../shared/theme/theme.ts';
import { useThemeState } from '../../../shared/theme/use-theme.ts';

export function MediaPlayerPage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const { channel: routeChannel, panel } = useParams();
  const [params] = useSearchParams();
  const channel = routeChannel === 'music' || routeChannel === 'audiobook' ? routeChannel : 'video';
  const active = usePlaybackStore(state => state.active);
  const video = usePlaybackStore(state => state.video);
  const requested = panel === 'lyrics' || panel === 'queue' || panel === 'chapters' ? panel as PlaybackPanel : 'main';
  // Keep the routed player shell aligned with the legacy Preact screen. The
  // live media element is mounted outside this tree, but the screen classes
  // drive the fixed heading, channel navigation visibility, and page sizing.
  const videoPage = video || channel === 'video';
  const rootClassName = ['media-screen', 'media-secondary-page', 'media-playback-page', 'media-player-page', videoPage ? 'media-video-page' : undefined].filter(Boolean).join(' ');
  const [restoreError, setRestoreError] = useState('');
  // Video and music play on a fixed dark, immersive surface: the current theme's dark
  // values, whatever the app's mode (theme spec §4.7). Audiobooks keep the app's mode.
  const { preference, systemDark } = useThemeState(runtime.mediaApi.preferenceScope());
  const immersiveTheme = videoPage || channel === 'music' ? resolveAppTheme(preference, systemDark).theme : undefined;
  useEffect(() => {
    if (!immersiveTheme) return;
    // The live player sits outside this tree (it survives navigation), and the page
    // column does not span wide screens, so both the player and the body follow too.
    const player = runtime.player.element, body = document.body;
    player.dataset.theme = immersiveTheme; player.dataset.mode = 'dark';
    body.style.background = themes[immersiveTheme].dark.bg;
    return () => { delete player.dataset.theme; delete player.dataset.mode; body.style.removeProperty('background'); };
  }, [runtime, immersiveTheme]);
  // The player element lives outside the routed React tree so playback survives
  // navigation. A player route is the explicit full-screen/expanded view; mirror
  // that lifecycle here and collapse the persistent mini-player when leaving it.
  useEffect(() => {
    runtime.player.setControlsExpanded(true);
    return () => runtime.player.setControlsExpanded(false);
  }, [runtime]);
  useEffect(() => {
    const itemId = params.get('item') ?? '', partId = params.get('part') ?? '';
    if (!itemId || !partId || (runtime.player.currentItemId === itemId && runtime.player.currentPartId === partId)) return;
    const controller = new AbortController();
    setRestoreError('');
    void restorePlaybackEntries(runtime.mediaApi, itemId, partId, controller.signal)
      .then(({ entries, index }) => runtime.player.play(entries, Math.max(0, index), false, { autoplay: false, signal: controller.signal }))
      .catch(reason => { if (!controller.signal.aborted) setRestoreError(reason instanceof Error ? reason.message : '无法恢复播放'); });
    return () => controller.abort();
  }, [runtime, params]);
  // Legacy playback keeps the expanded player open when leaving queue/lyrics/
  // chapter sub-panels; only the main player view exits back to the catalogue.
  const back = () => {
    if (requested !== 'main') {
      navigate(`/media/${channel}/player`, { replace: true });
      return;
    }
    navigate(-1);
  };
  return <div className={rootClassName} data-theme={immersiveTheme} data-mode={immersiveTheme ? 'dark' : undefined}>
    {videoPage && <header className="media-heading">
      <button type="button" className="media-back-button" aria-label="← 返回浏览" title="返回浏览" onClick={back}><ChevronLeft size={20} aria-hidden="true" /></button>
      <strong>视频播放</strong>
    </header>}
    {restoreError ? <div className="page-state" role="alert"><h2>无法恢复播放</h2><p>{restoreError}</p><button type="button" onClick={() => navigate(`/media/${channel}`)}>返回频道</button></div>
      : !active ? <div className="media-player-empty"><p>当前没有播放内容。</p><button type="button" onClick={() => navigate(`/media/${channel}`)}>选择作品</button></div>
      : video ? createPortal(<VideoControls player={runtime.player} api={runtime.mediaApi} onBack={back} />, runtime.player.videoControlsHost)
      : <PlaybackControls player={runtime.player} api={runtime.mediaApi} panel={requested} onPanelChange={value => navigate(value === 'main' ? `/media/${channel}/player` : `/media/${channel}/player/${value}`, { replace: true })} onBack={back} />}
  </div>;
}
