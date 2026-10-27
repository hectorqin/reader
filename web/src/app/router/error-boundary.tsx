import { isRouteErrorResponse, useRouteError, useNavigate } from 'react-router-dom';
import { Button } from '../../ui/toolkit.tsx';

/**
 * A lazily loaded screen (lazy-pages.tsx) whose chunk is gone: the server was updated
 * while this tab still ran the old client, which asks for the old chunk hashes. The
 * fix is a reload, so the screen says that instead of echoing the browser's message.
 */
const staleChunk = (error: unknown) => error instanceof Error
  && /dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(error.message);

export function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();
  if (staleChunk(error)) return <div className="page-state" role="alert">
    <h2>应用已更新</h2>
    <p>重新加载后即可继续，书架和阅读进度不受影响。</p>
    <Button className="primary" onClick={() => window.location.reload()}>重新加载</Button>
  </div>;
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : '页面加载失败';
  return <div className="page-state" role="alert">
    <h2>页面暂时不可用</h2>
    <p>{message}</p>
    <Button className="primary" onClick={() => navigate('/')}>返回首页</Button>
  </div>;
}
