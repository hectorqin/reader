import { Alert, Badge, Button, Card, Center, Checkbox, Group, Loader, Pagination, SegmentedControl, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Book, ContinueReadingItem } from '../../../api/types.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useSettingsStore } from '../../../shared/stores/settings.store.ts';
import { useShelf } from '../queries/shelf.queries.ts';
import { SHELF_SORTS } from '../../../ui/shelf-settings.tsx';

const coverCache = new WeakMap<object, Map<string, string>>();
function useCover(api: ReturnType<typeof useRuntime>['api'], coverUrl: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!coverUrl) { setSrc(null); return; }
    let cache = coverCache.get(api) as Map<string, string> | undefined;
    if (!cache) { cache = new Map(); coverCache.set(api, cache); }
    const cached = cache.get(coverUrl);
    if (cached) { setSrc(cached); return; }
    let live = true;
    void api.coverBytes(coverUrl).then(bytes => {
      const objectUrl = URL.createObjectURL(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'image/jpeg' }));
      cache!.set(coverUrl, objectUrl); if (live) setSrc(objectUrl);
    }).catch(() => { if (live) setSrc(null); });
    return () => { live = false; };
  }, [api, coverUrl]);
  return src;
}

function BookCard({ book, showAuthor, showProgress }: { book: Book | ContinueReadingItem; showAuthor: boolean; showProgress: boolean }) {
  const runtime = useRuntime();
  const src = useCover(runtime.api, book.coverUrl);
  const progress = 'percentage' in book ? book.percentage : undefined;
  return <Card withBorder padding="sm" component={Link} to={`/book/${encodeURIComponent(book.id)}`} style={{ textDecoration: 'none' }}>
    <Stack gap="xs"><div style={{ position: 'relative', aspectRatio: '2 / 3', overflow: 'hidden', borderRadius: 6, background: 'var(--mantine-color-gray-1)' }}>{src ? <img src={src} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Center h="100%"><Text c="dimmed" ta="center" lineClamp={3}>{book.title || '无封面'}</Text></Center>}{showProgress && progress !== undefined && progress > 0 && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 5, background: 'var(--mantine-color-gray-3)' }}><div style={{ width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`, height: '100%', background: 'var(--mantine-color-blue-6)' }} /></div>}</div><Text fw={600} lineClamp={2}>{book.title || '未命名'}</Text>{showAuthor && <Text size="sm" c="dimmed" lineClamp={1}>{book.author || '未知作者'}</Text>}</Stack>
  </Card>;
}

export function ShelfPage() {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const settings = useSettingsStore(state => state.settings);
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [sort, setSort] = useState<typeof settings.shelfSort>((params.get('sort') as typeof settings.shelfSort) || settings.shelfSort);
  const [search, setSearch] = useState(params.get('q') || '');
  const [queryText, setQueryText] = useState(params.get('q') || '');
  const [selected, setSelected] = useState<string[]>([]);
  const query = useShelf(page, sort, queryText);
  const continueQuery = useQuery({ queryKey: ['continue-reading', runtime.api.baseUrl, runtime.api.currentSession()?.user.id], queryFn: () => runtime.api.continueReading(8), staleTime: 30_000 });
  const pages = query.data ? Math.max(1, Math.ceil(query.data.total / query.data.pageSize)) : 1;
  useEffect(() => { void runtime.updateSettings({ shelfSort: sort }); }, [runtime, sort]);
  const onSort = (value: string) => { const next = value as typeof sort; setSort(next); setParams({ ...(queryText ? { q: queryText } : {}), sort: next, page: '1' }); };
  const onSearch = (event: FormEvent) => { event.preventDefault(); setQueryText(search.trim()); setParams({ ...(search.trim() ? { q: search.trim() } : {}), sort, page: '1' }); };
  const remove = async (book: Book) => { await runtime.api.browseBatchShelf({ bookIds: [book.id] }, 'remove'); await queryClient.invalidateQueries({ queryKey: ['shelf'] }); await queryClient.invalidateQueries({ queryKey: ['continue-reading'] }); };
  const removeSelected = async () => { if (!selected.length) return; await runtime.api.browseBatchShelf({ bookIds: selected }, 'remove'); setSelected([]); await queryClient.invalidateQueries({ queryKey: ['shelf'] }); await queryClient.invalidateQueries({ queryKey: ['continue-reading'] }); };
  const cards = useMemo(() => query.data?.items ?? [], [query.data]);
  return <Stack p="md" maw={1440} mx="auto"><Group justify="space-between" align="center"><Title order={1}>书架</Title><Group><Button component={Link} to="/library" variant="light">浏览书库</Button><Button component={Link} to="/media/video" variant="subtle">影音</Button></Group></Group>{selected.length > 0 && <Group><Badge>已选 {selected.length} 本</Badge><Button size="compact-sm" color="red" onClick={() => void removeSelected()}>批量移出书架</Button><Button size="compact-sm" variant="subtle" onClick={() => setSelected([])}>清除选择</Button></Group>}<Group align="end" wrap="wrap"><form onSubmit={onSearch} style={{ flex: '1 1 20rem' }}><TextInput label="搜索书名、作者" value={search} onChange={event => setSearch(event.currentTarget.value)} placeholder="输入关键词后回车" /></form><SegmentedControl aria-label="书架排序" value={sort} onChange={onSort} data={SHELF_SORTS} /></Group>{continueQuery.data && continueQuery.data.length > 0 && <Stack gap="xs"><Group justify="space-between"><Title order={3}>继续阅读</Title><Badge variant="light">{continueQuery.data.length} 本</Badge></Group><SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 8 }}>{continueQuery.data.map(item => <BookCard key={item.id} book={item} showAuthor={settings.shelfShowAuthor} showProgress={settings.shelfShowProgress} />)}</SimpleGrid></Stack>}{query.isPending && <Center py="xl"><Loader /></Center>}{query.error && <Alert color="red" title="书架加载失败">{query.error.message}</Alert>}{query.data && cards.length === 0 && <Alert>书架为空。可以从书库浏览并加入书架。</Alert>}{cards.length > 0 && <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 6, lg: 8 }}>{cards.map(book => <Stack key={book.id} gap={4}><Group justify="space-between"><Checkbox aria-label={`选择${book.title}`} checked={selected.includes(book.id)} onChange={() => setSelected(s => s.includes(book.id) ? s.filter(x => x !== book.id) : [...s, book.id])} /><Button size="compact-xs" variant="subtle" color="red" onClick={() => void remove(book)}>移出书架</Button></Group><BookCard book={book} showAuthor={settings.shelfShowAuthor} showProgress={settings.shelfShowProgress} /></Stack>)}</SimpleGrid>}{query.data && pages > 1 && <Pagination total={pages} value={page} onChange={value => setParams({ ...(queryText ? { q: queryText } : {}), sort, page: String(value) })} />}</Stack>;
}



