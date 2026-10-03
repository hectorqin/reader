import { Button, Center, Stack, Title } from '@mantine/core';
import { createPortal } from 'react-dom';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { usePlaybackStore } from '../stores/playback.store.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { PlaybackControls, type PlaybackPanel } from '../components/playback-controls.tsx';
import { VideoControls } from '../components/video-controls.tsx';
import { restorePlaybackEntries } from '../services/restore-playback.ts';
import { useEffect, useState } from 'react';

export function MediaPlayerPage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const { channel: routeChannel, panel } = useParams();
  const [params] = useSearchParams();
  const channel = routeChannel === 'music' || routeChannel === 'audiobook' ? routeChannel : 'video';
  const active = usePlaybackStore(state => state.active);
  const video = usePlaybackStore(state => state.video);
  const requested = panel === 'lyrics' || panel === 'queue' || panel === 'chapters' ? panel as PlaybackPanel : 'main';
  const [restoreError, setRestoreError] = useState('');
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
  if (restoreError) return <Center mih="60vh"><Stack align="center"><Title order={2}>无法恢复播放</Title><div role="alert">{restoreError}</div><Button onClick={() => navigate(`/media/${channel}`)}>返回频道</Button></Stack></Center>;
  if (!active) return <Center mih="60vh"><Stack align="center"><Title order={2}>当前没有播放内容</Title><Button onClick={() => navigate(`/media/${channel}`)}>选择作品</Button></Stack></Center>;
  if (video) return <div className="media-player-page">{createPortal(<VideoControls player={runtime.player} api={runtime.mediaApi} onBack={() => navigate(-1)} />, runtime.player.videoControlsHost)}</div>;
  return <div className="media-player-page"><PlaybackControls player={runtime.player} api={runtime.mediaApi} panel={requested} onPanelChange={value => navigate(value === 'main' ? `/media/${channel}/player` : `/media/${channel}/player/${value}`, { replace: true })} onBack={() => navigate(-1)} /></div>;
}
