// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { render } from '../src/shared/ui/render-root.ts';
import { ResourcePanel } from '../src/features/media/components/resource-panel.tsx';
import type { MediaApi } from '../src/features/media/api/media-api.ts';

const root = document.createElement('div');
document.body.append(root);
afterEach(() => act(() => render(null, root)));

const api = { request: vi.fn().mockResolvedValue({ size: 1024, available: true, probe: { status: 'ready', info: null } }) } as unknown as MediaApi;

it('keeps the resource trigger visible and exposes resource, version and source actions', async () => {
  await act(async () => render(<ResourcePanel api={api} assets={[{ id: 'asset-1', title: '影片' }]} summary="1 个文件 · 原版" versionPicker={<label>版本<select><option>原版</option></select></label>} sourceInfo={<p>资料来源：TMDB</p>} />, root));
  const panel = root.querySelector('.media-resource-panel');
  expect(panel).not.toBeNull();
  expect(panel?.classList.contains('media-resource-hidden')).toBe(false);
  expect(panel?.getAttribute('aria-hidden')).toBeNull();

  await act(async () => (panel?.querySelector('summary') as HTMLElement).click());
  expect(root.textContent).toContain('资源信息');
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('.media-resource-panel nav button')];
  expect(buttons.map(button => button.textContent)).toEqual(['资源信息', '播放版本', '来源']);

  await act(async () => buttons[1]!.click());
  expect(document.querySelector('dialog[open]')?.getAttribute('aria-label')).toBe('播放版本');
});

it('allows the page action menu to open resource details without rendering a body trigger', async () => {
  const onPanelChange = vi.fn();
  await act(async () => render(<ResourcePanel api={api} assets={[{ id: 'asset-1', title: '影片' }]} summary="1 个文件 · 原版" sourceInfo={<p>资料来源：TMDB</p>} openPanel="source" onPanelChange={onPanelChange} showTrigger={false} />, root));
  expect(root.querySelector('.media-resource-panel')).toBeNull();
  expect(document.querySelector('dialog[open]')?.getAttribute('aria-label')).toBe('来源');
  const close = document.querySelector<HTMLButtonElement>('dialog button[aria-label="关闭弹窗"]');
  await act(async () => close?.click());
  expect(document.querySelector('dialog[open]')).toBeNull();
  expect(onPanelChange).toHaveBeenCalledWith(null);
});
