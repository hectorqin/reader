import { Alert, Badge, Button, Card, Center, Group, Loader, Pagination, SimpleGrid, Stack, Table, Text, TextInput, Title, Breadcrumbs, Anchor, Checkbox, Menu, ActionIcon, Divider } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useState, type FormEvent } from 'react';
import type { Book, BrowseEntry } from '../../../api/types.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';

function Cover({ book }: { book: Book }) {
  const runtime = useRuntime();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let live = true; if (!book.coverUrl) { setSrc(null); return; } void runtime.api.coverBytes(book.coverUrl).then(bytes => { if (live) setSrc(URL.createObjectURL(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'image/jpeg' }))); }).catch(() => { if (live) setSrc(null); }); return () => { live = false; }; }, [runtime.api, book.coverUrl]);
  return <div style={{ aspectRatio: '2 / 3', overflow: 'hidden', borderRadius: 6, background: 'var(--mantine-color-gray-1)' }}>{src ? <img src={src} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Center h="100%"><Text c="dimmed" ta="center" lineClamp={3}>{book.title || '无封面'}</Text></Center>}</div>;
}

export function LibraryPage() {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [search, setSearch] = useState(params.get('q') || '');
  const [queryText, setQueryText] = useState(params.get('q') || '');
  const [busy, setBusy] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['library-books', runtime.api.baseUrl, runtime.api.currentSession()?.user.id, page, queryText], queryFn: ({ signal }) => runtime.api.listBooks({ scope: 'library', page, pageSize: 48, search: queryText || '', sort: 'title', order: 'asc' }, { signal }) });
  const facets = useQuery({ queryKey: ['library-facets', runtime.api.baseUrl], queryFn: ({ signal }) => runtime.api.facets({ signal }), staleTime: 5 * 60_000 });
  const pages = query.data ? Math.max(1, Math.ceil(query.data.total / query.data.pageSize)) : 1;
  const searchSubmit = (event: FormEvent) => { event.preventDefault(); setQueryText(search.trim()); setParams({ ...(search.trim() ? { q: search.trim() } : {}), page: '1' }); };
  const toggleShelf = async (book: Book) => { setBusy(book.id); try { await runtime.api.browseBatchShelf({ bookIds: [book.id] }, book.shelfState === 'on' ? 'remove' : 'add'); await queryClient.invalidateQueries({ queryKey: ['library-books'] }); await queryClient.invalidateQueries({ queryKey: ['shelf'] }); } finally { setBusy(null); } };
  return <Stack p="md" maw={1440} mx="auto"><Group justify="space-between"><Title order={1}>书库</Title><Button component={Link} to="/shelf" variant="light">我的书架</Button></Group><Group align="end"><form onSubmit={searchSubmit} style={{ flex: '1 1 24rem' }}><TextInput label="搜索书库" value={search} onChange={event => setSearch(event.currentTarget.value)} placeholder="书名、作者、系列" /></form>{facets.data && <Text size="sm" c="dimmed">{facets.data.authors.length} 位作者 · {facets.data.series.length} 个系列 · {facets.data.formats.length} 种格式</Text>}</Group>{query.isPending && <Center py="xl"><Loader /></Center>}{query.error && <Alert color="red" title="书库加载失败">{query.error.message}</Alert>}{query.data && query.data.items.length === 0 && <Alert>没有匹配的书籍。</Alert>}{query.data && <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 6, lg: 8 }}>{query.data.items.map(book => <Card key={book.id} withBorder padding="sm"><Stack gap="xs"><Link to={`/book/${encodeURIComponent(book.id)}`} style={{ textDecoration: 'none' }}><Cover book={book} /><Text fw={600} mt="xs" lineClamp={2}>{book.title || '未命名'}</Text><Text size="sm" c="dimmed" lineClamp={1}>{book.author || '未知作者'}</Text></Link><Button size="compact-sm" variant={book.shelfState === 'on' ? 'light' : 'filled'} loading={busy === book.id} onClick={() => void toggleShelf(book)}>{book.shelfState === 'on' ? '已在书架 · 移除' : '加入书架'}</Button></Stack></Card>)}</SimpleGrid>}{query.data && pages > 1 && <Pagination total={pages} value={page} onChange={value => setParams({ ...(queryText ? { q: queryText } : {}), page: String(value) })} />}</Stack>;
}

/** Folder-aware browsing page. The folder is URL state so links and back/forward remain shareable. */
export function LibraryBrowsePage() {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const path = params.get('path') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const search = params.get('q') ?? '';
  const [draft, setDraft] = useState(search);
  const listing = useQuery({ queryKey: ['library-browse', runtime.api.baseUrl, path, page], queryFn: ({ signal }) => runtime.api.browse(path, page, { signal }) });
  const books = useQuery({ queryKey: ['library-books', runtime.api.baseUrl, 'browse', path, page, search], queryFn: ({ signal }) => runtime.api.listBooks({ scope: 'library', path, page, pageSize: 60, search, sort: 'title', order: 'asc' }, { signal }) });
  const navigate = (nextPath: string, nextPage = 1, nextSearch = '') => setParams({ ...(nextPath ? { path: nextPath } : {}), ...(nextSearch ? { q: nextSearch } : {}), ...(nextPage > 1 ? { page: String(nextPage) } : {}) });
  const toggle = async (book: Book) => { await runtime.api.browseBatchShelf({ bookIds: [book.id] }, book.shelfState === 'on' ? 'remove' : 'add'); await queryClient.invalidateQueries({ queryKey: ['library-books'] }); await queryClient.invalidateQueries({ queryKey: ['shelf'] }); };
  const totalPages = books.data ? Math.max(1, Math.ceil(books.data.total / books.data.pageSize)) : 1;
  return <Stack p="md" maw={1440} mx="auto">
    <Group justify="space-between"><Title order={1}>书库</Title><Group><Button component={Link} to="/shelf" variant="light">我的书架</Button><Button component={Link} to="/library/files" variant="subtle">文件管理</Button></Group></Group>
    <Breadcrumbs>{(listing.data?.crumbs ?? [{ name: '书库', path: '' }]).map((crumb, i) => <Anchor key={`${crumb.path}-${i}`} component="button" onClick={() => navigate(crumb.path)}>{crumb.name}</Anchor>)}</Breadcrumbs>
    <Group align="end"><form style={{ flex: '1 1 24rem' }} onSubmit={e => { e.preventDefault(); navigate(path, 1, draft.trim()); }}><TextInput label="搜索当前文件夹" value={draft} onChange={e => setDraft(e.currentTarget.value)} /></form><Text size="sm" c="dimmed">{listing.data ? `${listing.data.dirs} 个文件夹 · ${listing.data.files} 个文件` : ''}</Text></Group>
    {listing.data?.entries.filter(e => e.type === 'dir').length ? <Card withBorder><Group>{listing.data.entries.filter(e => e.type === 'dir').map(entry => <Button key={entry.path} variant="light" onClick={() => navigate(entry.path)}>{entry.name}</Button>)}</Group></Card> : null}
    {books.isPending && <Center py="xl"><Loader /></Center>}{books.error && <Alert color="red">{books.error.message}</Alert>}
    {books.data && <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 6, lg: 8 }}>{books.data.items.map(book => <Card key={book.id} withBorder padding="sm"><Stack gap="xs"><Link to={`/book/${encodeURIComponent(book.id)}`} style={{ textDecoration: 'none' }}><Cover book={book} /><Text fw={600} lineClamp={2}>{book.title || '未命名'}</Text><Text size="sm" c="dimmed" lineClamp={1}>{book.author || '未知作者'}</Text></Link><Button size="compact-sm" onClick={() => void toggle(book)}>{book.shelfState === 'on' ? '移出书架' : '加入书架'}</Button></Stack></Card>)}</SimpleGrid>}
    {totalPages > 1 && <Pagination total={totalPages} value={page} onChange={p => navigate(path, p, search)} />}
  </Stack>;
}

/** Administrator-only file manager. All mutations are explicit and scoped to selected paths. */
export function LibraryFilesPage() {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const path = params.get('path') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [selected, setSelected] = useState<string[]>([]);
  const role = useAuthStore(state => state.verifiedUser?.role);
  if (role !== 'admin') return <Stack p="md"><Alert color="red" title="无权访问">文件管理需要管理员权限。</Alert><Button component={Link} to="/library">返回书库</Button></Stack>;
  const query = useQuery({ queryKey: ['library-files', runtime.api.baseUrl, path, page], queryFn: ({ signal }) => runtime.api.browse(path, page, { signal }) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['library-files'] });
  const go = (next: string, p = 1) => setParams({ ...(next ? { path: next } : {}), ...(p > 1 ? { page: String(p) } : {}) });
  const mutate = async (action: () => Promise<unknown>) => { await action(); setSelected([]); await refresh(); };
  const rename = async (entry: BrowseEntry) => { const name = window.prompt('重命名', entry.name)?.trim(); if (name && name !== entry.name) await mutate(() => runtime.api.browseRename(entry.path, name)); };
  const move = async () => { const target = window.prompt('移动到（书库相对路径）', path); if (target !== null && selected.length) await mutate(() => runtime.api.browseMove(selected, target.trim())); };
  const remove = async () => { if (selected.length && window.confirm(`删除 ${selected.length} 项？`)) await mutate(() => runtime.api.browseDelete(selected)); };
  const mkdir = async () => { const name = window.prompt('新建文件夹'); if (name?.trim()) await mutate(() => runtime.api.browseMkdir(path, name.trim())); };
  const upload = async (files: File[]) => { if (!files.length) return; await mutate(() => runtime.api.upload(files, path, 'rename')); };
  const pages = query.data ? Math.max(1, Math.ceil(query.data.total / 200)) : 1;
  return <Stack p="md" maw={1200} mx="auto"><Group justify="space-between"><Title order={1}>文件管理</Title><Group><Button component={Link} to="/library" variant="light">返回书库</Button><Button onClick={mkdir} disabled={!query.data?.writable}>新建文件夹</Button><Button component="label" disabled={!query.data?.writable}>上传<input hidden type="file" multiple onChange={e => void upload(Array.from(e.currentTarget.files ?? []))} /></Button></Group></Group>
    <Breadcrumbs>{(query.data?.crumbs ?? [{ name: '书库', path: '' }]).map((crumb, i) => <Anchor key={`${crumb.path}-${i}`} component="button" onClick={() => go(crumb.path)}>{crumb.name}</Anchor>)}</Breadcrumbs>
    {selected.length > 0 && <Group><Badge>已选 {selected.length} 项</Badge><Button size="compact-sm" onClick={() => void move()}>移动</Button><Button size="compact-sm" color="red" onClick={() => void remove()}>删除</Button><Button size="compact-sm" variant="subtle" onClick={() => setSelected([])}>清除</Button></Group>}
    <Divider />
    {query.isPending && <Center py="xl"><Loader /></Center>}{query.error && <Alert color="red">{query.error.message}</Alert>}
    {query.data && <Table striped highlightOnHover><Table.Thead><Table.Tr><Table.Th><Checkbox aria-label="全选" checked={selected.length > 0 && selected.length === query.data.entries.length} onChange={e => setSelected(e.currentTarget.checked ? query.data!.entries.map(x => x.path) : [])} /></Table.Th><Table.Th>名称</Table.Th><Table.Th>类型</Table.Th><Table.Th>大小</Table.Th><Table.Th /></Table.Tr></Table.Thead><Table.Tbody>{query.data.entries.map(entry => <Table.Tr key={entry.path}><Table.Td><Checkbox checked={selected.includes(entry.path)} onChange={() => setSelected(s => s.includes(entry.path) ? s.filter(x => x !== entry.path) : [...s, entry.path])} /></Table.Td><Table.Td>{entry.type === 'dir' ? <Anchor component="button" onClick={() => go(entry.path)}>{entry.name}</Anchor> : entry.name}</Table.Td><Table.Td>{entry.type === 'dir' ? '文件夹' : entry.ext || '文件'}</Table.Td><Table.Td>{entry.size ? `${Math.round(entry.size / 1024)} KB` : '-'}</Table.Td><Table.Td><Menu><Menu.Target><ActionIcon variant="subtle">⋯</ActionIcon></Menu.Target><Menu.Dropdown><Menu.Item onClick={() => void rename(entry)}>重命名</Menu.Item><Menu.Item onClick={() => setSelected([entry.path])}>选择</Menu.Item></Menu.Dropdown></Menu></Table.Td></Table.Tr>)}</Table.Tbody></Table>}
    {pages > 1 && <Pagination total={pages} value={page} onChange={p => go(path, p)} />}
  </Stack>;
}

