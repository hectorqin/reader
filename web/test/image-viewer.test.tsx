// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageViewer, clampPan, zoomAbout } from '../src/ui/image-viewer.tsx';
import { attachGestures } from '../src/ui/gestures.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('picture geometry', () => {
  it('keeps the point under the finger where it is while zooming', () => {
    const at = { scale: 1, x: 0, y: 0 };
    const zoomed = zoomAbout(at, 2, 100, -40);
    // The picture point under (100, −40) before: (100, −40). After: (p − t) / s.
    expect((100 - zoomed.x) / zoomed.scale).toBeCloseTo(100);
    expect((-40 - zoomed.y) / zoomed.scale).toBeCloseTo(-40);
    const again = zoomAbout(zoomed, 5, -30, 60);
    expect((-30 - again.x) / again.scale).toBeCloseTo((-30 - zoomed.x) / zoomed.scale);
  });

  it('never zooms below rest or past the limit, and rest is centred', () => {
    expect(zoomAbout({ scale: 2, x: 80, y: 10 }, 0.3, 50, 50)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(zoomAbout({ scale: 1, x: 0, y: 0 }, 99, 0, 0).scale).toBe(6);
  });

  it('lets a zoomed picture move only until its edge meets the window', () => {
    // 300×200 at 3× is 900×600 in a 400×800 window: 250 of travel sideways, none up or down.
    expect(clampPan({ scale: 3, x: 999, y: 999 }, 300, 200, 400, 800)).toEqual({ scale: 3, x: 250, y: 0 });
    expect(clampPan({ scale: 3, x: -999, y: -5 }, 300, 200, 400, 800)).toEqual({ scale: 3, x: -250, y: 0 });
    expect(clampPan({ scale: 3, x: 40, y: 0 }, 300, 200, 400, 800)).toEqual({ scale: 3, x: 40, y: 0 });
  });
});

describe('ImageViewer', () => {
  let host: HTMLElement, root: Root;
  const images = [
    { src: 'blob:a', alt: '一' },
    { src: 'blob:b', alt: '二' },
    { src: 'blob:c', alt: '三' },
  ];
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const shown = () => host.querySelector('img')!.getAttribute('src');
  const key = (value: string) =>
    act(() => {
      host.querySelector('dialog')!.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
    });
  const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

  it('opens on the picture that was tapped and steps through the chapter, stopping at its ends', () => {
    act(() => root.render(<ImageViewer images={images} start={1} onClose={() => undefined} />));
    expect(shown()).toBe('blob:b');
    expect(host.querySelector('.image-viewer-count')?.textContent).toBe('2 / 3');
    key('ArrowRight');
    expect(shown()).toBe('blob:c');
    expect(button('下一张').disabled).toBe(true);
    key('ArrowRight');
    expect(shown()).toBe('blob:c');
    act(() => button('上一张').click());
    act(() => button('上一张').click());
    expect(shown()).toBe('blob:a');
    expect(button('上一张').disabled).toBe(true);
  });

  it('has no counter or step buttons for a chapter with one picture', () => {
    act(() => root.render(<ImageViewer images={images.slice(0, 1)} start={0} onClose={() => undefined} />));
    expect(host.querySelector('.image-viewer-count')).toBeNull();
    expect(host.querySelector('.image-viewer-step')).toBeNull();
  });

  it('zooms from the keyboard and returns to rest on the next picture', () => {
    act(() => root.render(<ImageViewer images={images} start={0} onClose={() => undefined} />));
    const surface = host.querySelector<HTMLElement>('.image-viewer-surface')!;
    expect(surface.dataset['zoomed']).toBe('false');
    key('+');
    expect(surface.dataset['zoomed']).toBe('true');
    expect(host.querySelector('img')!.style.transform).toContain('scale(1.4)');
    key('ArrowRight');
    expect(surface.dataset['zoomed']).toBe('false');
    expect(host.querySelector('img')!.style.transform).toContain('scale(1)');
  });

  it('closes from ✕ and from Escape, without the key reaching the reader behind it', () => {
    const onClose = vi.fn(),
      behind = vi.fn();
    document.addEventListener('keydown', behind);
    act(() => root.render(<ImageViewer images={images} start={0} onClose={onClose} />));
    act(() => button('关闭').click());
    // Escape on a modal dialog arrives as the platform's `cancel`; the key itself stays here.
    key('Escape');
    key('ArrowRight');
    act(() => {
      host.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    document.removeEventListener('keydown', behind);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(behind).not.toHaveBeenCalled();
  });
});

describe('a tap offered to its target first', () => {
  const tap = (stage: HTMLElement, target: Element) => {
    const init = { bubbles: true, composed: true, clientX: 10, clientY: 10, button: 0 };
    target.dispatchEvent(new MouseEvent('pointerdown', init));
    target.dispatchEvent(new MouseEvent('pointerup', init));
    void stage;
  };
  const handlers = (onTapTarget: (path: EventTarget[]) => boolean, onTapZone: () => void) => ({
    onTapZone,
    onSwipe: () => undefined,
    onDragDelta: () => undefined,
    onLongPress: () => undefined,
    hasSelection: () => false,
    onTapTarget,
  });

  it('is not also a page turn when the target takes it, and is one when it does not', () => {
    const stage = document.createElement('div'),
      picture = document.createElement('img'),
      text = document.createElement('p');
    Object.defineProperty(stage, 'offsetWidth', { value: 300 });
    Object.defineProperty(stage, 'offsetHeight', { value: 600 });
    stage.append(picture, text);
    document.body.append(stage);
    const zone = vi.fn(),
      seen: EventTarget[] = [];
    const detach = attachGestures(
      stage,
      handlers((path) => {
        seen.push(path[0]!);
        return path[0] === picture;
      }, zone),
    );
    tap(stage, picture);
    expect(zone).not.toHaveBeenCalled();
    tap(stage, text);
    expect(zone).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([picture, text]);
    detach();
    stage.remove();
  });
});
