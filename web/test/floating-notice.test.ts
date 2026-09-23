// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createElement, render } from '../src/ui/vendor/preact.ts';
import { FloatingNotice } from '../src/ui/floating-notice.tsx';

const root = document.createElement('div');
afterEach(() => { render(null, root); vi.useRealTimers(); });
const show = (message: string, busy = false) => render(createElement(FloatingNotice, { message, busy }), root);

it('keeps ongoing operations visible, then expires completed feedback', async () => {
  vi.useFakeTimers(); show('正在安装', true);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(root.textContent).toContain('正在安装');
  expect(root.querySelector('button')).toBeNull();
  show('安装完成');
  await vi.advanceTimersByTimeAsync(6000);
  expect(root.querySelector('[role=status]')).toBeNull();
});

it('allows dismissal and shows the next operation without retaining an old timer', async () => {
  vi.useFakeTimers(); show('第一条');
  root.querySelector('button')!.click();
  await vi.advanceTimersByTimeAsync(1);
  expect(root.querySelector('[role=status]')).toBeNull();
  show('第二条'); await vi.advanceTimersByTimeAsync(1);
  expect(root.textContent).toContain('第二条');
  await vi.advanceTimersByTimeAsync(4000);
  show('第三条'); await vi.advanceTimersByTimeAsync(3000);
  expect(root.textContent).toContain('第三条');
  render(null, root);
  expect(vi.getTimerCount()).toBe(0);
});
