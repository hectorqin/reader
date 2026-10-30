import { channelCategories } from '../hooks/use-media-channel.ts';

/** The three media channels. Reading, home and the account page live in the app navigation. */
export const mediaChannels = [
  { id: 'video', label: '影视', icon: 'video' },
  { id: 'music', label: '音乐', icon: 'music' },
  { id: 'audiobook', label: '有声书', icon: 'audiobook' },
] as const;

export const channelPath = (id: string) => `/media/${id}`;

/**
 * Phone channel switch: three always-visible segments instead of a hidden menu.
 * On wider screens the sidebar lists the same channels, so this is hidden there.
 */
export function ChannelSegments({ current }: { current: string }) {
  return <nav className="media-channel-segments" aria-label="切换内容频道">
    {mediaChannels.map(({ id, label }) =>
      <a key={id} href={'#' + channelPath(id)} aria-current={id === current ? 'page' : undefined}>{label}</a>)}
  </nav>;
}

/**
 * Every catalog tab on one line, channel by channel: 影视（首页 电影 剧集）, 音乐（专辑
 * 歌手 曲目）, 有声书（有声书 演播者）. A swipe past a channel's last category is
 * the next channel's first, which is where the channel switch above would go.
 */
const catalogTabs = mediaChannels.flatMap(({ id }) => channelCategories[id].map((category, index) => ({
  channel: id,
  path: category.path ? `/media/${id}/${category.path}` : `/media/${id}`,
  // A channel's bare path is its first category: /media/music redirects to albums.
  alias: index === 0 ? `/media/${id}` : undefined,
})));

/**
 * The catalog tab a swipe from `pathname` lands on, or null at either end and on
 * any page that is not a catalog tab. Library and sort carry over within a channel
 * (they name that channel's libraries); a new channel starts unfiltered.
 *
 * `step: 'channel'` is for a channel with no library at all: its categories are all
 * the same empty page with no tab row to show which one is current, so stepping
 * through them looks like the swipe did nothing. The swipe then moves a whole
 * channel, to its first category — what the channel switch above would do.
 */
export function swipeCatalogTarget(pathname: string, search: string, direction: 'next' | 'previous', step: 'category' | 'channel' = 'category'): string | null {
  const index = catalogTabs.findIndex(tab => tab.path === pathname || tab.alias === pathname);
  const from = catalogTabs[index];
  if (from && step === 'channel') {
    const channel = mediaChannels.findIndex(item => item.id === from.channel);
    const to = mediaChannels[channel + (direction === 'next' ? 1 : -1)];
    return to ? catalogTabs.find(tab => tab.channel === to.id)!.path : null;
  }
  const to = catalogTabs[index + (direction === 'next' ? 1 : -1)];
  if (!from || !to) return null;
  if (from.channel !== to.channel) return to.path;
  const params = new URLSearchParams(search), kept = new URLSearchParams();
  for (const key of ['library', 'sort']) { const value = params.get(key); if (value) kept.set(key, value); }
  const query = kept.toString();
  return query ? `${to.path}?${query}` : to.path;
}
