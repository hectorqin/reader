// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startSheetDrag } from '../src/ui/sheet-drag.ts';

/**
 * jsdom lays nothing out, so the sheet's height is what CSS would give it: 500px at
 * rest, 800px expanded, the inline height while a finger holds it.
 */
function sheet(): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.innerHTML = '<div class="sheet-grip"></div><header class="sheet-header"><h2>标题</h2><button>关闭</button></header>';
  dialog.getBoundingClientRect = () => {
    const height = dialog.style.height ? parseFloat(dialog.style.height) : dialog.hasAttribute('data-expanded') ? 800 : 500;
    return { height, width: 360, top: 0, left: 0, right: 360, bottom: height, x: 0, y: 0, toJSON() {} } as DOMRect;
  };
  dialog.setPointerCapture = () => {};
  document.body.append(dialog);
  return dialog;
}

let clock = 0;
function pointer(type: string, y: number, target: EventTarget, dt = 100): MouseEvent {
  const event = new MouseEvent(type, { clientY: y, bubbles: true, cancelable: true, button: 0 });
  clock += dt;
  Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true }, timeStamp: { value: clock } });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

/** Press the grip at y=600, move through `path`, let go at its last point. */
function drag(dialog: HTMLDialogElement, path: number[], options: { expandable?: boolean; busy?: boolean; on?: Element; dt?: number } = {}) {
  const close = vi.fn();
  const target = options.on ?? dialog.querySelector('.sheet-grip')!;
  startSheetDrag(pointer('pointerdown', 600, target) as PointerEvent, dialog, { expandable: options.expandable ?? true, busy: () => options.busy ?? false, close });
  for (const y of path) dispatchEvent(pointer('pointermove', y, target, options.dt));
  dispatchEvent(pointer('pointerup', path.at(-1) ?? 600, target, options.dt));
  return close;
}

beforeEach(() => {
  clock = 0;
  // Reduced motion: every rest is reached at once, so the outcome is readable synchronously.
  window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), addEventListener() {}, removeEventListener() {} })) as any;
});
afterEach(() => { document.body.replaceChildren(); });

describe('dragging a phone sheet', () => {
  it('closes when pulled down past a third of its height, and springs back from less', () => {
    const dialog = sheet();
    expect(drag(dialog, [650, 700, 780])).toHaveBeenCalledTimes(1);
    const shy = drag(dialog, [620, 650, 700]);
    expect(shy).not.toHaveBeenCalled();
    expect(dialog.style.transform).toBe('');
    expect(dialog.style.height).toBe('');
  });

  it('closes on a short, fast flick down', () => {
    expect(drag(sheet(), [610, 640], { dt: 10 })).toHaveBeenCalledTimes(1);
  });

  it('will not close while busy', () => {
    const dialog = sheet();
    expect(drag(dialog, [700, 900], { busy: true })).not.toHaveBeenCalled();
    expect(dialog.style.transform).toBe('');
  });

  it('expands when pulled up past halfway, and comes back to its usual height from there', () => {
    const dialog = sheet();
    drag(dialog, [500, 400, 380]);
    expect(dialog.hasAttribute('data-expanded')).toBe(true);
    // Pulled down from expanded, it rests at its usual height rather than closing.
    const close = drag(dialog, [700, 850, 900]);
    expect(close).not.toHaveBeenCalled();
    expect(dialog.hasAttribute('data-expanded')).toBe(false);
  });

  it('takes a fast flick down from expanded as "smaller", not "close"', () => {
    const dialog = sheet();
    drag(dialog, [500, 400, 380]);
    expect(drag(dialog, [700, 850, 950], { dt: 10 })).not.toHaveBeenCalled();
    expect(dialog.hasAttribute('data-expanded')).toBe(false);
    // Pulled well below its usual height, it does close.
    drag(dialog, [500, 400, 380]);
    expect(drag(dialog, [900, 1100, 1250])).toHaveBeenCalledTimes(1);
  });

  it('stays at its usual height when pulled up only a little', () => {
    const dialog = sheet();
    drag(dialog, [580, 560]);
    expect(dialog.hasAttribute('data-expanded')).toBe(false);
  });

  it('does not expand a compact sheet', () => {
    const dialog = sheet();
    drag(dialog, [400, 200], { expandable: false });
    expect(dialog.hasAttribute('data-expanded')).toBe(false);
  });

  it('leaves a tap alone, and a press on the title bar’s buttons to the button', () => {
    const dialog = sheet();
    expect(drag(dialog, [602])).not.toHaveBeenCalled();
    expect(dialog.hasAttribute('data-dragging')).toBe(false);
    expect(drag(dialog, [700, 900], { on: dialog.querySelector('button')! })).not.toHaveBeenCalled();
    expect(dialog.style.transform).toBe('');
  });
});
