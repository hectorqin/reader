// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '../src/shared/ui/render-root.ts';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { BookMetadataSheet, metadataPatch } from '../src/ui/book-metadata-sheet.tsx';
import type { Book } from '../src/api/types.ts';

const book = (patch: Partial<Book> = {}): Book => ({
  id: 'b1', title: '斗罗大陆2', author: '唐家三少', publisher: '', language: 'zh', isbn: '', description: '', series: '斗罗大陆', seriesIndex: 1,
  tags: ['玄幻'], pubdate: '', format: 'txt', coverUrl: null, fileSize: 1, pageCount: null, source: 'embedded', manualFields: [], updatedAt: 0, ...patch,
} as Book);

const root = document.createElement('div');
document.body.append(root);
afterEach(() => { act(() => render(null, root)); });

const paint = async (api: object, onSaved = vi.fn(), onClose = vi.fn()) => {
  await act(async () => render(<RuntimeContext.Provider value={{ api } as any}><BookMetadataSheet bookId="b1" onClose={onClose} onSaved={onSaved} /></RuntimeContext.Provider>, root));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  return { onSaved, onClose };
};
const input = (label: string) => [...document.querySelectorAll<HTMLLabelElement>('.sheet-field')].find(field => field.textContent?.startsWith(label))!.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')!;
const type = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!;
  setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true }));
});
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!;

describe('metadataPatch', () => {
  it('sends only what changed, tags as a list and trimmed text', () => {
    expect(metadataPatch(book(), { title: ' 斗罗大陆2 ', author: '唐家三少' })).toEqual({});
    expect(metadataPatch(book(), { title: '斗罗大陆', tags: '玄幻，经典, 网文', seriesIndex: '1' })).toEqual({ title: '斗罗大陆', tags: ['玄幻', '经典', '网文'] });
    expect(metadataPatch(book(), { series: '' })).toEqual({ series: '' });
  });
});

describe('编辑信息', () => {
  it('saves the changed fields as manual values and closes', async () => {
    const updateBookMetadata = vi.fn(async (_id: string, patch: object) => book({ ...patch, manualFields: Object.keys(patch) }));
    const { onSaved, onClose } = await paint({ getBook: async () => ({ book: book(), progress: null }), updateBookMetadata });
    expect(input('书名').value).toBe('斗罗大陆2');
    expect(button('保存').disabled).toBe(true);
    type(input('书名'), '斗罗大陆');
    await act(async () => { button('保存').click(); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(updateBookMetadata).toHaveBeenCalledWith('b1', { title: '斗罗大陆' });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ title: '斗罗大陆' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('refuses a blank title and a series number that is not one', async () => {
    const updateBookMetadata = vi.fn();
    await paint({ getBook: async () => ({ book: book(), progress: null }), updateBookMetadata });
    type(input('书名'), '  ');
    expect(button('保存').disabled).toBe(true);
    expect(document.querySelector('[role=alert]')?.textContent).toBe('书名不能为空');
    type(input('书名'), '斗罗大陆'); type(input('系列序号'), '第二部');
    expect(button('保存').disabled).toBe(true);
    expect(updateBookMetadata).not.toHaveBeenCalled();
  });

  it('puts a manually changed field back to the file’s value with 恢复', async () => {
    const clearBookMetadata = vi.fn(async () => book({ title: '斗罗大陆' }));
    const { onSaved } = await paint({ getBook: async () => ({ book: book({ title: '手改的书名', manualFields: ['title'] }), progress: null }), clearBookMetadata });
    expect(document.querySelectorAll('.book-metadata-restore')).toHaveLength(1);
    await act(async () => { button('恢复').click(); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(clearBookMetadata).toHaveBeenCalledWith('b1', 'title');
    expect(input('书名').value).toBe('斗罗大陆');
    expect(onSaved).toHaveBeenCalled();
    expect(document.querySelector('.book-metadata-restore')).toBeNull();
  });
});
