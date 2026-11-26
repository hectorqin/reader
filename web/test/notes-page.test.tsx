// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '../src/shared/ui/render-root.ts';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { NotesPage } from '../src/features/notes/pages/NotesPage.tsx';

const note = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  bookId: 'b 1',
  type: 'highlight',
  locator: `r1:0.5:${id}`,
  text: `原文 ${id}`,
  comment: '',
  color: '#ffd54f',
  updatedAt: Date.UTC(2026, 10, 2),
  chapterTitle: '第三章',
  tags: [] as string[],
  bookTitle: '围城',
  bookAuthor: '钱锺书',
  ...patch,
});
let items = [note('n1'), note('n2', { type: 'note', comment: '我的批注' }), note('n3', { type: 'bookmark', text: '' })];
let total = 3;
let reviewBody = '';
const runtime = {
  api: {
    notesLibrary: vi.fn(async (query: { page?: number }) => ({
      items: (query.page ?? 1) > Math.ceil(total / 50) && total > 0 ? [] : items,
      total,
      page: query.page ?? 1,
      pageSize: 50,
    })),
    notesLibraryBooks: vi.fn(async () => [{ bookId: 'b 1', title: '围城', author: '钱锺书', count: 3, lastAt: 0 }]),
    bookReview: vi.fn(async () =>
      reviewBody ? { bookId: 'b 1', body: reviewBody, updatedAt: Date.UTC(2026, 10, 3) } : null,
    ),
    saveBookReview: vi.fn(async (_book: string, body: string) => {
      reviewBody = body.trim();
      return null;
    }),
    notesLibraryTags: vi.fn(async () => [
      { tag: '婚姻', count: 2 },
      { tag: '金句', count: 1 },
    ]),
    notesExport: vi.fn(async (_filter: unknown, format: string) => ({
      filename: 'reader-notes.md',
      mime: 'text/markdown',
      content: `# ${format}`,
      count: 2,
      reviews: 1,
    })),
  },
  offline: {
    deleteNote: vi.fn(async (id: string) => {
      items = items.filter((item) => item.id !== id);
      total = items.length;
    }),
    upsertNotes: vi.fn(async (notes: Array<{ id: string; tags: string[] }>) => {
      items = items.map((item) => (item.id === notes[0]!.id ? { ...item, tags: notes[0]!.tags } : item));
    }),
  },
  sync: { flush: vi.fn(async () => undefined) },
} as any;

const root = document.createElement('div');
document.body.append(root);
let client: QueryClient;
let where = '';
let state: unknown;
function Probe() {
  const location = useLocation();
  where = location.pathname + location.search;
  state = location.state;
  return null;
}
const paint = (path: string) =>
  act(async () =>
    render(
      <RuntimeContext.Provider value={runtime}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[path]}>
            <Probe />
            <Routes>
              <Route path="/me/notes" element={<NotesPage />} />
              <Route path="/book/:bookId" element={<p>reader</p>} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </RuntimeContext.Provider>,
      root,
    ),
  );
const button = (label: string) =>
  [...document.querySelectorAll('button')].find(
    (item) => item.getAttribute('aria-label') === label || item.textContent === label,
  )!;
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeAll(() => {
  window.matchMedia ??= () =>
    ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
});
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  items = [note('n1'), note('n2', { type: 'note', comment: '我的批注' }), note('n3', { type: 'bookmark', text: '' })];
  total = 3;
  reviewBody = '';
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => render(null, root));
});

it('asks the server for the view in the address and lists what comes back', async () => {
  await paint('/me/notes?q=%E5%9B%B4%E5%9F%8E&type=note&book=b%201&page=1');
  await settle();
  expect(runtime.api.notesLibrary).toHaveBeenCalledWith(
    { q: '围城', type: 'note', bookId: 'b 1', tag: '', page: 1 },
    expect.anything(),
  );
  // The book picker counts under the words and the type, not under its own choice.
  expect(runtime.api.notesLibraryBooks).toHaveBeenCalledWith({ q: '围城', type: 'note', tag: '' }, expect.anything());
  expect([...root.querySelectorAll('.notes-item')].map((item) => item.getAttribute('data-type'))).toEqual([
    'highlight',
    'note',
    'bookmark',
  ]);
  expect(root.querySelector('.notes-list')?.textContent).toContain('我的批注');
  expect(root.querySelector('.notes-count')?.textContent).toBe('共 3 条');
  expect(root.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe('围城');
});

it('a note opens its book at the note and remembers the view to come back to', async () => {
  await paint('/me/notes?type=highlight');
  await settle();
  const link = root.querySelector<HTMLAnchorElement>('.notes-open')!;
  expect(link.getAttribute('href')).toBe('/book/b%201');
  await act(async () => link.click());
  expect(where).toBe('/book/b%201');
  expect(state).toEqual({ openAt: 'r1:0.5:n1', returnTo: '/me/notes?type=highlight' });
});

it('a page past the end is rewritten to the last page', async () => {
  total = 120;
  await paint('/me/notes?page=9');
  await settle();
  await settle();
  expect(where).toBe('/me/notes?page=3');
});

it('says so when there are no notes, and when the filter matches none', async () => {
  items = [];
  total = 0;
  await paint('/me/notes');
  await settle();
  expect(root.querySelector('.notes-state')?.textContent).toContain('还没有笔记');
  expect(button('导出').disabled).toBe(true);
  await act(async () => render(null, root));
  await paint('/me/notes?q=x');
  await settle();
  expect(root.querySelector('.notes-state')?.textContent).toContain('没有符合条件的笔记');
});

it('deleting goes through the offline queue and sync, then re-reads the list', async () => {
  await paint('/me/notes');
  await settle();
  await act(async () => button('删除这条高亮').click());
  expect(runtime.offline.deleteNote).not.toHaveBeenCalled();
  await act(async () => button('确认删除').click());
  await settle();
  expect(runtime.offline.deleteNote).toHaveBeenCalledWith('n1');
  expect(runtime.sync.flush).toHaveBeenCalledOnce();
  expect(runtime.sync.flush.mock.invocationCallOrder[0]).toBeGreaterThan(
    runtime.offline.deleteNote.mock.invocationCallOrder[0],
  );
  expect(runtime.api.notesLibrary).toHaveBeenCalledTimes(2);
  expect([...root.querySelectorAll('.notes-quote')].map((item) => item.textContent)).toEqual(['原文 n2']);
});

it('tags a note through the offline queue and sync, and a tag on a note filters by it', async () => {
  items = [note('n1', { tags: ['婚姻'] }), note('n2')];
  total = 2;
  await paint('/me/notes');
  await settle();
  // The line under a note says where it is from.
  expect(root.querySelector('.notes-meta')?.textContent).toContain('围城 · 第三章 · 钱锺书');
  await act(async () => button('编辑这条高亮的标签').click());
  // Already on the note; the rest of the vocabulary is offered.
  expect(button('移除标签 婚姻')).toBeTruthy();
  expect(button('添加标签 婚姻')).toBeUndefined();
  await act(async () => button('添加标签 金句').click());
  const field = document.querySelector<HTMLInputElement>('input[aria-label="新标签"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '#待重读，婚姻');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('保存').click());
  await settle();
  const sent = runtime.offline.upsertNotes.mock.calls[0]![0][0];
  expect(sent).toMatchObject({ id: 'n1', bookId: 'b 1', tags: ['婚姻', '金句', '待重读'], locator: 'r1:0.5:n1' });
  // The record that goes to sync is a note, not the list row.
  expect(sent).not.toHaveProperty('bookTitle');
  expect(sent.updatedAt).toBeGreaterThan(Date.UTC(2026, 10, 2));
  expect(runtime.sync.flush).toHaveBeenCalledOnce();
  expect([...root.querySelectorAll('.notes-list .notes-tag')].map((item) => item.textContent)).toEqual([
    '#婚姻',
    '#金句',
    '#待重读',
  ]);
  await act(async () => button('只看标签 金句').click());
  expect(where).toBe('/me/notes?tag=%E9%87%91%E5%8F%A5');
});

it('shows no review card until one book is picked', async () => {
  await paint('/me/notes');
  await settle();
  expect(root.querySelector('.notes-review')).toBeNull();
  expect(runtime.api.bookReview).not.toHaveBeenCalled();
});

it('writes a review for the picked book, saves it online and shows what the server holds', async () => {
  await paint('/me/notes?book=b%201');
  await settle();
  expect(runtime.api.bookReview).toHaveBeenCalledWith('b 1', expect.anything());
  expect(root.querySelector('.notes-review')?.textContent).toContain('写下整体的感想');
  await act(async () => button('写书评').click());
  const field = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="书评"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, '一本关于婚姻的书');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('保存').click());
  await settle();
  expect(runtime.api.saveBookReview).toHaveBeenCalledWith('b 1', '一本关于婚姻的书');
  expect(runtime.api.bookReview).toHaveBeenCalledTimes(2);
  expect(root.querySelector('.notes-review-body')?.textContent).toBe('一本关于婚姻的书');
  expect(document.querySelector('textarea[aria-label="书评"]')).toBeNull();
});

it('deleting a review asks first, then saves it empty', async () => {
  reviewBody = '旧书评';
  await paint('/me/notes?book=b%201');
  await settle();
  await act(async () => button('编辑').click());
  await act(async () => button('删除').click());
  expect(runtime.api.saveBookReview).not.toHaveBeenCalled();
  await act(async () => button('确认删除').click());
  await settle();
  expect(runtime.api.saveBookReview).toHaveBeenCalledWith('b 1', '');
  expect(root.querySelector('.notes-review-body')).toBeNull();
});

it('refuses a tag that is too long instead of sending it', async () => {
  await paint('/me/notes');
  await settle();
  await act(async () => button('编辑这条高亮的标签').click());
  const field = document.querySelector<HTMLInputElement>('input[aria-label="新标签"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '长'.repeat(33));
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('保存').click());
  expect(runtime.offline.upsertNotes).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('标签最长 32 个字');
});

it('exports what the filter shows, copied as Markdown', async () => {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  await paint('/me/notes?type=highlight');
  await settle();
  await act(async () => button('导出').click());
  await act(async () => button('复制 Markdown').click());
  await settle();
  expect(runtime.api.notesExport).toHaveBeenCalledWith(
    { q: '', type: 'highlight', bookId: '', tag: '' },
    'markdown',
    expect.any(Number),
  );
  expect(writeText).toHaveBeenCalledWith('# markdown');
  expect(document.querySelector('.notes-export-status')?.textContent).toBe('已复制 2 条笔记、1 篇书评');
});

it.each([undefined, {}])('offers download or HTTPS when clipboard writing is unavailable (%s)', async (clipboard) => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
  await paint('/me/notes');
  await settle();
  await act(async () => button('导出').click());
  await act(async () => button('复制 Markdown').click());
  await settle();
  expect(document.querySelector('.notes-export-status')?.textContent).toBe(
    '当前环境不支持剪贴板，请使用下载导出或通过 HTTPS 访问',
  );
  expect(button('复制 Markdown').disabled).toBe(false);
  expect(button('下载 Markdown').disabled).toBe(false);
});
