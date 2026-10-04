import { Alert, Button, Group, Loader, Title, UnstyledButton } from '@mantine/core';
import { ChevronLeft } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useMediaChannel } from '../hooks/use-media-channel.ts';
import { ChannelSwitcher } from './channel-navigation.tsx';

export function MediaPageFrame({ title, subtitle, children, actions, className, backTo, backLabel }: { title: string; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string; backTo?: string; backLabel?: string }) {
  const channel = useMediaChannel();
  const location = useLocation();
  const stateReturn = typeof location.state?.returnTo === 'string' && location.state.returnTo.startsWith('/media/') ? location.state.returnTo : undefined;
  const target = backTo ?? stateReturn ?? `/media/${channel}`;
  const label = backLabel ?? (stateReturn ? '返回上一页' : '返回频道');
  const rootClassName = ['media-screen', 'media-page', className].filter(Boolean).join(' ');
  const catalog = className?.split(/\s+/).includes('media-catalog-page') ?? false;
  return <div className={rootClassName}>
    <header className="media-heading">
      {catalog
        ? <div className="media-mobile-title"><Title order={1}>{title}</Title><ChannelSwitcher current={channel} /></div>
        : <div className="media-page-heading">
          <UnstyledButton className="media-back-button" component={Link} to={target} aria-label={label} title={label}><ChevronLeft size={20} aria-hidden="true" /></UnstyledButton>
          <Title order={1}>{title}</Title>
          {subtitle && <span className="media-heading-context">{subtitle}</span>}
        </div>}
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
