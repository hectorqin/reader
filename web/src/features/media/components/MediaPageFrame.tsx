import { Alert, Button, Group, Loader, Stack, Title } from '@mantine/core';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useMediaChannel } from '../hooks/use-media-channel.ts';

export function MediaPageFrame({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const channel = useMediaChannel();
  return <Stack p="md" className="media-page"><Group justify="space-between">
    <Group><Button component={Link} to={`/media/${channel}`} variant="subtle">返回频道</Button><Title order={2}>{title}</Title></Group>{actions}
  </Group>{children}</Stack>;
}
export function QueryFeedback({ pending, error, retry }: { pending?: boolean; error?: Error | null; retry?: () => void }) {
  if (pending) return <Group role="status"><Loader size="sm" /><span>正在加载…</span></Group>;
  if (error) return <Alert color="red" title="加载失败" role="alert">{error.message}{retry && <Button variant="subtle" onClick={retry}>重试</Button>}</Alert>;
  return null;
}
