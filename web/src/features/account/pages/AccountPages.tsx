import { Navigate, useLocation } from 'react-router-dom';
import { MediaPageFrame } from '../../media/components/MediaPageFrame.tsx';
import { MediaAccountPanel } from '../../media/components/settings.tsx';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { OpdsAccess } from '../../../ui/opds-access.tsx';

/** 账号与连接 (/me/account): who is signed in, and to which server. */
export function AccountPage() {
  const account = useRuntime().mediaApi.accountInfo();
  if (!account) return <Navigate to="/me" replace />;
  return <MediaPageFrame className="media-secondary-page" title="账号与连接" backTo="/me" backLabel="返回我的">
    <MediaAccountPanel account={account} />
  </MediaPageFrame>;
}

/**
 * 外部阅读器 (/me/opds). Reached from 我的, from 偏好设置 › 书架 and from the shelf's
 * settings sheet; back returns to whichever of them opened it (`state.returnTo`).
 */
export function OpdsPage() {
  const runtime = useRuntime();
  const returnTo = useLocation().state?.returnTo;
  const back = typeof returnTo === 'string' && returnTo.startsWith('/') ? returnTo : '/me';
  return <MediaPageFrame className="media-secondary-page opds-page" title="连接外部阅读器" backTo={back} backLabel={back === '/me' ? '返回我的' : '返回上一页'}>
    <OpdsAccess api={runtime.api} onSignedOut={() => { void runtime.api.signOut(); }} />
  </MediaPageFrame>;
}
