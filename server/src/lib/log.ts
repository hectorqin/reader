/**
 * A process-wide logger for code that runs outside a request.
 *
 * `FastifyRequest.log` covers everything reached through a route, but the scanner
 * and the format parsers run from a timer with no request to hang a logger off.
 * They were previously silent, which hid a real failure: the EPUB spine reader
 * threw for every book and the `null` it returned is also the legitimate answer
 * for formats that genuinely have no page count, so nothing downstream could
 * tell the two apart.
 *
 * Kept as a module-level singleton rather than threaded through every constructor
 * because the alternative is passing a logger through `HandlerContext` and the
 * scanner into code that has no other use for it. The one global is set at
 * startup and never changes.
 */
export interface Logger {
  warn(context: Record<string, unknown>, message: string): void;
  info(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

const fallback: Logger = {
  warn: (context, message) => console.warn(message, context),
  info: (context, message) => console.info(message, context),
  error: (context, message) => console.error(message, context),
};

let current: Logger = fallback;

export function setLogger(logger: Logger): void {
  current = logger;
}

export const log: Logger = {
  warn: (context, message) => current.warn(context, message),
  info: (context, message) => current.info(context, message),
  error: (context, message) => current.error(context, message),
};
