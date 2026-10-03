import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { favoritesQuery } from '../queries/media.queries.ts';
import { MediaFavorites, favoriteChannel, favoriteScope } from '../components/favorites.tsx';
import { MediaPageFrame, QueryFeedback } from '../components/MediaPageFrame.tsx';

export function MediaFavoritesPage() {
  const runtime = useRuntime(), navigate = useNavigate(), [params, setParams] = useSearchParams(), query = useQuery(favoritesQuery(runtime, params));
  const scope = favoriteScope(params.get('scope') ?? undefined);
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const patch = (values: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key);
    setParams(next);
  };
  return <MediaPageFrame className="media-secondary-page" title="我的收藏">
    <section className="media-favorites">
    <QueryFeedback pending={query.isPending} error={query.error} retry={() => { void query.refetch(); }} />
    {query.data && <MediaFavorites api={runtime.mediaApi} items={query.data.items} total={query.data.total} offset={offset} scope={scope} busy={query.isFetching} onScope={value => patch({ scope: value, offset: '' })} onPage={value => patch({ offset: String(value) })} onOpen={item => navigate(`/media/${favoriteChannel(item)}/items/${encodeURIComponent(item.id)}`)} />}
    </section>
  </MediaPageFrame>;
}
