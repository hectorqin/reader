import { Alert, Badge, Button, Card, Group, Loader, Modal, Select, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { SourceEntry, SourcePage } from '../../../api/sources.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useSources } from '../hooks/sourceQueries.ts';

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
  const [filters, setFilters] = useState<Record<string, string>>({});
  const filterQuery = useQuery({ queryKey: ['source-filters', api.baseUrl, sourceId], queryFn: () => api.sourceFilters(sourceId), enabled: !!source?.descriptor?.capabilities.includes('search.filters') });
  const detailQuery = useQuery({ queryKey: ['source-detail', api.baseUrl, sourceId, detail?.ref], queryFn: () => api.sourceDetail(sourceId, detail!.ref), enabled: !!detail });
  const acquire = useMutation({ mutationFn: ({ ref, option }: { ref: string; option?: string }) => api.acquireSource(sourceId, ref, option), onError: reason => setError(reason instanceof Error ? reason.message : '加入书架失败') });
  useEffect(() => { if (detail && detailQuery.data) setDetail({ ...detail, ...detailQuery.data }); }, [detailQuery.data]);

  const search = async (append = false) => {
    const term = query.trim(); if (!term || !source) return;
    setBusy(true); setError(''); setParams(previous => { const next = new URLSearchParams(previous); next.set('q', term); if (!append) next.delete('cursor'); return next; });
    try {
      let merged = append ? page : undefined;
      const sessionId = crypto.randomUUID();
      for await (const chunk of api.searchSource(source.id, { query: term, sessionId, ...(append && cursor ? { cursor } : {}), filters, resultLimit: 10000 })) {
        merged = mergePages(merged, chunk); setPage(merged); setCursor(chunk.nextCursor); if (chunk.limitReached) break;
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '搜索失败'); }
    finally { setBusy(false); }
  };
  const browse = async (ref?: string) => {
    if (!source) return; setBusy(true); setError('');
    try { const next = await api.sourceCatalog(source.id, ref ? { ref } : {}); setPage(next); setCursor(next.nextCursor); setParams(previous => { const value = new URLSearchParams(previous); if (ref) value.set('ref', ref); else value.delete('ref'); return value; }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '目录加载失败'); }
    finally { setBusy(false); }
  };
  if (sources.isPending) return <Loader />;
  if (!source) return <Stack p="md" maw={600} mx="auto"><Title order={1}>选择书源</Title><Text c="dimmed">选择一个已启用的书源开始搜索或浏览。</Text><Select label="书源" placeholder="选择来源" data={sources.data?.filter(item => item.enabled && item.descriptor).map(item => ({ value: item.id, label: item.name })) ?? []} onChange={value => value && navigate(`/sources/${encodeURIComponent(value)}/browse`)} /><Button variant="subtle" onClick={() => navigate('/sources')}>返回书源管理</Button></Stack>;
  const supportsSearch = source.descriptor?.capabilities.includes('search');
  const supportsBrowse = source.descriptor?.capabilities.includes('browse');
  return <Stack p="md" maw={1200} mx="auto">
    <Group justify="space-between"><div><Title order={1}>{source.name}</Title><Text c="dimmed">{source.descriptor?.label ?? '书源目录'}</Text></div><Button variant="subtle" onClick={() => navigate('/sources')}>返回书源</Button></Group>
    {error && <Alert color="red" withCloseButton onClose={() => setError('')}>{error}</Alert>}
    {supportsSearch && <Card withBorder><form onSubmit={event => { event.preventDefault(); void search(false); }}><Stack><TextInput label="搜索书名或作者" value={query} onChange={event => setQuery(event.currentTarget.value)} required /><Group>{filterQuery.data?.map(field => field.type === 'select' ? <Select key={field.key} label={field.label} value={filters[field.key] ?? ''} data={field.options?.map(option => ({ value: option.value, label: option.label })) ?? []} onChange={value => setFilters(previous => ({ ...previous, [field.key]: value ?? '' }))} /> : null)}<Button type="submit" loading={busy}>搜索</Button>{page?.nextCursor && <Button type="button" variant="light" loading={busy} onClick={() => void search(true)}>继续搜索</Button>}</Group></Stack></form></Card>}
    {supportsBrowse && <Button variant="light" loading={busy} onClick={() => void browse()}>浏览目录首页</Button>}
    {page?.batch && <Text size="sm" c="dimmed">已检查 {page.batch.completed} / {page.batch.total} 个来源</Text>}
    {page?.navigation && <Group>{page.navigation.map(item => <Button key={item.ref} variant="subtle" onClick={() => void browse(item.ref)}>{item.title}</Button>)}</Group>}
    {page?.errors?.map(item => <Alert key={`${item.source}-${item.code}`} color="yellow">{item.source}: {item.message}</Alert>)}
    {!page && !busy && <Alert>输入关键词搜索，或浏览书源目录。</Alert>}
    {busy && !page && <Loader />}
    <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>{page?.items.map(item => <Card key={item.ref} withBorder shadow="sm"><Stack><Group justify="space-between"><Text fw={600}>{item.title}</Text>{item.latestChapter && <Badge>{item.latestChapter}</Badge>}</Group>{item.authors?.length ? <Text size="sm" c="dimmed">{item.authors.join('、')}</Text> : null}{item.description && <Text size="sm" lineClamp={3}>{item.description}</Text>}<Button onClick={() => setDetail(item)}>查看详情</Button></Stack></Card>)}</SimpleGrid>
    {page && !busy && page.items.length === 0 && <Alert>没有找到匹配书籍。</Alert>}
    <Modal opened={!!detail} onClose={() => setDetail(null)} title={detail?.title ?? '书籍详情'}><Stack>{detailQuery.isPending && <Loader />}{detailQuery.error && <Alert color="red">{detailQuery.error.message}</Alert>}{detail && <><Text>{detail.description || '暂无简介'}</Text><Text size="sm" c="dimmed">{detail.authors?.join('、') || '作者未知'}</Text>{detail.options?.map(option => <Button key={option.id} disabled={option.available === false} loading={acquire.isPending} onClick={() => acquire.mutate({ ref: detail.ref, option: option.id }, { onSuccess: result => { if (result.kind === 'action-required') setError(result.action?.label ?? '请先完成授权'); else if (result.publicationId) navigate(`/book/${encodeURIComponent(result.publicationId)}`); } })}>{option.label}</Button>)}{(!detail.options || detail.options.length === 0) && <Button loading={acquire.isPending} onClick={() => acquire.mutate({ ref: detail.ref }, { onSuccess: result => { if (result.kind === 'action-required') setError(result.action?.label ?? '请先完成授权'); else if (result.publicationId) navigate(`/book/${encodeURIComponent(result.publicationId)}`); } })}>加入书架</Button>}</>}</Stack></Modal>
  </Stack>;
}
