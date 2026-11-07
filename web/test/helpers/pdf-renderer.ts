import { vi } from 'vitest';

export const openPdf = vi.fn(async () => ({
  document: { numPages: 3 },
  renderer: {
    render: vi.fn(async (page: number, container: HTMLElement) => {
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-label', `第 ${page} 页`);
      container.append(canvas);
    }),
    cancel: vi.fn(),
    dispose: vi.fn(),
  },
}));
