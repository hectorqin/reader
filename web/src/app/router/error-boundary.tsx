import { Button, Center, Stack, Text, Title } from '@mantine/core';
import { isRouteErrorResponse, useRouteError, useNavigate } from 'react-router-dom';

export function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : '页面加载失败';
  return <Center mih="60vh"><Stack align="center"><Title order={2}>页面暂时不可用</Title><Text c="dimmed">{message}</Text><Button onClick={() => navigate('/media/video')}>返回影音</Button></Stack></Center>;
}
