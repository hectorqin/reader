import { ApiError } from './errors.ts';

/** Decode SSE across arbitrary byte boundaries, including split UTF-8 and CRLF. */
export async function* eventStream(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '', event = '', data: string[] = [], size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const chunk = await reader.read(); signal?.throwIfAborted();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let end;
      while ((end = buffer.search(/[\r\n]/)) !== -1) {
        if (buffer[end] === '\r' && end === buffer.length - 1 && !chunk.done) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + (buffer.slice(end, end + 2) === '\r\n' ? 2 : 1));
        size += line.length;
        if (size > 2 * 1024 * 1024) throw new ApiError('server', '搜索事件过大', 'INVALID_STREAM');
        if (!line) {
          if (data.length) yield { event: event || 'message', data: data.join('\n') };
          event = ''; data = []; size = 0;
        } else if (!line.startsWith(':')) {
          const colon = line.indexOf(':'), field = colon < 0 ? line : line.slice(0, colon);
          const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
          if (field === 'event') event = value;
          if (field === 'data') data.push(value);
        }
      }
      if (buffer.length + size > 2 * 1024 * 1024) throw new ApiError('server', '搜索事件过大', 'INVALID_STREAM');
      if (chunk.done) break;
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {}); reader.releaseLock();
  }
}
