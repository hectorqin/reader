import { Icon } from '../../../ui/icon.tsx';
import { useNavigate } from 'react-router-dom';
import { ActionMenu } from '../../../ui/action-menu.tsx';
import type { MediaChannel } from '../api/media-api.ts';

/** The ⋯ menu on a channel's landing page: the same four destinations on every channel. */
export function ChannelMenu({ channel }: { channel: MediaChannel }) {
  const navigate = useNavigate();
  return <ActionMenu className="media-icon-button" label="更多操作" items={[
    { label: '收藏', icon: <Icon name="star" size={16} />, onSelect: () => navigate('/media/favorites') },
    { label: '历史', icon: <Icon name="history" size={16} />, onSelect: () => navigate(`/media/${channel}/history`) },
    { label: '队列', icon: <Icon name="episodes" size={16} />, onSelect: () => navigate(`/media/${channel}/queue`) },
    { label: '媒体库管理', icon: <Icon name="library" size={16} />, onSelect: () => navigate(`/media/${channel}/settings/libraries`) },
  ]} />;
}
