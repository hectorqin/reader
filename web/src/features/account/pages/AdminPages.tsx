import { Navigate } from 'react-router-dom';
import { MediaPageFrame } from '../../media/components/MediaPageFrame.tsx';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { RegistrationManagement, UserManagement } from '../../../ui/system-settings.tsx';
import { BusinessSettings } from '../../../ui/business-settings.tsx';
import type { ReactNode } from 'react';
import { useMediaEnabled } from '../../../shared/stores/features.ts';

/**
 * 我的 › 管理: one page per job (用户管理, 注册与邀请, 服务配置), like 媒体库 and
 * 扫描与刮削 beside them. Lazily loaded (app/router/lazy-pages.tsx). A member who
 * follows an old link lands back on 我的; the server checks the role regardless.
 */
function AdminFrame({ title, children }: { title: string; children: ReactNode }) {
  const role = useAuthStore(state => (state.verifiedUser ?? state.session?.user)?.role);
  if (role !== 'admin') return <Navigate to="/me" replace />;
  return <MediaPageFrame className="media-secondary-page admin-page" title={title} backTo="/me" backLabel="返回我的">{children}</MediaPageFrame>;
}

export function AdminUsersPage() {
  const runtime = useRuntime();
  return <AdminFrame title="用户管理"><UserManagement api={runtime.api} onSaved={()=>void runtime.refreshCapabilities().catch(()=>undefined)} /></AdminFrame>;
}

export function AdminRegistrationPage() {
  const { api } = useRuntime();
  return <AdminFrame title="注册与邀请"><RegistrationManagement api={api} /></AdminFrame>;
}

export function AdminServicesPage() {
  const runtime = useRuntime();
  const media=useMediaEnabled();
  const state=useAuthStore(store=>(store.verifiedUser??store.session?.user)?.mediaState);
  const labels={disabled:'已关闭',stopping:'正在停止',starting:'正在启动',ready:'已就绪',failed:'启动失败，请检查服务日志',closed:'已停止'};
  return <AdminFrame title="服务配置"><div className="user-management"><BusinessSettings api={runtime.api} showMedia={media} modulesStatus={<p role="status">影音服务：{state?labels[state]:'状态待确认'}</p>} onSaved={()=>void runtime.refreshCapabilities().catch(()=>undefined)} /></div></AdminFrame>;
}
