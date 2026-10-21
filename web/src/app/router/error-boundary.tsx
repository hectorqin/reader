import { isRouteErrorResponse, useRouteError, useNavigate } from 'react-router-dom';
import { Button } from '../../ui/toolkit.tsx';

export function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : '页面加载失败';
  return <div className="page-state" role="alert">
    <h2>页面暂时不可用</h2>
    <p>{message}</p>
    <Button className="primary" onClick={() => navigate('/')}>返回首页</Button>
  </div>;
}
