import { vi } from 'vitest';

export const openPdf = vi.fn(async () => ({
  document: { numPages: 3 },
  renderer: {
    render: vi.fn(async (page: number, container: HTMLElement) => {
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-label', `第 ${page} 页`);
      container.append(canvas);
    }),
    renderRegion: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
    pageText: vi.fn(async (page: number) => (page === 2 ? '第二页里有要找的词。' : `第 ${page} 页的文字。`)),
    outline: vi.fn(async () => [
      { title: '序', page: 1, depth: 0 },
      { title: '第一章', page: 2, depth: 0 },
      { title: '第一节', page: 3, depth: 1 },
    ]),
    cancel: vi.fn(),
    dispose: vi.fn(),
  },
}));
