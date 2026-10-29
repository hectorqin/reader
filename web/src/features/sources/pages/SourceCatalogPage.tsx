import { notify } from '../../../ui/notifications.ts';
import { Button, Callout } from '../../../ui/toolkit.tsx';
import { SourcesHeader } from '../components/SourcesHeader.tsx';
import { SourceBookDetailSheet } from '../components/SourceBookDetailSheet.tsx';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { SourceEntry, SourcePage } from '../../../api/sources.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useSources } from '../hooks/sourceQueries.ts';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';

export function mergePages(current: SourcePage | undefined, page: SourcePage): SourcePage {
  const items = new Map((current?.items ?? []).map(item => [item.ref, item]));
  page.items.forEach(item => items.set(item.ref, { ...items.get(item.ref), ...item }));
  // Each streamed chunk only carries the failures that happened since the previous one.
  const errors = new Map([...(current?.errors ?? []), ...(page.errors ?? [])].map(error => [error.source + ':' + error.code, error]));
  return { ...page, items: [...items.values()], ...(errors.size ? { errors: [...errors.values()] } : {}) };
}

export function SourceCatalogPage() {
  const { api } = useRuntime();
  const navigate = useNavigate();
  const { sourceId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const sources = useSources();
  const source = sources.data?.find(item => item.id === sourceId);
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [page, setPage] = useState<SourcePage>();
  const [detail, setDetail] = useState<SourceEntry | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(params.get('cursor') ?? undefined);
  const sessionId = useRef<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const filterQuery = useQuery({ queryKey: ['source-filters', api.baseUrl, sourceId], queryFn: () => api.sourceFilters(sourceId), enabled: !!source?.descriptor?.capabilities.includes('search.filters') });
  const detailQuery = useQuery({ queryKey: ['source-detail', api.baseUrl, sourceId, detail?.ref], queryFn: () => api.sourceDetail(sourceId, detail!.ref), enabled: !!detail });
  const acquire = useMutation({ mutationFn: ({ ref, option }: { ref: string; option?: string }) => api.acquireSource(sourceId, ref, option), onError: reason => notify(reason instanceof Error ? reason.message : '加入书架失败', { kind: 'error' }) });
  useEffect(() => { if (detail && detailQuery.data) setDetail({ ...detail, ...detailQuery.data }); }, [detailQuery.data]);
  useEffect(() => { const next = params.get('q') ?? ''; if (next !== query) setQuery(next); }, [params]);
  const acquireEntry = (entry: SourceEntry, option?: string) => acquire.mutate(option === undefined ? { ref: entry.ref } : { ref: entry.ref, option }, { onSuccess: result => { if (result.kind === 'action-required') notify(result.action?.label ?? '请先完成授权', { kind: 'error' }); else if (result.publicationId) navigate(`/book/${encodeURIComponent(result.publicationId)}`); } });

  const search = async (append = false) => {
    const term = query.trim(); if (!term || !source) return;
    setBusy(true); setError(''); if (!append) { sessionId.current = crypto.randomUUID(); setPage(undefined); setCursor(undefined); } setParams(previous => { const next = new URLSearchParams(previous); next.set('q', term); if (!append) next.delete('cursor'); return next; });
    try {
      let merged = append ? page : undefined;
      for await (const chunk of api.searchSource(source.id, { query: term, sessionId: sessionId.current ?? crypto.randomUUID(), ...(append && cursor ? { cursor } : {}), filters, resultLimit: 10000 })) {
        merged = mergePages(merged, chunk); setPage(merged); setCursor(chunk.nextCursor); if (chunk.limitReached) break;
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '搜索失败'); }
    finally { setBusy(false); }
  };
  const browse = async (ref?: string) => {
    if (!source) return; setBusy(true); setError('');
    try { sessionId.current = null; const next = await api.sourceCatalog(source.id, ref ? { ref } : {}); setPage(next); setCursor(next.nextCursor); setParams(previous => { const value = new URLSearchParams(previous); if (ref) value.set('ref', ref); else value.delete('ref'); return value; }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '目录加载失败'); }
    finally { setBusy(false); }
  };
  if (sources.isPending) return <div className="sources-screen"><FloatingNotice message="正在加载书源…" busy /><main className="sources-body" /></div>;
  if (!source) return <div className="sources-screen source-catalog-screen"><SourcesHeader title="选择书源" /><main className="sources-body"><section className="sources-card source-picker"><h2>选择来源</h2><p className="muted">选择一个已启用的书源开始搜索或浏览</p><label>书源<select defaultValue="" onChange={event => { const value = event.currentTarget.value; if (value) navigate(`/sources/${encodeURIComponent(value)}/browse`); }}><option value="" disabled>选择来源</option>{sources.data?.filter(item => item.enabled && item.descriptor).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></section></main></div>;
  const supportsSearch = source.descriptor?.capabilities.includes('search');
  const supportsBrowse = source.descriptor?.capabilities.includes('browse');
  return <div className="sources-screen source-catalog-screen">
    <SourcesHeader title={source.name} subtitle={source.descriptor?.label ?? '书源目录'} />
    <main className="sources-body">
    {error && <Callout tone="error" onDismiss={() => setError('')}>{error}</Callout>}
    {supportsSearch && <section className="sources-card source-catalog"><form className="sources-search" onSubmit={event => { event.preventDefault(); void search(false); }}><label className="source-keyword">搜索书籍<input type="search" placeholder="输入书名或作者" value={query} onChange={event => setQuery(event.currentTarget.value)} required /></label>{filterQuery.data?.map(field => field.type === 'select' ? <label key={field.key}>{field.label}<select value={filters[field.key] ?? ''} onChange={event => { const value = event.currentTarget.value; setFilters(previous => ({ ...previous, [field.key]: value })); }}><option value="">不限</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label> : null)}<Button type="submit" className="primary" disabled={busy}>搜索</Button>{page?.nextCursor && <Button type="button" disabled={busy} onClick={() => void search(true)}>继续搜索</Button>}</form></section>}
    <div className="source-catalog-actions">{supportsBrowse && <Button disabled={busy} onClick={() => void browse()}>浏览目录首页</Button>}</div>
    {page?.batch && <p className="muted">已检查 {page.batch.completed} / {page.batch.total} 个来源</p>}
    {page?.navigation && <nav className="source-navigation sources-actions" aria-label="目录">{page.navigation.map(item => <Button key={item.ref} onClick={() => void browse(item.ref)}>{item.title}</Button>)}</nav>}
    {page?.errors?.map(item => <Callout tone="warning" key={`${item.source}-${item.code}`}>{item.source}: {item.message}</Callout>)}
    {!page && !busy && <Callout>输入关键词搜索，或浏览书源目录</Callout>}
    {busy && !page && <FloatingNotice message="正在搜索…" busy />}
    <section className="sources-card"><div className="source-results">{page?.items.map(item => { const option = item.options?.[0]; return <article className="sources-row catalog-book" key={item.ref}><div><strong>{item.title}</strong>{item.latestChapter && <small>{item.latestChapter}</small>}{item.authors?.length ? <small>{item.authors.join('、')}</small> : null}{item.description && <p className="source-description">{item.description}</p>}</div><div className="sources-actions"><Button onClick={() => setDetail(item)}>详情</Button><Button className="primary" disabled={(option?.available === false) || (acquire.isPending)} onClick={() => acquireEntry(item, option?.id)}>{option?.label ?? '加入书架'}</Button></div></article>; })}</div></section>
    {page && !busy && page.items.length === 0 && <Callout>没有找到匹配的书籍</Callout>}
    {detail && <SourceBookDetailSheet detail={detail} pending={detailQuery.isPending} error={detailQuery.error} acquiring={acquire.isPending} onAcquire={acquireEntry} onClose={() => setDetail(null)} />}
    </main>
  </div>;
}
