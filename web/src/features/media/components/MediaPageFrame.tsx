import { Alert, Button, Group, Loader, Title } from '@mantine/core';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useMediaChannel } from '../hooks/use-media-channel.ts';

export function MediaPageFrame({ title, children, actions, className }: { title: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  const channel = useMediaChannel();
  const rootClassName = ['media-screen', 'media-page', className].filter(Boolean).join(' ');
  return <div className={rootClassName}>
    <header className="media-heading">
      <div className="media-page-heading">
        <Button className="media-back-button" component={Link} to={`/media/${channel}`} variant="subtle" aria-label="返回频道" title="返回频道"><ArrowLeft size={18} aria-hidden="true" /></Button>
        <Title order={1}>{title}</Title>
      </div>
      {actions && <div className="media-heading-actions">{actions}</div>}
    </header>
    {children}
  </div>;
}
export function QueryFeedback({ pending, error, retry }: { pending?: boolean; error?: Error | null; retry?: () => void }) {
  if (pending) return <Group role="status"><Loader size="sm" /><span>正在加载…</span></Group>;
  if (error) return <Alert color="red" title="加载失败" role="alert">{error.message}{retry && <Button variant="subtle" onClick={retry}>重试</Button>}</Alert>;
  return null;
}
