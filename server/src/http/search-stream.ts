import { Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.ts';
import type { CatalogPage, SearchRequest } from '../sources/types.ts';
import type { SourceHost } from '../services/source-host.ts';

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const connections = new WeakMap<SourceHost, Map<string, AbortController>>();

/** One authenticated POST response carries every result page of a search. */
export function searchResponse(request: FastifyRequest, reply: FastifyReply, host: SourceHost, userId: string, sourceId: string, search: SearchRequest): Readable {
  const controller = new AbortController(), abort = () => controller.abort();
  let active = connections.get(host);
  if (!active) { active = new Map(); connections.set(host, active); }
  const key = JSON.stringify([userId, sourceId, search.sessionId]);
  active.get(key)?.abort(); active.set(key, controller);
  request.raw.once('aborted', abort); reply.raw.once('close', abort);
  async function* events() {
    let cursor = search.cursor, previous: CatalogPage['batch'], complete = false;
    const seen = new Set<string>(), refs = new Set<string>();
    const limit = search.resultLimit ?? 10000;
    try {
      yield ': search connected\n\n';
      do {
        controller.signal.throwIfAborted();
        const key = cursor ?? '';
        if (seen.has(key)) throw new AppError(502, 'INVALID_CURSOR', '来源返回了重复的搜索游标');
        seen.add(key);
        const page = await host.search(userId, sourceId, { ...search, cursor }, controller.signal);
        if (page.batch && previous && (page.batch.total !== previous.total || page.batch.completed < previous.completed)) {
          throw new AppError(502, 'INVALID_PROGRESS', '来源搜索进度异常');
        }
        previous = page.batch;
        const items = page.items.filter(entry => {
          if (refs.has(entry.ref) || refs.size >= limit) return false;
          refs.add(entry.ref); return true;
        });
        const capped = refs.size >= limit;
        const result = { ...page, items, ...(capped ? { nextCursor: undefined, limitReached: true } : {}) };
        yield frame('results', result);
        // Stream ordinary provider pagination as well; the browser receives one
        // continuous result stream regardless of whether the provider is batched.
        cursor = !capped ? page.nextCursor : undefined;
        if (!cursor) { complete = true; yield frame('done', { reason: capped || page.limitReached ? 'limit' : page.nextCursor ? 'page' : 'complete' }); }
      } while (cursor && !controller.signal.aborted);
    } catch (error) {
      if (!controller.signal.aborted) yield frame('error', {
        code: error instanceof AppError ? error.code : 'SEARCH_FAILED',
        message: error instanceof AppError ? error.message : '搜索中断，已保留收到的结果。',
        status: error instanceof AppError ? error.statusCode : 500,
      });
    } finally {
      controller.abort();
      request.raw.removeListener('aborted', abort); reply.raw.removeListener('close', abort);
      if (active!.get(key) === controller) {
        active!.delete(key);
        if (search.sessionId && (!complete || previous)) await host.cancelSearch(userId, sourceId, search.sessionId).catch(error => {
          request.log.warn({ err: error, sourceId }, 'search session cancellation failed');
        });
      }
    }
  }
  return Readable.from(events(), { objectMode: false, highWaterMark: 64 * 1024 });
}
