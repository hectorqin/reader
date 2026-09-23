import type { SourcePage } from '../api/sources.ts';
import { Icon } from './toolkit.tsx';

/** Provider-neutral feedback shared by search and alternative-source catalogs. */
export function CatalogFeedback({ page, merged = false, searching = false, count = page.items.length }: { page: SourcePage; merged?: boolean; searching?: boolean; count?: number }) {
  return <div className="catalog-feedback">
    <div className="catalog-summary" role="status"><strong>{merged ? '已找到' : '本页'} {count} 本书</strong>
      {!!page.errors?.length && <span><Icon name="warning" />{page.errors.length} 个来源未完成</span>}
    </div>
    {page.title && !merged && <p className="catalog-context">{page.title}</p>}
    {!!page.errors?.length && <details className="catalog-errors" open={!page.items.length && !searching}>
      <summary>查看失败详情</summary>
      <ul>{page.errors.map((error, index) => <li key={index}>
        <strong>{error.source}</strong><p>{error.message}</p><code>{error.code}</code>
      </li>)}</ul>
    </details>}
  </div>;
}
