import { Alert, Loader, Select } from '@mantine/core';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { librariesQuery } from '../queries/media.queries.ts';
import { MediaPageFrame, QueryFeedback } from '../components/MediaPageFrame.tsx';
import { Narrators, type NarratorLocation } from '../components/narrators.tsx';
import type { MediaChannel, Part } from '../api/media-api.ts';

/**
 * Dedicated narrator workspace. Narrators are backed by the specialised
 * narrator endpoints and therefore cannot be represented by the generic
 * catalog query used by the other audiobook categories.
 */
export function MediaNarratorsPage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const currentLocation = useLocation();
  const { channel: routeChannel, narrator: routeNarrator, workId: routeWorkId } = useParams();
  const channel: MediaChannel = routeChannel === 'audiobook' ? 'audiobook' : 'audiobook';
  const [params] = useSearchParams();
  const libraries = useQuery(librariesQuery(runtime));
  const available = (libraries.data?.items ?? []).filter(item => item.kind === channel);
  const requested = params.get('library') ?? '';
  const libraryId = available.some(item => item.id === requested) ? requested : (available[0]?.id ?? '');
  const role = useAuthStore(state => state.verifiedUser?.role);
  const routeName = routeNarrator ? decodeURIComponent(routeNarrator) : (params.get('narrator') || null);
  const routeWork = routeWorkId ? decodeURIComponent(routeWorkId) : (params.get('work') ?? '');
  const initialLocation: NarratorLocation = {
    libraryId,
    name: routeName,
    search: params.get('search') ?? '',
    offset: Math.max(0, Number(params.get('offset')) || 0),
    workId: routeWork,
    editionId: params.get('edition') ?? '',
  };
  const updateLocation = (location: NarratorLocation) => {
    const next = new URLSearchParams(params);
    const values: Record<string, string> = {
      library: location.libraryId,
      narrator: '',
      search: location.search,
      offset: location.offset ? String(location.offset) : '',
      work: '',
      edition: location.editionId,
    };
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const path = location.name
      ? `/media/audiobook/narrators/${encodeURIComponent(location.name)}${location.workId ? `/works/${encodeURIComponent(location.workId)}` : ''}`
      : '/media/audiobook/narrators';
    const search = next.toString();
    const target = `${path}${search ? `?${search}` : ''}`;
    if (`${currentLocation.pathname}${currentLocation.search}` !== target) navigate(target, { replace: true });
  };
  const play = async (parts: Part[], index: number, title: string) => {
    await runtime.player.play(parts.map(part => ({ part, title: `${title} · ${part.title}`, video: false })), index);
  };

  return <MediaPageFrame title="演播者">
    <QueryFeedback pending={libraries.isPending} error={libraries.error} retry={() => { void libraries.refetch(); }} />
    {libraries.isPending && <Loader />}
    {!libraries.isPending && !libraries.error && !libraryId && <Alert>当前没有可浏览的有声书媒体库。</Alert>}
    {!libraries.isPending && !libraries.error && libraryId && <Narrators
      key={`${routeName ?? ''}:${routeWork}`}
      api={runtime.mediaApi}
      libraryId={libraryId}
      showLibraryName={!requested}
      initialLocation={initialLocation}
      onLocationChange={updateLocation}
      libraryControl={<Select aria-label="媒体库" value={libraryId} data={available.map(item => ({ value: item.id, label: item.name }))} onChange={value => {
        const next = new URLSearchParams(params);
        if (value) next.set('library', value); else next.delete('library');
        for (const key of ['narrator', 'work', 'edition', 'offset']) next.delete(key);
        navigate(`/media/audiobook/narrators${next.toString() ? `?${next.toString()}` : ''}`, { replace: true });
      }} />}
      onPlay={play}
      onQueue={async ids => { await runtime.mediaApi.request('queue', 'POST', { partIds: ids }); }}
      onDetail={id => navigate(`/media/audiobook/items/${encodeURIComponent(id)}`)}
    />}
    {role === 'admin' && !libraries.isPending && !libraries.error && available.length === 0 && <Alert color="yellow">管理员可以先在影音设置中创建有声书媒体库。</Alert>}
  </MediaPageFrame>;
}
