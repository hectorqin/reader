import { useParams } from 'react-router-dom';
import type { MediaChannel } from '../api/media-api.ts';
export function useMediaChannel(): MediaChannel {
  const { channel } = useParams();
  return channel === 'music' || channel === 'audiobook' ? channel : 'video';
}
export const channelLabels = { video: '影视', music: '音乐', audiobook: '有声书' };
export const channelCategories = {
  video: [{ path: '', kind: 'video', label: '首页' }, { path: 'movies', kind: 'movie', label: '电影' }, { path: 'series', kind: 'series', label: '剧集' }],
  music: [{ path: 'albums', kind: 'album', label: '专辑' }, { path: 'artists', kind: 'artist', label: '歌手' }, { path: 'tracks', kind: 'track', label: '曲目' }],
  audiobook: [{ path: 'books', kind: 'audiobook', label: '有声书' }, { path: 'narrators', kind: 'narrator', label: '演播者' }],
};
