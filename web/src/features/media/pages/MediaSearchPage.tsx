import { useSearchParams, useNavigate } from 'react-router-dom';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { MediaSearch } from '../components/search.tsx';
import { MediaPageFrame } from '../components/MediaPageFrame.tsx';

export function MediaSearchPage() {
  const runtime = useRuntime(), navigate = useNavigate(), [params, setParams] = useSearchParams();
  return <MediaPageFrame className="media-secondary-page" title="搜索" backLabel="返回搜索来源">
    <MediaSearch
      api={runtime.mediaApi}
      channel="video"
      navigate={(channel, id) => navigate(`/media/${channel}/items/${encodeURIComponent(id)}`)}
      initialLocation={{ q: params.get('q') ?? '', scope: params.get('scope') ?? 'all', offset: params.get('offset') ?? '0' }}
      onLocationChange={next => setParams(next)}
    />
  </MediaPageFrame>;
}
