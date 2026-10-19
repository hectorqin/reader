import { Clapperboard, Music2, Headphones } from 'lucide-react';

/** The three media channels. Reading, home and the account page live in the app navigation. */
export const mediaChannels = [
  { id: 'video', label: '影视', icon: Clapperboard },
  { id: 'music', label: '音乐', icon: Music2 },
  { id: 'audiobook', label: '有声书', icon: Headphones },
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
