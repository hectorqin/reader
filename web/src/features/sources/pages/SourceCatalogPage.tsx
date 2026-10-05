import { Alert, Button, Group, Modal, Select, Stack, Text } from '@mantine/core';
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
  return { ...page, items: [...items.values()] };
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
  const acquire = useMutation({ mutationFn: ({ ref, option }: { ref: string; option?: string }) => api.acquireSource(sourceId, ref, option), onError: reason => setError(reason instanceof Error ? reason.message : '加入书架失败') });
  useEffect(() => { if (detail && detailQuery.data) setDetail({ ...detail, ...detailQuery.data }); }, [detailQuery.data]);
  useEffect(() => { const next = params.get('q') ?? ''; if (next !== query) setQuery(next); }, [params]);
  const acquireEntry = (entry: SourceEntry, option?: string) => acquire.mutate(option === undefined ? { ref: entry.ref } : { ref: entry.ref, option }, { onSuccess: result => { if (result.kind === 'action-required') setError(result.action?.label ?? '请先完成授权'); else if (result.publicationId) navigate(`/book/${encodeURIComponent(result.publicationId)}`); } });

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
  if (!source) return <div className="sources-screen source-catalog-screen"><header className="sources-header"><Button className="button icon-button" variant="subtle" onClick={() => navigate('/sources')} aria-label="返回">←</Button><h1>选择书源</h1></header><main className="sources-body"><section className="sources-card source-picker"><h2>选择来源</h2><p className="muted">选择一个已启用的书源开始搜索或浏览。</p><Select label="书源" placeholder="选择来源" data={sources.data?.filter(item => item.enabled && item.descriptor).map(item => ({ value: item.id, label: item.name })) ?? []} onChange={value => value && navigate(`/sources/${encodeURIComponent(value)}/browse`)} /></section></main></div>;
  const supportsSearch = source.descriptor?.capabilities.includes('search');
  const supportsBrowse = source.descriptor?.capabilities.includes('browse');
  return <div className="sources-screen source-catalog-screen">
    <header className="sources-header"><Button className="button icon-button" variant="subtle" onClick={() => navigate('/sources')} aria-label="返回">←</Button><div><h1>{source.name}</h1><p className="muted">{source.descriptor?.label ?? '书源目录'}</p></div></header>
    <main className="sources-body">
    {error && <Alert color="red" withCloseButton onClose={() => setError('')}>{error}</Alert>}
    {supportsSearch && <section className="sources-card source-catalog"><form className="sources-search" onSubmit={event => { event.preventDefault(); void search(false); }}><label className="source-keyword">搜索书籍<input type="search" placeholder="输入书名或作者" value={query} onChange={event => setQuery(event.currentTarget.value)} required /></label>{filterQuery.data?.map(field => field.type === 'select' ? <label key={field.key}>{field.label}<Select value={filters[field.key] ?? ''} data={field.options?.map(option => ({ value: option.value, label: option.label })) ?? []} onChange={value => setFilters(previous => ({ ...previous, [field.key]: value ?? '' }))} /></label> : null)}<Button type="submit" loading={busy}>搜索</Button>{page?.nextCursor && <Button type="button" variant="light" loading={busy} onClick={() => void search(true)}>继续搜索</Button>}</form></section>}
    <div className="source-catalog-actions">{supportsBrowse && <Button className="button" variant="light" loading={busy} onClick={() => void browse()}>浏览目录首页</Button>}</div>
    {page?.batch && <Text size="sm" c="dimmed">已检查 {page.batch.completed} / {page.batch.total} 个来源</Text>}
    {page?.navigation && <Group className="source-navigation">{page.navigation.map(item => <Button className="button" key={item.ref} variant="subtle" onClick={() => void browse(item.ref)}>{item.title}</Button>)}</Group>}
    {page?.errors?.map(item => <Alert key={`${item.source}-${item.code}`} color="yellow">{item.source}: {item.message}</Alert>)}
    {!page && !busy && <Alert>输入关键词搜索，或浏览书源目录。</Alert>}
    {busy && !page && <FloatingNotice message="正在搜索…" busy />}
    <section className="sources-card"><div className="source-results">{page?.items.map(item => { const option = item.options?.[0]; return <article className="sources-row catalog-book" key={item.ref}><div><strong>{item.title}</strong>{item.latestChapter && <small>{item.latestChapter}</small>}{item.authors?.length ? <small>{item.authors.join('、')}</small> : null}{item.description && <p className="source-description">{item.description}</p>}</div><div className="sources-actions"><Button className="button" onClick={() => setDetail(item)}>详情</Button><Button className="button primary" disabled={option?.available === false} loading={acquire.isPending} onClick={() => acquireEntry(item, option?.id)}>{option?.label ?? '加入书架'}</Button></div></article>; })}</div></section>
    {page && !busy && page.items.length === 0 && <Alert>没有找到匹配书籍。</Alert>}
    <Modal opened={!!detail} onClose={() => setDetail(null)} title={detail?.title ?? '书籍详情'}>
      <Stack>
        {detailQuery.isPending && <FloatingNotice message="正在读取书籍详情…" busy />}
        {detailQuery.error && <Alert color="red">{detailQuery.error.message}</Alert>}
        {detail && <>
          <Text>{detail.description || '暂无简介'}</Text>
          <Text size="sm" c="dimmed">{detail.authors?.join('、') || '作者未知'}</Text>
          {detail.options?.map(option => <Button key={option.id} disabled={option.available === false} loading={acquire.isPending} onClick={() => acquireEntry(detail, option.id)}>{option.label}</Button>)}
          {(!detail.options || detail.options.length === 0) && <Button loading={acquire.isPending} onClick={() => acquireEntry(detail)}>加入书架</Button>}
        </>}
      </Stack>
    </Modal>
    </main>
  </div>;
}
