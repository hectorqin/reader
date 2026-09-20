// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { createElement as h, render } from '../src/ui/vendor/preact.ts';
import { ReaderIndicators } from '../src/ui/reader-indicators.tsx';
import type { ChromeState } from '../src/ui/reader-chrome.tsx';
import { SettingsStore } from '../src/store/settings.ts';

const container = document.createElement('div');
const state = {
  title: '测试书名', chapterLabel: '第二章', pageInChapter: 3, chapterPages: 12, progress: 0.47,
} as ChromeState;
const texts = () => Array.from(container.querySelectorAll('span'), el => el.textContent);
afterEach(() => { act(() => render(null, container)); vi.useRealTimers(); });

describe('reading information', () => {
  it('maps all four positions independently and allows hiding each one', () => {
    act(() => render(h(ReaderIndicators, { state: { ...state,
      readoutTopLeft: 'book', readoutTopRight: 'chapter',
      readoutBottomLeft: 'progress', readoutBottomRight: 'none',
    } }), container));
    expect(texts()).toEqual(['测试书名', '第二章', '第3/12页 47%', '']);
    act(() => render(h(ReaderIndicators, { state: { ...state,
      readoutTopLeft: 'none', readoutTopRight: 'none',
      readoutBottomLeft: 'none', readoutBottomRight: 'none',
    } }), container));
    expect(texts()).toEqual(['', '', '', '']);
    expect(container.querySelectorAll('.reading-indicator')).toHaveLength(2);
  });

  it('refreshes time at the minute boundary and on resume, then cleans up', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 20, 9, 5, 59));
    act(() => render(h(ReaderIndicators, { state }), container));
    expect(texts()[3]).toBe('09:05');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(texts()[3]).toBe('09:06');
    vi.setSystemTime(new Date(2026, 8, 20, 10, 15));
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(texts()[3]).toBe('10:15');
    act(() => render(null, container));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('migrates older preferences and persists each position across store instances', async () => {
    let saved = JSON.stringify({ theme: 'sepia', readoutTopRight: 'invalid' });
    const kv = { get: async () => saved, set: async (_key: string, value: string) => { saved = value; }, remove: async () => {} };
    const store = new SettingsStore(kv);
    expect(await store.load()).toMatchObject({ theme: 'sepia', readoutTopLeft: 'chapter', readoutTopRight: 'none', readoutBottomLeft: 'progress', readoutBottomRight: 'time' });
    await store.update({ readoutTopLeft: 'time', readoutTopRight: 'book', readoutBottomLeft: 'none', readoutBottomRight: 'chapter' });
    expect(await new SettingsStore(kv).load()).toMatchObject({ readoutTopLeft: 'time', readoutTopRight: 'book', readoutBottomLeft: 'none', readoutBottomRight: 'chapter' });
  });
});
