import { describe, expect, it } from 'vitest';
import { ApiError, describeError } from '../src/api/errors.ts';
import { pageTitle } from '../src/app/page-title.ts';

describe('describeError', () => {
  it('keeps a message the server wrote for the interface', () => {
    expect(describeError(new ApiError('forbidden', '影音模块已关闭', 'MEDIA_DISABLED', 403))).toBe('影音模块已关闭');
  });

  it('replaces transport and proxy diagnostics with what kind of failure it was', () => {
    expect(describeError(new ApiError('not_found', 'no route for GET /api/v1/books?scope=library', '', 404))).toBe('没有找到请求的内容，它可能已被移走或删除');
    expect(describeError(new ApiError('server', 'request failed with status 502', '', 502))).toBe('服务器出错了，请稍后重试');
  });

  it('never shows the browser\'s own text for a connectivity failure', () => {
    expect(describeError(new ApiError('offline', 'Failed to fetch'))).toBe('连不上服务器，请检查网络和服务地址后重试');
    expect(describeError(new ApiError('offline', 'request timed out', 'TIMEOUT'))).toBe('请求超时，请检查网络后重试');
  });

  it('keeps the search stream\'s own explanation of an interrupted search', () => {
    const message = '搜索连接中断，已保留收到的结果，可继续搜索。';
    expect(describeError(new ApiError('offline', message, 'STREAM_INTERRUPTED'))).toBe(message);
  });

  it('falls back for errors that are not from the API', () => {
    expect(describeError(new TypeError('x is undefined'))).toBe('出错了，请重试');
    expect(describeError(new Error('文件太大'), '上传失败')).toBe('文件太大');
    expect(describeError('boom', '上传失败')).toBe('上传失败');
  });
});

describe('pageTitle', () => {
  it('names the place', () => {
    expect(pageTitle('/')).toBe('首页 · reader');
    expect(pageTitle('/library/files')).toBe('文件管理 · reader');
    expect(pageTitle('/library/books')).toBe('书库 · reader');
    expect(pageTitle('/media/music/albums')).toBe('音乐 · reader');
    expect(pageTitle('/media/video/player/queue')).toBe('正在播放 · reader');
    expect(pageTitle('/me/admin/users')).toBe('用户管理 · reader');
  });

  it('falls back to the app name for a route it does not know', () => {
    expect(pageTitle('/nowhere')).toBe('reader');
  });
});
