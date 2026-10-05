import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { favoritesQuery } from '../queries/media.queries.ts';
import { MediaFavorites, favoriteChannel, favoriteScope } from '../components/favorites.tsx';
import { MediaPageFrame, QueryFeedback } from '../components/MediaPageFrame.tsx';

export function MediaFavoritesPage() {
  const runtime = useRuntime(), navigate = useNavigate(), location = useLocation(), { channel: routeChannel } = useParams(), [params, setParams] = useSearchParams();
  const scopedChannel = routeChannel === 'video' || routeChannel === 'music' || routeChannel === 'audiobook' ? routeChannel : undefined;
  const queryParams = new URLSearchParams(params);
  if (scopedChannel && !queryParams.has('scope')) queryParams.set('scope', scopedChannel);
  const query = useQuery(favoritesQuery(runtime, queryParams));
  const scope = favoriteScope(queryParams.get('scope') ?? undefined);
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const patch = (values: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key);
    setParams(next);
  };
  return <MediaPageFrame className="media-secondary-page" title="我的收藏" backLabel="返回影视">
    <QueryFeedback pending={query.isPending} error={query.error} retry={() => { void query.refetch(); }} />
    {query.data && <MediaFavorites api={runtime.mediaApi} items={query.data.items} total={query.data.total} offset={offset} scope={scope} busy={query.isFetching} onScope={value => patch({ scope: value, offset: '' })} onPage={value => patch({ offset: String(value) })} onOpen={item => navigate(`/media/${favoriteChannel(item)}/items/${encodeURIComponent(item.id)}`, { state: { returnTo: location.pathname + location.search } })} />}
  </MediaPageFrame>;
}
