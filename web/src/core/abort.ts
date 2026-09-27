/** Compose cancellation without AbortSignal.any, which older Android browsers lack.
 * Call dispose when the operation settles to release listeners on long-lived signals.
 */
export function combineAbortSignals(signals: readonly AbortSignal[]): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();
  const dispose = () => {
    for (const [signal, listener] of listeners) signal.removeEventListener('abort', listener);
    listeners.clear();
  };
  for (const signal of new Set(signals)) {
    const abort = () => { controller.abort(signal.reason); dispose(); };
    if (signal.aborted) { abort(); break; }
    listeners.set(signal, abort);
    signal.addEventListener('abort', abort, { once: true });
  }
  return { signal: controller.signal, dispose };
}
