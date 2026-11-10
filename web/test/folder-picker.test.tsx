// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowseEntry, BrowseListing } from '../src/api/types.ts';
import { FolderPicker, loadFolderChoices, type FolderChoices } from '../src/features/library/components/FolderPicker.tsx';

const entry = (path: string, type: 'dir' | 'file'): BrowseEntry => ({ name: path.split('/').pop()!, path, type } as BrowseEntry);
const listing = (path: string, entries: BrowseEntry[], total: number, dirs: number): BrowseListing =>
  ({ path, crumbs: [{ name: '书库', path: '' }], parent: null, entries, total, dirs, files: total - dirs, size: 0, writable: true, name: '书库' });

describe('loadFolderChoices', () => {
  it('collects the folders of every listing page and stops once it has them all', async () => {
    const pages: Record<number, BrowseListing> = {
      1: listing('', [entry('a.epub', 'file'), entry('b', 'dir')], 5, 2),
      2: listing('', [entry('c.epub', 'file'), entry('d', 'dir')], 5, 2),
      3: listing('', [entry('e.epub', 'file')], 5, 2),
    };
    const browse = vi.fn(async (_path: string, page: number) => pages[page]!);
    const choices = await loadFolderChoices(browse, '', new AbortController().signal);
    expect(choices.dirs.map(dir => dir.path)).toEqual(['b', 'd']);
    expect(browse).toHaveBeenCalledTimes(2);
  });
});

describe('FolderPicker', () => {
  let host: HTMLElement, root: Root;
  const tree: Record<string, FolderChoices> = {
    '': { crumbs: [{ name: '书库', path: '' }], dirs: [{ name: '小说', path: '小说' }, { name: '漫画', path: '漫画' }], writable: true },
    '小说': { crumbs: [{ name: '书库', path: '' }, { name: '小说', path: '小说' }], dirs: [], writable: true },
  };
  const load = vi.fn(async (path: string) => tree[path]!);
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const confirm = () => [...host.querySelectorAll('button')].find(button => button.textContent === '移动到这里')!;
  const row = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('.folder-picker-row')].find(button => button.textContent?.includes(name))!;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div'); document.body.append(host); root = createRoot(host); load.mockClear();
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it('does not offer the folder the items are already in, nor a folder being moved', async () => {
    await act(async () => root.render(<FolderPicker moving={['漫画']} from="" load={load} onPick={() => undefined} onClose={() => undefined} />));
    await flush();
    expect(confirm().disabled).toBe(true);
    expect(host.textContent).toContain('已经在这个文件夹里');
    expect(row('漫画').disabled).toBe(true);
    expect(row('小说').disabled).toBe(false);
  });

  it('answers with the folder walked to', async () => {
    const onPick = vi.fn();
    await act(async () => root.render(<FolderPicker moving={['a.epub']} from="" load={load} onPick={onPick} onClose={() => undefined} />));
    await flush();
    await act(async () => row('小说').click());
    await flush();
    expect(host.textContent).toContain('没有子文件夹');
    expect(confirm().disabled).toBe(false);
    await act(async () => confirm().click());
    expect(onPick).toHaveBeenCalledWith('小说');
  });
});
