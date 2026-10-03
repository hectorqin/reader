import { ActionIcon, Group, Paper, Text } from '@mantine/core';
import { Pause, Play, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { usePlaybackStore } from '../stores/playback.store.ts';
import { useLocation } from 'react-router-dom';

export function MiniPlayer() {
  const runtime = useRuntime();
  const { active, title, paused, error, loadingStatus, channel, itemId, partId } = usePlaybackStore();
  const location = useLocation();
  if (!active || location.pathname.includes('/player')) return null;
  return <Paper className="react-mini-player" withBorder shadow="sm" p="xs">
    <Group justify="space-between" wrap="nowrap">
      <Text component={Link} to={`/media/${channel}/player?item=${encodeURIComponent(itemId)}&part=${encodeURIComponent(partId)}`} truncate fw={600}>{title || '正在播放'}</Text>
      <Group gap="xs" wrap="nowrap">
        {loadingStatus && <Text size="xs" c="dimmed">{loadingStatus}</Text>}
        {error && <Text size="xs" c="red">{error}</Text>}
        <ActionIcon aria-label={paused ? '继续播放' : '暂停播放'} onClick={() => runtime.player.toggle()}>{paused ? <Play size={16} /> : <Pause size={16} />}</ActionIcon>
        <ActionIcon aria-label="停止播放" onClick={() => void runtime.player.stop()}><X size={16} /></ActionIcon>
      </Group>
    </Group>
  </Paper>;
}
