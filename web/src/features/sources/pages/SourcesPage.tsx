import { Alert, Button, Modal, Stack, Text } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Plus, Search } from 'lucide-react';
import type { ExtensionField, SourceEntry, SourcePage } from '../../../api/sources.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { mergePages } from './SourceCatalogPage.tsx';
import { SearchableSelect } from '../../../ui/searchable-select.tsx';
import { groupSourceResults } from '../../../ui/source-results.ts';
import { CatalogFeedback } from '../../../ui/catalog-feedback.tsx';

type SourceTab = 'search' | 'sources' | 'updates' | 'plugins';
type SearchState = 'idle' | 'searching' | 'stopped' | 'complete' | 'error' | 'limited';

export function SourcesPage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const admin = useAuthStore(state => state.verifiedUser?.role === 'admin');
  const [tab, setTab] = useState<SourceTab>('search');
  const [sourceId, setSourceId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [managing, setManaging] = useState<string | null>(null);
  const [catalogPage, setCatalogPage] = useState<SourcePage>();
  const [catalogError, setCatalogError] = useState('');
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogFilters, setCatalogFilters] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<SourceEntry | null>(null);
  const [searchState, setSearchState] = useState<SearchState>('idle');
  const [searchMenu, setSearchMenu] = useState(false);
  const [resultGroupKey, setResultGroupKey] = useState<string | null>(null);
  const [resultGroupQuery, setResultGroupQuery] = useState('');
  const [sourceNameQuery, setSourceNameQuery] = useState('');
  const [acquired, setAcquired] = useState<{ id: string; ref: string; title: string } | null>(null);
  const searchSession = useRef<string | null>(null);
  const searchRequest = useRef<{ query: string; filters: Record<string, string> } | null>(null);
  const searchRun = useRef<AbortController | null>(null);
  const catalogEpoch = useRef(0);
  const sources = useQuery({ queryKey: ['sources', runtime.api.baseUrl], queryFn: () => runtime.api.sources() });
  const types = useQuery({ queryKey: ['source-types', runtime.api.baseUrl], queryFn: () => runtime.api.sourceTypes(), staleTime: 300_000 });
  const subscriptions = useQuery({ queryKey: ['subscriptions', runtime.api.baseUrl], queryFn: () => runtime.api.subscriptions(), enabled: tab === 'updates' });
  const plugins = useQuery({ queryKey: ['source-plugins', runtime.api.baseUrl], queryFn: () => runtime.api.plugins(), enabled: tab === 'plugins' && admin });
  const [busy, setBusy] = useState<string | null>(null);
  const enabledSources = (sources.data ?? []).filter(source => source.enabled && source.descriptor);
  const selectedSourceId = sourceId || enabledSources.find(source => source.isDefault)?.id || enabledSources[0]?.id || '';
  const selectedSource = enabledSources.find(source => source.id === selectedSourceId);
  const sourceFilters = useQuery({ queryKey: ['source-filters', runtime.api.baseUrl, selectedSourceId], queryFn: () => runtime.api.sourceFilters(selectedSourceId), enabled: !!selectedSourceId && !!selectedSource?.descriptor?.capabilities.includes('search.filters') });
  const detailQuery = useQuery({ queryKey: ['source-detail', runtime.api.baseUrl, selectedSourceId, detail?.ref], queryFn: () => runtime.api.sourceDetail(selectedSourceId, detail!.ref), enabled: !!detail });
  const acquire = useMutation({ mutationFn: ({ ref, option }: { ref: string; option?: string }) => runtime.api.acquireSource(selectedSourceId, ref, option), onError: reason => setCatalogError(reason instanceof Error ? reason.message : '加入书架失败') });
  const grouped = searchState !== 'idle' && !(selectedSource?.descriptor?.builtin && selectedSource.sourceType === 'local');
  const results = groupSourceResults(catalogPage?.items ?? [], grouped);
  const activeGroup = results.find(group => group.key === resultGroupKey);
  const canResume = !!searchSession.current && !!searchRequest.current && searchState !== 'limited'
    && !!(catalogPage?.nextCursor || searchState === 'stopped' || searchState === 'error')
    && keyword.trim() === searchRequest.current.query && JSON.stringify(catalogFilters) === JSON.stringify(searchRequest.current.filters);
  const resume = canResume && (searchState === 'stopped' || searchState === 'error');
  const filterOptions = (field: ExtensionField) => {
    const parent = catalogFilters[field.changeAction ?? field.dependsOn ?? ''];
    return (field.options ?? []).filter(option => !parent || !option.parentValues || option.parentValues.includes(parent));
  };
  useEffect(() => { if (!sourceId && selectedSourceId) setSourceId(selectedSourceId); }, [selectedSourceId, sourceId]);
  const sourceTypeLabel = (id: string) => types.data?.find(item => item.id === id)?.label ?? id;
  const loadCatalog = async (ref?: string) => {
    if (!selectedSourceId || !selectedSource?.descriptor?.capabilities.includes('browse')) return;
    const epoch = ++catalogEpoch.current;
    setCatalogBusy(true); setCatalogError(''); setSearchState('idle'); setResultGroupKey(null); setAcquired(null);
    try { const page = await runtime.api.sourceCatalog(selectedSourceId, ref ? { ref } : {}); if (catalogEpoch.current === epoch) setCatalogPage(page); }
    catch (reason) { if (catalogEpoch.current === epoch) setCatalogError(reason instanceof Error ? reason.message : '目录加载失败'); }
    finally { if (catalogEpoch.current === epoch) setCatalogBusy(false); }
  };
  const stopSearch = () => { searchRun.current?.abort(); searchRun.current = null; setCatalogBusy(false); setSearchState('stopped'); };
  const searchSources = async (append = false) => {
    const request = append ? searchRequest.current : { query: keyword.trim(), filters: { ...catalogFilters } };
    if (!request?.query || !selectedSource || catalogBusy || (append && !canResume)) return;
    const run = new AbortController(); searchRun.current = run; ++catalogEpoch.current;
    const current = () => searchRun.current === run;
    setCatalogBusy(true); setCatalogError(''); setSearchState('searching'); setSearchMenu(false);
    if (!append) { setCatalogPage(undefined); searchSession.current = crypto.randomUUID(); setAcquired(null); setResultGroupKey(null); }
    searchRequest.current = request;
    try {
      let merged: SourcePage | undefined = append ? catalogPage : undefined;
      for await (const page of runtime.api.searchSource(selectedSource.id, { ...request, sessionId: searchSession.current!, ...(append && catalogPage?.nextCursor ? { cursor: catalogPage.nextCursor } : {}), resultLimit: 10000 }, { signal: run.signal })) {
        if (!current()) return;
        merged = mergePages(merged, page); setCatalogPage(merged);
        if (page.limitReached) { setSearchState('limited'); break; }
      }
      if (current()) setSearchState(previous => previous === 'limited' ? previous : 'complete');
    } catch (reason) { if (current()) { setCatalogError(reason instanceof Error ? reason.message : '搜索失败，已保留找到的书籍。'); setSearchState('error'); } }
    finally { if (current()) { searchRun.current = null; setCatalogBusy(false); } }
  };
  const acquireEntry = (entry: SourceEntry, option?: string) => acquire.mutate(option === undefined ? { ref: entry.ref } : { ref: entry.ref, option }, { onSuccess: result => { if (result.kind === 'action-required') setCatalogError(result.action?.label ?? '请先完成授权'); else if (result.publicationId) { setAcquired({ id: result.publicationId, ref: entry.ref, title: entry.title }); void queryClient.invalidateQueries({ queryKey: ['shelf'] }); } } });
  const mutateSubscription = async (id: string, enabled?: boolean) => { setBusy(id); try { if (enabled === undefined) await runtime.api.refreshPublication(id); else await runtime.api.configureSubscription(id, { enabled }); await queryClient.invalidateQueries({ queryKey: ['subscriptions'] }); } finally { setBusy(null); } };
  const updateSource = async (id: string, patch: { enabled?: boolean; isDefault?: boolean }) => { setBusy(id); try { await runtime.api.saveSource(id, patch); await sources.refetch(); setManaging(null); } finally { setBusy(null); } };
  useEffect(() => {
    ++catalogEpoch.current; searchRun.current?.abort(); searchRun.current = null;
    setCatalogBusy(false); setCatalogPage(undefined); setCatalogError(''); setCatalogFilters({}); setDetail(null); searchSession.current = null;
    setSearchState('idle'); setKeyword(''); setResultGroupKey(null); setResultGroupQuery(''); setSourceNameQuery(''); searchRequest.current = null;
    if (selectedSource?.descriptor?.capabilities.includes('browse')) void loadCatalog();
    return () => { ++catalogEpoch.current; searchRun.current?.abort(); searchRun.current = null; };
  }, [selectedSourceId]);
  useEffect(() => { if (detail && detailQuery.data) setDetail({ ...detail, ...detailQuery.data }); }, [detailQuery.data]);
  return <div className="sources-screen sources-hub">
    <header className="sources-header">
      <Link className="icon-button" to="/shelf" aria-label="返回" title="返回"><ArrowLeft size={20} /></Link>
      <h1>书源与追更</h1>
      <span aria-hidden="true" />
    </header>
    <nav className="sources-tabs" role="tablist" aria-label="书源功能">
      {([['search', '搜书'], ['sources', '书源管理'], ['updates', '自动追更'], ...(admin ? [['plugins', '插件管理']] : [])] as Array<[SourceTab, string]>).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}{id === 'updates' && (subscriptions.data ?? []).some(item => item.newChapters > 0) && <span className="sources-tab-dot" aria-label="有更新" />}</button>)}
    </nav>
    <main className="sources-body" role="tabpanel">
      {tab === 'search' && <>
        <section className="sources-card source-picker">
          <div><h2>搜书</h2><p className="muted">选择来源，发现想读的书。</p></div>
          <SearchableSelect label="选择来源" value={selectedSourceId} options={enabledSources.map(source => ({ value: source.id, label: source.name + (source.isDefault ? '（默认）' : '') }))} onChange={setSourceId} />
          {!selectedSourceId && <p className="muted">{enabledSources.length ? '选择来源后，即可搜索书籍或浏览目录。' : '暂无可用来源，请先添加或启用来源。'}</p>}
        </section>
        {selectedSource && <section className="sources-card source-catalog"><h2>搜索与浏览</h2>
          {catalogError && <Alert color="red" withCloseButton onClose={() => setCatalogError('')}>{catalogError}</Alert>}
          {selectedSource.descriptor?.capabilities.includes('search') && <form className="sources-search" onSubmit={event => { event.preventDefault(); void searchSources(resume); }}>
            {sourceFilters.data?.filter(field => field.type === 'select').map(field => <SearchableSelect key={field.key} label={field.label} value={catalogFilters[field.key] ?? ''} disabled={catalogBusy} options={filterOptions(field)} onChange={value => setCatalogFilters(previous => { const next = { ...previous, [field.key]: value }; for (const dependent of sourceFilters.data ?? []) { if ((dependent.changeAction ?? dependent.dependsOn) === field.key && !dependent.options?.some(option => option.value === next[dependent.key] && (!option.parentValues || !value || option.parentValues.includes(value)))) next[dependent.key] = ''; } return next; })} />)}
            <label className="source-keyword">搜索书籍<input type="search" placeholder="输入书名或作者" required disabled={catalogBusy} value={keyword} onChange={event => setKeyword(event.currentTarget.value)} /></label>
            {searchState === 'searching' ? <button className="button search-stop" type="button" onClick={stopSearch}>停止搜索</button> : <div className="search-split"><button className="button primary" type="submit" disabled={catalogBusy}><Search size={16} />{resume ? '继续搜索' : '搜索'}</button>{searchRequest.current && <><button className="button primary search-menu-toggle" type="button" aria-label="搜索选项" aria-haspopup="menu" aria-expanded={searchMenu} onClick={() => setSearchMenu(open => !open)}><ChevronRight size={16} /></button>{searchMenu && <div className="search-menu" role="menu" aria-label="搜索选项"><button type="button" role="menuitem" disabled={!canResume} onClick={() => void searchSources(true)}>继续搜索<small>保留结果，继续未完成的来源</small></button><button type="button" role="menuitem" onClick={() => void searchSources(false)}>重新搜索<small>清空结果，从头搜索</small></button></div>}</>}</div>}
          </form>}
          {searchState !== 'idle' && <div className="search-progress" role="status"><span>{({ searching: '正在搜索', stopped: '已停止搜索', complete: '搜索完成', error: '搜索中断', limited: '已达到结果上限' })[searchState]}{catalogPage?.batch ? ` · 已检查 ${catalogPage.batch.completed} / ${catalogPage.batch.total} 个来源` : ''} · 已找到 {results.length} 本书</span>{catalogPage?.batch && <progress aria-label="书源搜索进度" max={Math.max(1, catalogPage.batch.total)} value={catalogPage.batch.completed} />}</div>}
          {catalogPage && grouped && <label className="catalog-group-filter">筛选分组<input type="search" placeholder="搜索书名或作者" value={resultGroupQuery} onChange={event => setResultGroupQuery(event.currentTarget.value)} /></label>}
          {catalogPage && <CatalogFeedback page={catalogPage} count={results.length} merged={searchState !== 'idle'} searching={searchState === 'searching'} />}
          {catalogPage?.navigation && <div className="source-navigation">{catalogPage.navigation.map(item => <Button className="button" key={item.ref} variant="subtle" onClick={() => void loadCatalog(item.ref)}>{item.title}</Button>)}</div>}
          {catalogBusy && !catalogPage && <FloatingNotice message="正在加载目录…" busy />}
          {catalogPage && <div className="source-results">{results.filter(group => { const q = resultGroupQuery.trim().toLocaleLowerCase(); return !q || group.entry.title.toLocaleLowerCase().includes(q) || group.entry.authors?.some(author => author.toLocaleLowerCase().includes(q)); }).map(group => <article className="sources-row catalog-book" key={group.key}><div><strong>{group.entry.title}</strong><small>{group.entry.authors?.join(' / ') || '作者未知'}</small>{!grouped && group.entry.description && <p className="source-description">{group.entry.description}</p>}</div>{grouped ? <button className="button catalog-source-count" type="button" onClick={() => setResultGroupKey(group.key)}><span>{group.entries.length} 条书源</span><ChevronRight size={16} /></button> : <div className="sources-actions"><button className="button" type="button" onClick={() => setDetail(group.entry)}>详情</button>{(group.entry.options?.length ? group.entry.options : [{ id: '', label: '加入书架' }]).map(option => <button className="button primary" type="button" key={option.id} disabled={option.available === false || acquire.isPending} onClick={() => acquireEntry(group.entry, option.id)}>{option.label}</button>)}</div>}</article>)}</div>}
          {catalogPage && !catalogBusy && !catalogPage.items.length && <div className="catalog-empty"><strong>没有找到匹配书籍</strong><p>试试其他关键词，或调整搜索范围。</p></div>}
          {searchState === 'complete' && catalogPage?.nextCursor && <div className="catalog-pagination"><button className="button" type="button" disabled={!canResume} onClick={() => void searchSources(true)}>加载更多结果</button></div>}
          {acquired && <button className="button" type="button" onClick={() => navigate(`/book/${encodeURIComponent(acquired.id)}`)}>阅读《{acquired.title}》</button>}
        </section>}
      </>}
      {tab === 'sources' && <section className="sources-card sources-list">
        <div className="sources-list-heading"><h2>我的来源 <span className="source-count">{sources.data?.length ?? 0}</span></h2>{admin && <Link className="button source-add" to="/sources/manage/new"><Plus size={16} />添加来源</Link>}</div>
        {sources.isPending && <FloatingNotice message="正在加载书源…" busy />}{sources.error && <p className="notice error">{sources.error.message}</p>}{!sources.isPending && !sources.data?.length && <p className="muted">还没有配置书源。请添加来源或启用插件。</p>}
        {(sources.data ?? []).map(source => <article className="sources-row source-entry" key={source.id}><div className="source-entry-top"><div className="source-entry-info"><strong>{source.name}{source.isDefault && <span className="source-default-badge">默认</span>}</strong><small>{source.descriptor?.label ?? sourceTypeLabel(source.sourceType)}</small><span className={'source-state' + (source.enabled ? ' is-enabled' : '')}>{source.enabled ? '已启用' : '已暂停'}</span></div><div className="source-entry-actions">{source.descriptor?.credentialKeys?.length ? <Link className="button" to={'/sources/' + encodeURIComponent(source.id) + '/credentials'}>书源登录</Link> : null}{admin && <button className="source-manage-trigger" type="button" aria-expanded={managing === source.id} onClick={() => setManaging(current => current === source.id ? null : source.id)}>管理<ChevronRight size={16} /></button>}</div></div>{admin && managing === source.id && <div className="source-management" role="group" aria-label={`${source.name}管理`}>{source.descriptor?.extensions?.pages?.map(page => <Link className="source-management-link" key={page.id} to={'/sources/' + encodeURIComponent(source.id) + '/' + encodeURIComponent(page.id)}>{page.title}<ChevronRight size={16} /></Link>)}<Link className="source-management-link" to={'/sources/manage/' + encodeURIComponent(source.id)}>基本设置<ChevronRight size={16} /></Link><button className="source-management-link" type="button" disabled={busy === source.id || (!source.isDefault && (!source.enabled || !source.descriptor?.capabilities.includes('search')))} onClick={() => void updateSource(source.id, { isDefault: !source.isDefault })}>{source.isDefault ? '取消默认' : '设为默认'}</button><button className="source-management-link source-toggle" type="button" disabled={busy === source.id} onClick={() => void updateSource(source.id, { enabled: !source.enabled })}>{source.enabled ? '暂停' : '启用'}</button></div>}</article>)}
      </section>}
      {tab === 'updates' && <section className="sources-card"><h2>自动追更</h2><p className="notice">服务端定时检查目录，浏览器关闭后继续运行。正文和图片在阅读时缓存。</p>{subscriptions.isPending && <FloatingNotice message="正在加载追更列表…" busy />}{!subscriptions.isPending && !subscriptions.data?.length && <p>先从章节书源加入书籍，再开启追更。</p>}{(subscriptions.data ?? []).map(item => <article className="sources-row" key={item.bookId}><div><strong>{item.title}</strong><small>{item.newChapters ? '新增 ' + item.newChapters + ' 章 · ' : ''}上次成功：{item.lastSuccessAt ? new Date(item.lastSuccessAt).toLocaleString() : '尚未检查'}</small><small>{item.enabled ? '下次检查：' + new Date(item.nextCheckAt).toLocaleString() : '自动追更已关闭'}{item.lastError ? ' · 检查失败：' + item.lastError : ''}</small></div><div className="sources-actions"><label className="source-interval">检查间隔<select aria-label={`${item.title}检查间隔`} value={item.intervalMinutes} disabled={busy === item.bookId} onChange={event => { const intervalMinutes = Number(event.currentTarget.value); setBusy(item.bookId); void runtime.api.configureSubscription(item.bookId, { intervalMinutes }).then(() => queryClient.invalidateQueries({ queryKey: ['subscriptions'] })).finally(() => setBusy(null)); }}><option value="15">15 分钟</option><option value="60">1 小时</option><option value="360">6 小时</option><option value="1440">1 天</option></select></label><button className="button" type="button" disabled={busy === item.bookId} onClick={() => void mutateSubscription(item.bookId, !item.enabled)}>{item.enabled ? '关闭追更' : '开启追更'}</button><button className="button" type="button" disabled={busy === item.bookId} onClick={() => void mutateSubscription(item.bookId)}>立即检查</button><Link className="button" to={'/book/' + encodeURIComponent(item.bookId)}>阅读</Link></div></article>)}</section>}
      {tab === 'plugins' && admin && <section className="sources-card"><h2>插件管理</h2><Link className="button primary" to="/sources/plugins">插件安装与管理</Link>{plugins.isPending && <FloatingNotice message="正在加载插件列表…" busy />}{(plugins.data ?? []).map(plugin => <article className="sources-row" key={plugin.pluginId}><div><strong>{plugin.name || plugin.pluginId}</strong><small>{plugin.version || '未知版本'} · {plugin.builtin ? '内置' : plugin.enabled ? '已启用' : '已停用'}</small></div></article>)}</section>}
    </main>
    {activeGroup && <Modal opened onClose={() => { setResultGroupKey(null); setSourceNameQuery(''); }} title="书源列表"><Stack><Text>{activeGroup.entry.title} · {activeGroup.entries.length} 条书源</Text><input className="catalog-source-search" type="search" placeholder="搜索书源" value={sourceNameQuery} onChange={event => setSourceNameQuery(event.currentTarget.value)} />{activeGroup.entries.filter(entry => (entry.sourceName ?? selectedSource?.name ?? '').toLocaleLowerCase().includes(sourceNameQuery.trim().toLocaleLowerCase())).map(entry => { const option = entry.options?.[0]; return <article className="catalog-source-item" key={entry.ref}><div><strong>{entry.sourceName ?? selectedSource?.name}</strong><p className="source-description">最新章节：{entry.latestChapter || '暂无信息'}</p></div><div className="sources-actions"><Button className="button" onClick={() => setDetail(entry)}>详情</Button><Button className="button primary" disabled={option?.available === false} onClick={() => acquireEntry(entry, option?.id)}>{option?.label ?? '加入书架'}</Button></div></article>; })}</Stack></Modal>}
    <Modal opened={!!detail} onClose={() => setDetail(null)} title={detail?.title ?? '书籍详情'}><Stack>{detailQuery.isPending && <FloatingNotice message="正在读取书籍详情…" busy />}{detailQuery.error && <Alert color="red">{detailQuery.error.message}</Alert>}{detail && <><Text>{detail.description || '暂无简介'}</Text><Text size="sm" c="dimmed">{detail.authors?.join('、') || '作者未知'}</Text>{detail.options?.map(option => <Button key={option.id} disabled={option.available === false} loading={acquire.isPending} onClick={() => acquireEntry(detail, option.id)}>{option.label}</Button>)}{(!detail.options || detail.options.length === 0) && <Button loading={acquire.isPending} onClick={() => acquireEntry(detail)}>加入书架</Button>}</>}</Stack></Modal>
  </div>;
}
