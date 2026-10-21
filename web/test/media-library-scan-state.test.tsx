import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { MediaLibraryList, scanTime } from '../src/features/media/components/library-list.tsx';
import { MediaScanSettings } from '../src/features/media/components/scan-settings.tsx';
import type { Library, MediaApi, ScanJob } from '../src/features/media/api/media-api.ts';

/** Prototype 20: each card says what its latest scan is doing, and 扫描与元数据 saves switches. */
const root = document.createElement('div'); document.body.append(root);
afterEach(() => act(() => render(null, root)));
const libraries: Library[] = [{ id: 'films', name: '电影', kind: 'video', access: 'all' }, { id: 'music', name: '音乐', kind: 'music', access: 'all' }, { id: 'books', name: '有声书', kind: 'audiobook', access: 'all' }];
const today = new Date(); today.setHours(9, 12, 0, 0);
const jobs: ScanJob[] = [
  { id: 'j1', libraryId: 'films', state: 'complete', inspected: 128, total: 128, error: null, finishedAt: today.getTime() },
  { id: 'j2', libraryId: 'music', state: 'running', inspected: 1432, total: 2310, error: null, finishedAt: null },
  { id: 'j3', libraryId: 'books', state: 'failed', inspected: 0, total: null, error: 'directory-unavailable', finishedAt: today.getTime() },
];
const button = (label: string) => [...root.querySelectorAll('button')].find(node => node.textContent === label);

it('shows the last scan, a running scan with its share and 取消, and a failure with 重试 and 查看详情', async () => {
  const request = vi.fn().mockResolvedValue({ items: [] }), scan = vi.fn(), cancel = vi.fn(), details = vi.fn();
  await act(async () => render(<MediaLibraryList api={{ request } as unknown as MediaApi} libraries={libraries} busy={false} position={{ query: '', page: 0 }} onPosition={() => {}} onEdit={() => {}} onScan={scan} onPermissions={() => {}} jobs={jobs} onCancel={cancel} onDetails={details} />, root));
  const rows = [...root.querySelectorAll('.media-library-row')];
  expect(rows[0]!.textContent).toContain('上次扫描 今天 09:12');
  expect(rows[1]!.textContent).toContain('正在扫描 · 已处理 62%');
  expect(rows[1]!.querySelector('progress')?.getAttribute('value')).toBe('62');
  expect(rows[2]!.querySelector('[role=alert]')?.textContent).toContain('媒体目录不可访问');
  await act(async () => button('取消')!.click()); expect(cancel).toHaveBeenCalledWith(jobs[1]);
  await act(async () => button('重试')!.click()); expect(scan).toHaveBeenCalledWith('books');
  await act(async () => button('查看详情')!.click()); expect(details).toHaveBeenCalledWith(libraries[2]);
  await act(async () => button('重新扫描')!.click()); expect(scan).toHaveBeenCalledWith('films');
  // Without a total (older server), the count of files checked is shown instead.
  await act(async () => render(<MediaLibraryList api={{ request } as unknown as MediaApi} libraries={libraries.slice(1, 2)} busy={false} position={{ query: '', page: 0 }} onPosition={() => {}} onEdit={() => {}} onScan={scan} onPermissions={() => {}} jobs={[{ ...jobs[1]!, total: null }]} />, root));
  expect(root.textContent).toContain('正在扫描 · 已检查 1432 个文件');
  expect(button('取消')).toBeUndefined();
});

it('words the scan time relative to today', () => {
  const now = new Date(2026, 9, 20, 15, 0).getTime();
  expect(scanTime(new Date(2026, 9, 20, 9, 12).getTime(), now)).toBe('今天 09:12');
  expect(scanTime(new Date(2026, 9, 19, 21, 40).getTime(), now)).toBe('昨天 21:40');
  expect(scanTime(new Date(2026, 2, 8, 9, 5).getTime(), now)).toBe('3月8日 09:05');
});

it('saves one switch at a time with the settings revision, and hides itself on an older server', async () => {
  const view = (values: Record<string, boolean>, revision: number) => ({ group: 'scanning', revision, values, fields: [
    { key: 'interval', label: '间隔', type: 'number' },
    { key: 'mediaAutoScan', label: '自动扫描新文件', type: 'checkbox' }, { key: 'mediaScrape', label: '刮削封面与简介', type: 'checkbox' },
    { key: 'mediaEmbedded', label: '读取内嵌字幕与歌词', type: 'checkbox' }, { key: 'mediaHidden', label: '扫描隐藏文件夹', type: 'checkbox' },
  ] });
  const businessSettingsRequest = vi.fn(async (_path: string, method: string) => method === 'GET'
    ? { groups: [view({ mediaAutoScan: true, mediaScrape: false, mediaEmbedded: true, mediaHidden: false }, 3)] }
    : view({ mediaAutoScan: true, mediaScrape: true, mediaEmbedded: true, mediaHidden: false }, 4));
  await act(async () => render(<MediaScanSettings api={{ businessSettingsRequest } as never} />, root));
  await vi.waitFor(() => expect(root.querySelectorAll('[role=switch]')).toHaveLength(4));
  const switches = () => [...root.querySelectorAll('[role=switch]')].map(node => [node.querySelector('strong')?.textContent, node.getAttribute('aria-checked')]);
  expect(switches()).toEqual([['自动扫描新文件', 'true'], ['刮削封面与简介', 'false'], ['读取内嵌字幕与歌词', 'true'], ['扫描隐藏文件夹', 'false']]);
  await act(async () => root.querySelectorAll<HTMLButtonElement>('[role=switch]')[1]!.click());
  expect(businessSettingsRequest).toHaveBeenLastCalledWith('scanning', 'PATCH', { values: { mediaScrape: true }, revision: 3 });
  expect(switches()[1]).toEqual(['刮削封面与简介', 'true']);
  act(() => render(null, root));
  const old = vi.fn(async () => ({ groups: [{ group: 'scanning', revision: 1, values: {}, fields: [{ key: 'interval', label: '间隔', type: 'number' }] }] }));
  await act(async () => render(<MediaScanSettings api={{ businessSettingsRequest: old } as never} />, root));
  await vi.waitFor(() => expect(old).toHaveBeenCalled());
  expect(root.querySelector('.media-scan-settings')).toBeNull();
});
