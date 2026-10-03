import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

/** React roots for engine-owned controls. Application pages use RouterProvider. */
const roots = new WeakMap<Element, Root>();
export function render(value: ReactNode, container: Element): void {
  const existing = roots.get(container);
  if (value === null) {
    if (existing) {
      flushSync(() => existing.unmount());
      roots.delete(container);
    }
    return;
  }
  const root = existing ?? createRoot(container);
  roots.set(container, root);
  flushSync(() => root.render(value));
}
