import { Pagination, Select } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { favoritesQuery } from '../queries/media.queries.ts';
import { MediaItemGrid } from '../components/MediaItemGrid.tsx';
import { MediaPageFrame, QueryFeedback } from '../components/MediaPageFrame.tsx';

export function MediaFavoritesPage() {
  const runtime = useRuntime(), [params, setParams] = useSearchParams(), query = useQuery(favoritesQuery(runtime, params));
  return <MediaPageFrame className="media-secondary-page" title="我的收藏">
    <section className="media-favorites">
    <div className="media-favorite-tools"><p>按类型筛选收藏</p><Select aria-label="收藏类型" value={params.get('scope') ?? 'all'} data={[{ value: 'all', label: '全部' }, { value: 'video', label: '影视' }, { value: 'music', label: '音乐' }, { value: 'audiobook', label: '有声书' }]} onChange={value => setParams({ scope: value ?? 'all' })} /></div>
    <QueryFeedback pending={query.isPending} error={query.error} retry={() => { void query.refetch(); }} />
    {query.data && <><MediaItemGrid items={query.data.items} /><div className="media-toolbar media-pagination"><Pagination total={Math.max(1, Math.ceil(query.data.total / 60))} value={Math.floor(Number(params.get('offset') ?? 0) / 60) + 1} onChange={page => { const next = new URLSearchParams(params); next.set('offset', String((page - 1) * 60)); setParams(next); }} /></div></>}
    </section>
  </MediaPageFrame>;
}
