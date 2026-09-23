// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement, render } from '../src/ui/vendor/preact.ts';
import { FloatingNotice } from '../src/ui/floating-notice.tsx';
import { dismissAllNotices, dismissNotice, notify, placeNotifications } from '../src/ui/notifications.ts';
import { noticeText, visibleNotices } from './helpers/notices.ts';

const root = document.createElement('div');
beforeEach(() => { document.body.replaceChildren(root); });
afterEach(() => { render(null, root); dismissAllNotices(); vi.useRealTimers(); });
const show = (message: string, busy = false) => render(createElement(FloatingNotice, { message, busy }), root);

it('keeps ongoing operations visible, then expires completed feedback', async () => {
  vi.useFakeTimers(); show('正在安装', true);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(noticeText()).toContain('正在安装');
  expect(root.textContent).toBe('');
  expect(visibleNotices()[0]?.querySelector('button')).toBeNull();
  show('安装完成');
  await vi.advanceTimersByTimeAsync(6000);
  expect(visibleNotices()).toHaveLength(0);
});

it('allows dismissal and shows the next operation without retaining an old timer', async () => {
  vi.useFakeTimers(); show('第一条');
  document.querySelector<HTMLButtonElement>('.notyf button')!.click();
  await vi.advanceTimersByTimeAsync(1);
  expect(visibleNotices()).toHaveLength(0);
  show('第二条'); await vi.advanceTimersByTimeAsync(1);
  expect(noticeText()).toContain('第二条');
  await vi.advanceTimersByTimeAsync(4000);
  show('第三条'); await vi.advanceTimersByTimeAsync(3000);
  expect(noticeText()).toContain('第三条');
  render(null, root);
  expect(visibleNotices()).toHaveLength(0);
});

it('updates progress in place, limits the stack and treats remote markup as text', () => {
  const id = notify('上传 1%', { kind: 'loading' });
  const card = visibleNotices()[0];
  for (let progress = 2; progress < 100; progress++) notify(`上传 ${progress}%`, { kind: 'loading' }, id);
  expect(visibleNotices()).toEqual([card]);
  expect(noticeText()).toBe('上传 99%');
  notify('<img src=x onerror=alert(1)> & <script>bad()</script>', { kind: 'error' }, id);
  expect(document.querySelector('.notyf img, .notyf script')).toBeNull();
  expect(noticeText()).toContain('<img src=x onerror=alert(1)>');
  expect(document.querySelector('.notyf [role=alert]')).not.toBeNull();
  expect(document.querySelector('.notyf button')?.getAttribute('aria-label')).toBe('关闭提示');
  for (let count = 0; count < 10; count++) notify('消息 ' + count);
  expect(visibleNotices()).toHaveLength(3);
  expect(document.querySelectorAll('.notyf')).toHaveLength(1);
});

it('keeps app notifications across screen disposal and moves the host into native dialogs', () => {
  const appNotice = notify('已返回书架');
  show('正在加载', true);
  render(null, root);
  expect(noticeText()).toBe('已返回书架');
  const dialog = document.createElement('dialog'); document.body.append(dialog);
  dialog.open = true; placeNotifications();
  expect(dialog.querySelector('.notyf')).not.toBeNull();
  expect(noticeText()).toBe('已返回书架');
  dialog.open = false; placeNotifications(); dialog.remove();
  expect(document.body.querySelector(':scope > .notyf')).not.toBeNull();
  dismissNotice(appNotice);
  expect(visibleNotices()).toHaveLength(0);
});
