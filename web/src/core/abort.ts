import { ApiError } from '../api/errors.ts';

/**
 * True for the failures cancellation produces: a DOMException or Error named
 * `AbortError` (fetch, body reads, media/stream APIs) — including the reason an
 * `AbortController.abort()` without arguments leaves on its signal ("signal is
 * aborted without reason").
 */
export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

/** The one shape cancellation takes once it leaves the transport. */
export function abortedError(message = 'request aborted'): ApiError {
  return new ApiError('aborted', message);
}

/**
 * Map a failure seen while `signal` was in use to ApiError('aborted') when it is
 * a cancellation, or null when it is a real failure. A signal aborted with a
 * custom reason rejects fetch with that reason rather than an AbortError, so the
 * signal's own state decides. A timeout signal is a connectivity failure.
 */
export function abortFailure(error: unknown, signal?: AbortSignal): ApiError | null {
  if (error instanceof ApiError) return error.kind === 'aborted' ? error : null;
  const reason: unknown = signal?.aborted ? signal.reason : undefined;
  if (typeof reason === 'object' && reason !== null && (reason as { name?: unknown }).name === 'TimeoutError') {
    return new ApiError('offline', 'request timed out', 'TIMEOUT');
  }
  return signal?.aborted || isAbortError(error) ? abortedError() : null;
}

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
