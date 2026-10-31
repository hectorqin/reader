import { Icon } from '../../../ui/icon.tsx';
import { useNavigate } from 'react-router-dom';
import { ActionMenu } from '../../../ui/action-menu.tsx';
import type { MediaChannel } from '../api/media-api.ts';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';

/**
 * The ⋯ menu on a channel's landing page: 收藏, 历史 and 队列 on every channel, and
 * 媒体库管理 for an administrator only. Until the role is known it counts as a member's
 * (docs/ui.md §3.4.4), so the entry never leads a member to 需要管理员权限.
 */
export function ChannelMenu({ channel }: { channel: MediaChannel }) {
  const navigate = useNavigate();
  const admin = useAuthStore(state => state.verifiedUser?.role === 'admin');
  return <ActionMenu className="media-icon-button" label="更多操作" items={[
    { label: '收藏', icon: <Icon name="star" size={16} />, onSelect: () => navigate('/media/favorites') },
    { label: '历史', icon: <Icon name="history" size={16} />, onSelect: () => navigate(`/media/${channel}/history`) },
    { label: '队列', icon: <Icon name="episodes" size={16} />, onSelect: () => navigate(`/media/${channel}/queue`) },
    ...(admin ? [{ label: '媒体库管理', icon: <Icon name="library" size={16} />, onSelect: () => navigate(`/media/${channel}/settings/libraries`) }] : []),
  ]} />;
}
