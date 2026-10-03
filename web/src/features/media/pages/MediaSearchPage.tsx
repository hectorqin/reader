import { Button, Group, Pagination, Select, TextInput } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { searchQuery } from '../queries/media.queries.ts';
import { MediaItemGrid } from '../components/MediaItemGrid.tsx';
import { MediaPageFrame, QueryFeedback } from '../components/MediaPageFrame.tsx';

export function MediaSearchPage() {
  const runtime = useRuntime(), [params, setParams] = useSearchParams();
  const query = useQuery(searchQuery(runtime, params));
  return <MediaPageFrame className="media-secondary-page" title="搜索">
    <form className="media-search" role="search" onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); setParams({ q: String(values.get('q') ?? ''), scope: String(values.get('scope') ?? 'all') }); }}>
      <Group className="media-toolbar" align="end"><TextInput name="q" label="搜索内容" defaultValue={params.get('q') ?? ''} key={params.get('q')} /><Select name="scope" label="范围" defaultValue={params.get('scope') ?? 'all'} data={[{ value: 'all', label: '全部' }, { value: 'video', label: '影视' }, { value: 'music', label: '音乐' }, { value: 'audiobook', label: '有声书' }]} /><Button type="submit" className="media-primary">搜索</Button></Group>
    </form>
    {!!params.get('q') && <QueryFeedback pending={query.isPending} error={query.error} retry={() => { void query.refetch(); }} />}
    {query.data && <><MediaItemGrid items={query.data.items} /><div className="media-toolbar media-pagination"><Pagination total={Math.max(1, Math.ceil(query.data.total / 60))} value={Math.floor(Number(params.get('offset') ?? 0) / 60) + 1} onChange={page => { const next = new URLSearchParams(params); next.set('offset', String((page - 1) * 60)); setParams(next); }} /></div></>}
  </MediaPageFrame>;
}
