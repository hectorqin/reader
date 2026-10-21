import { Link, useLocation } from 'react-router-dom';
import { Callout, Icon } from '../../../ui/toolkit.tsx';
import type { ReactNode } from 'react';
import { useMediaChannel } from '../hooks/use-media-channel.ts';
import { ChannelSegments } from './channel-navigation.tsx';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';

export function MediaPageFrame({ title, subtitle, children, actions, className, backTo, backLabel, hideHeader = false }: { title: string; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string; backTo?: string; backLabel?: string; hideHeader?: boolean }) {
  const channel = useMediaChannel();
  const location = useLocation();
  const stateReturn = typeof location.state?.returnTo === 'string' && location.state.returnTo.startsWith('/media/') ? location.state.returnTo : undefined;
  const target = backTo ?? stateReturn ?? `/media/${channel}`;
  const label = backLabel ?? (stateReturn ? '返回上一页' : '返回频道');
  const rootClassName = ['media-screen', 'media-page', className].filter(Boolean).join(' ');
  const catalog = className?.split(/\s+/).includes('media-catalog-page') ?? false;
  return <div className={rootClassName}>
    {!hideHeader && <header className="media-heading">
      {catalog
        ? <>
          {/* The visible title is the segmented switch; the page still needs its one h1. */}
          <h1 className="media-visually-hidden">{title}</h1>
          <span className="media-mobile-title"><ChannelSegments current={channel} /></span>
        </>
        : <div className="media-page-heading">
          <Link className="media-back-button" to={target} aria-label="← 返回" title={label}><Icon name="chevron-left" /></Link>
          <h1>{title}</h1>
          {subtitle && <span className="media-heading-context">{subtitle}</span>}
        </div>}
      <div id={className?.split(/\s+/).includes('media-secondary-page') ? 'media-heading-actions-host' : undefined} className="media-heading-actions">{actions}</div>
    </header>}
    {children}
  </div>;
}
export function QueryFeedback({ pending, error, retry }: { pending?: boolean; error?: Error | null; retry?: () => void }) {
  if (pending) return <FloatingNotice message="正在加载…" busy />;
  if (error) return <Callout tone="error" title="加载失败" {...(retry ? { action: { label: '重试', onClick: retry } } : {})}>{error.message}</Callout>;
  return null;
}
