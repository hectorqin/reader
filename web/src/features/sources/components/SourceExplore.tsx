import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SourceEntry, SourceInstance, SourcePage } from '../../../api/sources.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { LazyCover } from '../../../ui/lazy-cover.tsx';
import { notify } from '../../../ui/notifications.ts';
import { SearchableSelect } from '../../../ui/searchable-select.tsx';
import { Button, Callout, Icon } from '../../../ui/toolkit.tsx';
import { SourceBookDetailSheet } from './SourceBookDetailSheet.tsx';

/** One step of the trail: the page a crumb leads back to. */
interface Crumb { ref?: string; title: string }

const coverUrl = (sourceId: string, entry: SourceEntry) => entry.coverRef
  ? `/api/v1/sources/${encodeURIComponent(sourceId)}/cover?entryRef=${encodeURIComponent(entry.ref)}&coverRef=${encodeURIComponent(entry.coverRef)}` : null;

/**
 * 发现: walk what a source offers without a keyword.
 *
 * A page is one level: the levels below it (groups, sources, categories) are chips,
 * and the books on it are a list that grows with 加载更多. The trail of levels is a
 * breadcrumb, so going back is a tap on where you were rather than a button a
 * source has to supply.
 */
export function SourceExplore({ sources }: { sources: SourceInstance[] }) {
  const runtime = useRuntime(), navigate = useNavigate(), queryClient = useQueryClient();
  const [sourceId, setSourceId] = useState('');
  const selected = sources.find(source => source.id === sourceId) ?? sources.find(source => source.isDefault) ?? sources[0];
  const selectedId = selected?.id ?? '';
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [page, setPage] = useState<SourcePage>();
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [detail, setDetail] = useState<SourceEntry | null>(null);
  const [acquired, setAcquired] = useState<Record<string, string>>({});
  const epoch = useRef(0);
  const open = async (crumbs: Crumb[], ref?: string) => {
    if (!selectedId) return;
    const run = ++epoch.current;
    setBusy(true); setError(''); setFilter('');
    try {
      const next = await runtime.api.sourceCatalog(selectedId, ref ? { ref } : {});
      if (epoch.current !== run) return;
      setPage(next); setTrail([...crumbs, { ...(ref ? { ref } : {}), title: next.title || (crumbs.length ? '…' : '发现') }]);
    } catch (reason) { if (epoch.current === run) setError(reason instanceof Error ? reason.message : '加载失败，请重试'); }
    finally { if (epoch.current === run) setBusy(false); }
  };
  const current = trail.at(-1);
  const loadMore = async () => {
    if (!page?.nextCursor || more || !selectedId) return;
    const run = epoch.current;
    setMore(true); setError('');
    try {
      const next = await runtime.api.sourceCatalog(selectedId, { ...(current?.ref ? { ref: current.ref } : {}), cursor: page.nextCursor });
      if (epoch.current !== run) return;
      const seen = new Set(page.items.map(entry => entry.ref));
      const { nextCursor: _previous, ...rest } = page, cursor = next.items.length ? next.nextCursor : undefined;
      setPage({ ...rest, items: [...page.items, ...next.items.filter(entry => !seen.has(entry.ref))], ...(cursor ? { nextCursor: cursor } : {}) });
    } catch (reason) { if (epoch.current === run) setError(reason instanceof Error ? reason.message : '加载失败，请重试'); }
    finally { setMore(false); }
  };
  useEffect(() => {
    ++epoch.current; setPage(undefined); setTrail([]); setError(''); setDetail(null); setAcquired({});
    if (selectedId) void open([]);
    return () => { ++epoch.current; };
  }, [selectedId]);
  const detailQuery = useQuery({ queryKey: ['source-detail', runtime.api.baseUrl, selectedId, detail?.ref], queryFn: () => runtime.api.sourceDetail(selectedId, detail!.ref), enabled: !!detail });
  useEffect(() => { if (detail && detailQuery.data) setDetail({ ...detail, ...detailQuery.data }); }, [detailQuery.data]);
  const acquire = useMutation({ mutationFn: ({ ref, option }: { ref: string; option?: string }) => runtime.api.acquireSource(selectedId, ref, option), onError: reason => notify(reason instanceof Error ? reason.message : '加入书架失败', { kind: 'error' }) });
  const acquireEntry = (entry: SourceEntry, option?: string) => acquire.mutate(option === undefined ? { ref: entry.ref } : { ref: entry.ref, option }, { onSuccess: result => {
    if (result.kind === 'action-required') notify(result.action?.label ?? '请先完成授权', { kind: 'error' });
    else if (result.publicationId) { setAcquired(previous => ({ ...previous, [entry.ref]: result.publicationId! })); notify(`已加入书架：《${entry.title}》`, { kind: 'success' }); void queryClient.invalidateQueries({ queryKey: ['shelf'] }); }
  } });
  if (!sources.length) return <section className="sources-card"><p className="muted">还没有支持发现的书源。添加并启用带发现规则的书源库后，就能在这里按分类浏览。</p></section>;
  const links = page?.navigation ?? [], shown = links.filter(link => link.title.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));
  return <>
    <section className="sources-card source-picker">
      <SearchableSelect label="选择来源" value={selectedId} options={sources.map(source => ({ value: source.id, label: source.name + (source.isDefault ? '（默认）' : '') }))} onChange={setSourceId} />
    </section>
    <section className="sources-card explore" aria-busy={busy}>
      <nav className="explore-trail" aria-label="当前位置">{trail.map((crumb, index) => index === trail.length - 1
        ? <strong key={index} aria-current="page">{crumb.title}</strong>
        : <span key={index}><button type="button" disabled={busy} onClick={() => void open(trail.slice(0, index), crumb.ref)}>{crumb.title}</button><Icon name="chevron-right" size={14} /></span>)}
        {!trail.length && <strong>发现</strong>}
      </nav>
      {error && <Callout tone="error" onDismiss={() => setError('')}>{error}</Callout>}
      {busy && !page && <p className="muted" role="status">正在加载…</p>}
      {links.length > 16 && <input className="explore-filter" type="search" aria-label="筛选" placeholder={`在 ${links.length} 项中筛选`} value={filter} onChange={event => setFilter(event.currentTarget.value)} />}
      {links.length > 0 && <div className="explore-links">{shown.map(link => <button type="button" className="explore-link" key={link.ref} disabled={busy} onClick={() => void open(trail, link.ref)}>{link.title}</button>)}
        {!shown.length && <p className="muted">没有匹配的项</p>}</div>}
      {page && page.items.length > 0 && <div className="explore-books">{page.items.map(entry => { const option = entry.options?.[0], bookId = acquired[entry.ref]; return <article className="explore-book" key={entry.ref}>
        <LazyCover url={coverUrl(selectedId, entry)} title={entry.title} />
        <div className="explore-book-text"><strong>{entry.title}</strong><small>{entry.authors?.join(' / ') || '作者未知'}{entry.latestChapter ? ` · ${entry.latestChapter}` : ''}</small>{entry.description && <p>{entry.description}</p>}</div>
        <div className="explore-book-actions"><Button onClick={() => setDetail(entry)}>详情</Button>{bookId
          ? <Button className="primary" onClick={() => navigate(`/book/${encodeURIComponent(bookId)}`)}>阅读</Button>
          : <Button className="primary" disabled={option?.available === false || acquire.isPending} onClick={() => acquireEntry(entry, option?.id)}>{option?.label ?? '加入书架'}</Button>}</div>
      </article>; })}</div>}
      {page && !busy && !links.length && !page.items.length && <div className="catalog-empty"><strong>这里还没有内容</strong><p>换一个分类或书源试试。</p></div>}
      {page?.nextCursor && <div className="catalog-pagination"><button className="button" type="button" disabled={more || busy} onClick={() => void loadMore()}>{more ? '正在加载…' : '加载更多'}</button></div>}
    </section>
    {detail && <SourceBookDetailSheet detail={detail} pending={detailQuery.isPending} error={detailQuery.error} acquiring={acquire.isPending} onAcquire={acquireEntry} onClose={() => setDetail(null)} />}
  </>;
}
