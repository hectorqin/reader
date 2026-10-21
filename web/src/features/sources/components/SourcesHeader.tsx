import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../../ui/toolkit.tsx';

/** The heading every 书源 page uses: back, title, an optional subtitle and actions. */
export function SourcesHeader({ title, subtitle, backTo = '/sources', actions }: { title: string; subtitle?: string; backTo?: string; actions?: ReactNode }) {
  return <header className="sources-header">
    <Link className="icon-button" to={backTo} aria-label="返回" title="返回"><Icon name="arrow-left" /></Link>
    <div className="sources-header-text"><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}</div>
    {actions ?? <span aria-hidden="true" />}
  </header>;
}
