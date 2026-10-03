import { Card, SimpleGrid, Text, UnstyledButton } from '@mantine/core';
import { Link } from 'react-router-dom';
import { MediaCover } from '../components/cover.tsx';
import type { Item, MediaChannel } from '../api/media-api.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { favoriteChannel } from '../components/favorites.tsx';

export function MediaItemGrid({ items, channel }: { items: Item[]; channel?: MediaChannel }) {
  const { mediaApi } = useRuntime();
  if (!items.length) return <Text c="dimmed">暂无内容。</Text>;
  return <SimpleGrid cols={{ base: 2, sm: 3, md: 5, lg: 6 }}>
    {items.map(item => <Card key={item.id} withBorder padding="sm"><UnstyledButton component={Link} to={`/media/${channel ?? favoriteChannel(item)}/items/${encodeURIComponent(item.id)}`}>
      <MediaCover api={mediaApi} item={item} square={['album', 'artist', 'track'].includes(item.kind)} />
      <Text fw={600} mt="sm" lineClamp={2}>{item.title}</Text>
    </UnstyledButton></Card>)}
  </SimpleGrid>;
}
