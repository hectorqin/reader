import { Link } from 'react-router-dom';
import { MediaCover } from './cover.tsx';
import type { Item, MediaChannel } from '../api/media-api.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { favoriteChannel } from './favorites.tsx';
import { itemLabel } from './item-label.ts';

export function MediaItemGrid({ items, channel }: { items: Item[]; channel?: MediaChannel }) {
  const { mediaApi } = useRuntime();
  if (!items.length) return <p className="media-empty muted">暂无内容</p>;
  return <div className="media-grid">
    {items.map(item => {
      const subtitle = itemLabel(item);
      return <Link className="media-tile" key={item.id} to={`/media/${channel ?? favoriteChannel(item)}/items/${encodeURIComponent(item.id)}`}>
        <MediaCover api={mediaApi} item={item} square={['album', 'artist', 'track'].includes(item.kind)} />
        <strong title={item.title}>{item.title}</strong>
        {subtitle && <small title={subtitle}>{subtitle}</small>}
      </Link>;
    })}
  </div>;
}
