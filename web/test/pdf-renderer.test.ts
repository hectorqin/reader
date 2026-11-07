// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfSource } from '../src/formats/types.ts';

const engine = vi.hoisted(() => ({ getDocument: vi.fn(), getPage: vi.fn(), destroy: vi.fn(), render: vi.fn(), textRender: vi.fn() }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: engine.getDocument,
  PDFDataRangeTransport: class {
    onDataRange = vi.fn();
    constructor(readonly length: number) {}
  },
  TextLayer: class {
    render = engine.textRender;
    cancel = vi.fn();
  },
}));

import { openPdf } from '../src/formats/pdf-renderer.ts';

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  engine.destroy.mockResolvedValue(undefined);
  engine.textRender.mockResolvedValue(undefined);
  engine.render.mockImplementation(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  engine.getPage.mockImplementation(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: engine.render, streamTextContent: () => ({}), cleanup: vi.fn(),
  }));
  engine.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 3, getPage: engine.getPage }), destroy: engine.destroy });
});

describe('PDF.js rendering', () => {
  it('uses range transport without streaming or automatic full-file fetching', async () => {
    const source: PdfSource = { length: 1000000, readRange: vi.fn(async () => new Uint8Array(65536)) };
    const { renderer } = await openPdf(source);
    const options = engine.getDocument.mock.calls[0]![0];
    expect(options).toMatchObject({ disableAutoFetch: true, disableStream: true, rangeChunkSize: 65536 });
    expect(options.data).toBeUndefined();
    options.range.requestDataRange(65536, 131072);
    await vi.waitFor(() => expect(options.range.onDataRange).toHaveBeenCalledWith(65536, expect.any(Uint8Array)));
    expect(source.readRange).toHaveBeenCalledWith(65536, 131072, expect.any(AbortSignal));
    const signal = vi.mocked(source.readRange).mock.calls[0]![2];
    renderer.dispose();
    expect(signal.aborted).toBe(true);
    expect(engine.destroy).toHaveBeenCalled();
  });

  it('copies offline bytes before PDF.js can transfer their buffer', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { renderer } = await openPdf(bytes);
    const options = engine.getDocument.mock.calls[0]![0];
    expect(options.data).toEqual(bytes);
    expect(options.data).not.toBe(bytes);
    expect(options.range).toBeUndefined();
    renderer.dispose();
  });

  it('renders only the requested page, preserves text selection and releases the canvas on cancellation', async () => {
    const { renderer } = await openPdf(new Uint8Array([1]));
    const container = document.createElement('div');
    Object.defineProperties(container, { clientWidth: { value: 300 }, clientHeight: { value: 300 } });
    await renderer.render(2, container, 'contain');
    expect(engine.getPage).toHaveBeenCalledExactlyOnceWith(2);
    const canvas = container.querySelector('canvas')!;
    expect(canvas.style.width).toBe('225px');
    expect(canvas.style.height).toBe('300px');
    expect(container.querySelector('.textLayer')).not.toBeNull();
    expect(engine.textRender).toHaveBeenCalledOnce();
    renderer.cancel();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    renderer.dispose();
  });

  it('fits the width and lets tall pages scroll rather than clipping them', async () => {
    const { renderer } = await openPdf(new Uint8Array([1]));
    const container = document.createElement('div');
    Object.defineProperties(container, { clientWidth: { value: 300 }, clientHeight: { value: 300 } });
    await renderer.render(1, container, 'width');
    expect(container.querySelector('canvas')?.style.height).toBe('400px');
    renderer.dispose();
  });

  it('does not overwrite the current page when an old getPage completes late', async () => {
    const { renderer } = await openPdf(new Uint8Array([1]));
    let finish!: (page: unknown) => void;
    engine.getPage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const oldContainer = document.createElement('div');
    const pending = renderer.render(1, oldContainer, 'contain');
    const current = document.createElement('div');
    await renderer.render(2, current, 'contain');
    finish({ cleanup: vi.fn() });
    await pending;
    expect(oldContainer.querySelector('canvas')).toBeNull();
    expect(current.querySelector('canvas')?.getAttribute('aria-label')).toBe('第 2 页');
    renderer.dispose();
  });

  it('surfaces range errors and destroys the loading worker', async () => {
    engine.getDocument.mockReturnValue({ promise: new Promise(() => undefined), destroy: engine.destroy });
    const source: PdfSource = { length: 1000000, readRange: async () => { throw new Error('range failed'); } };
    const opening = openPdf(source);
    engine.getDocument.mock.calls[0]![0].range.requestDataRange(0, 65536);
    await expect(opening).rejects.toThrow('range failed');
    expect(engine.destroy).toHaveBeenCalled();
  });

  it('cancels a pending open immediately and destroys its worker only once', async () => {
    engine.getDocument.mockReturnValue({ promise: new Promise(() => undefined), destroy: engine.destroy });
    const controller = new AbortController();
    const opening = openPdf(new Uint8Array([1]), controller.signal);
    controller.abort();
    await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    expect(engine.destroy).toHaveBeenCalledOnce();
  });
});
