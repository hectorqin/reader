// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { mountUI } from '../src/ui/mount.ts';

/**
 * The bridge between a screen's state bag and the component tree.
 *
 * Worth its own file because the two properties below are what make the reader's
 * chrome affordable to update from a scroll handler, and both are easy to lose in a
 * refactor that looks equivalent.
 */
describe('mountUI', () => {
  it('renders once on mount and once per update, not once per field', () => {
    // A `patch()` is a full tree diff. A screen that calls it three times for one
    // logical change pays three times, and the reader's position handler used to do
    // exactly that — once per frame while a finger was down.
    const container = document.createElement('div');
    let renders = 0;
    const ui = mountUI(
      container,
      (value) => {
        renders += 1;
        return h('p', null, String(value));
      },
      0,
    );
    expect(renders).toBe(1);

    // One `update` per logical change is the contract; a caller that batches its
    // fields into one object gets one render no matter how many fields it carries.
    ui.update({ a: 1, b: 2, c: 3 });
    ui.update({ a: 2, b: 2, c: 3 });
    expect(renders).toBe(3);
  });

  it('drops updates after unmount instead of repainting a cleared container', () => {
    // Every screen loads asynchronously and can be left mid-load. Without the
    // guard, a late response paints a whole screen into a container Preact has
    // already been told is empty — and a later `render(null)` does not remove it,
    // because as far as Preact is concerned it was never its child.
    const container = document.createElement('div');
    const ui = mountUI(container, (value) => h('p', null, String(value)), 'a');
    ui.unmount();
    ui.update('late');
    expect(container.textContent).toBe('');
  });

  it('keeps a node the caller owns across renders, via a ref', () => {
    // How the reader puts its `stage` in the tree: not as a child the diff would
    // recreate, but through a ref callback that appends the element the screen has
    // kept since its constructor. A tree that replaced the node would take the
    // shadow root, the scroll position and the paginator's measurements with it —
    // and the position, because `ReaderView` measures *that* element.
    const container = document.createElement('div');
    const stage = document.createElement('div');
    stage.className = 'stage';
    const ui = mountUI(
      container,
      (value) =>
        h(
          'div',
          { className: 'wrap', 'data-v': String(value) },
          h('div', {
            className: 'slot',
            ref: (node: Element | null) => {
              if (node && stage.parentElement !== node) node.append(stage);
            },
          }),
        ),
      0,
    );
    expect(container.querySelector('.stage')).toBe(stage);
    ui.update(1);
    expect(container.querySelector('.stage')).toBe(stage);
    expect(container.querySelector('.wrap')?.getAttribute('data-v')).toBe('1');
  });
});
