/**
 * The one place component trees meet the DOM.
 *
 * The app's screens are ordinary classes (`ShelfScreen`, `ReaderScreen`, …) with
 * an `element` the router appends and a `dispose()`. That shape is kept
 * deliberately: the router knows nothing about the framework, and the screens
 * that *are* mostly imperative (the reader) never have to pretend otherwise.
 *
 * What changes is how a screen builds its own DOM. Instead of a constructor full
 * of `el()` calls and instance fields holding every node it will later poke, it
 * renders a component tree and lets the tree re-render itself from state. The
 * host object returned here is the bridge between the two worlds.
 */

import { render, type ComponentChildren } from './vendor/preact.ts';

export interface MountedUI {
  /** The node the router appends. */
  readonly element: HTMLElement;
  /**
   * Re-renders the tree with a new "root value".
   *
   * The screen passes the value the whole tree should be a function of —
   * typically its own state bag. Components read from that value, so the class
   * does not need to know which components care about which field.
   */
  update(value: unknown): void;
  unmount(): void;
}

type RenderFn = (value: unknown) => ComponentChildren;

/**
 * Mounts a component tree into a fresh container and hands back the controls.
 *
 * Preact's `render` diffs the *previous* tree against the new one, so calling
 * `update` in a loop is cheap, and calling it from an event handler is safe: the
 * handler belongs to a listener attached to a persistent node, not to a node the
 * diff is about to replace.
 */
export function mountUI(container: HTMLElement, renderTree: RenderFn, initial: unknown): MountedUI {
  let value = initial;
  const draw = (): void => {
    render(renderTree(value), container);
  };
  draw();
  return {
    element: container,
    update(next: unknown) {
      value = next;
      draw();
    },
    unmount() {
      render(null, container);
    },
  };
}
