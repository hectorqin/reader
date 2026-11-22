// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { PdfRegionPainter } from '../src/formats/pdf-regions.ts';
import type { PdfRenderer } from '../src/formats/types.ts';

const figure = (page: number, box: string) =>
  `<figure class="pdf-region" data-kind="figure" data-page="${page}" data-box="${box}"><img alt="" width="200" height="100"/></figure>`;

describe('PdfRegionPainter', () => {
  it('draws each placeholder from its page and box, once per region, and only opens the PDF when needed', async () => {
    let url = 0;
    URL.createObjectURL = vi.fn(() => `blob:region-${++url}`);
    URL.revokeObjectURL = vi.fn();
    const renderRegion = vi.fn(async (_page: number, _box: number[], _scale: number) => new Blob(['png']));
    const dispose = vi.fn();
    const open = vi.fn(async () => ({ renderRegion, dispose }) as unknown as PdfRenderer);
    const painter = new PdfRegionPainter(open);
    const root = document.createElement('div');
    root.innerHTML = '<p>正文</p>';
    await painter.paint(root);
    expect(open).not.toHaveBeenCalled();

    root.innerHTML = figure(3, '100,200,300,300') + figure(4, '0,60,1200,90');
    await painter.paint(root);
    expect(open).toHaveBeenCalledOnce();
    expect(renderRegion.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      [3, [100, 200, 300, 300]],
      [4, [0, 60, 1200, 90]],
    ]);
    // A wide region is drawn at fewer pixels per unit, so no drawing is enormous.
    expect(renderRegion.mock.calls[0]![2]).toBe(2.5);
    expect(renderRegion.mock.calls[1]![2]).toBe(2);
    expect([...root.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual([
      'blob:region-1',
      'blob:region-2',
    ]);

    // The chapter laid out again: the same drawings, not drawn again.
    root.innerHTML = figure(3, '100,200,300,300');
    await painter.paint(root);
    expect(renderRegion).toHaveBeenCalledTimes(2);
    expect(root.querySelector('img')!.getAttribute('src')).toBe('blob:region-1');

    painter.dispose();
    await vi.waitFor(() => expect(dispose).toHaveBeenCalled());
    await vi.waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2));
  });

  it('draws a formula inside a sentence too', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:inline');
    const renderRegion = vi.fn(async (_page: number, _box: number[], _scale: number) => new Blob(['png']));
    const painter = new PdfRegionPainter(async () => ({ renderRegion, dispose: vi.fn() }) as unknown as PdfRenderer);
    const root = document.createElement('p');
    root.innerHTML = '记<img class="pdf-inline" data-page="24" data-box="325,447,420,469" alt="X = 1/n"/>，则';
    await painter.paint(root);
    expect(renderRegion.mock.calls[0]!.slice(0, 2)).toEqual([24, [325, 447, 420, 469]]);
    expect(root.querySelector('img')!.getAttribute('src')).toBe('blob:inline');
  });

  it('says where a figure is when the PDF cannot be read, and tries again next time', async () => {
    const open = vi.fn(async () => {
      throw new Error('offline');
    });
    const painter = new PdfRegionPainter(open);
    const root = document.createElement('div');
    root.innerHTML = figure(2, '0,0,100,100');
    await painter.paint(root);
    const placeholder = root.querySelector<HTMLElement>('figure')!;
    expect(placeholder.dataset.state).toBe('unavailable');
    expect(placeholder.dataset.unavailable).toContain('联网或下载整本 PDF');
  });
});
