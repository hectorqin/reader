/**
 * A tiny typed emitter.
 *
 * The reader emits state (chapter changed, page turned, position updated) and
 * the UI subscribes. A framework's reactive layer would do the same job, but the
 * reader's state changes faster than its DOM should: a page turn must not
 * re-render the chapter, so the two are kept explicitly apart.
 */
export type Listener<T> = (value: T) => void;

export class Emitter<T> {
  private listeners = new Set<Listener<T>>();

  on(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) listener(value);
  }

  clear(): void {
    this.listeners.clear();
  }
}
