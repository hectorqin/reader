import { Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.ts';
import type { CatalogPage, SearchRequest } from '../sources/types.ts';
import type { SourceHost } from '../services/source-host.ts';

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
interface Connection { controller: AbortController; closed: Promise<void> }
const connections = new WeakMap<SourceHost, Map<string, Connection>>();

/** One authenticated POST response carries every result page of a search. */
export function searchResponse(request: FastifyRequest, reply: FastifyReply, host: SourceHost, userId: string, sourceId: string, search: SearchRequest, next?: (cursor: string | undefined, signal: AbortSignal) => Promise<CatalogPage>): Readable {
  const startedAt = Date.now();
  let reason = 'running', lastEventAt = startedAt, pages = 0, resultCount = 0;
  const controller = new AbortController();
  const abort = () => { if (reason === 'running') reason = 'connection_closed'; controller.abort(); };
  const aborted = () => { if (reason === 'running') reason = 'request_aborted'; controller.abort(); };
  let active = connections.get(host);
  if (!active) { active = new Map(); connections.set(host, active); }
  const key = JSON.stringify([userId, sourceId, search.sessionId]);
  const previousConnection = active.get(key);
  previousConnection?.controller.abort();
  let release!: () => void;
  const connection = { controller, closed: new Promise<void>(resolve => { release = resolve; }) };
  active.set(key, connection);
  request.raw.once('aborted', aborted); reply.raw.once('close', abort);
  request.log.info({ sourceId, sessionId: search.sessionId }, 'search stream started');
  async function* events() {
    let cursor = search.cursor, previous: CatalogPage['batch'], complete = false;
    const seen = new Set<string>(), refs = new Set<string>();
    const limit = search.resultLimit ?? 10000;
    try {
      yield ': search connected\n\n';
      // A resumed stream must not race the previous connection's session stop.
      await previousConnection?.closed;
      do {
        controller.signal.throwIfAborted();
        const key = cursor ?? '';
        if (seen.has(key)) throw new AppError(502, 'INVALID_CURSOR', '来源返回了重复的搜索游标');
        seen.add(key);
        const page = await (next ? next(cursor, controller.signal) : host.search(userId, sourceId, { ...search, cursor }, controller.signal));
        controller.signal.throwIfAborted();
        if (page.batch && previous && (page.batch.total !== previous.total || page.batch.completed < previous.completed)) {
          throw new AppError(502, 'INVALID_PROGRESS', '来源搜索进度异常');
        }
        previous = page.batch;
        const items = page.items.filter(entry => {
          if (refs.has(entry.ref) || refs.size >= limit) return false;
          refs.add(entry.ref); return true;
        });
        const capped = refs.size >= limit;
        pages++; resultCount = refs.size; lastEventAt = Date.now();
        const result = { ...page, items, ...(capped ? { nextCursor: undefined, limitReached: true } : {}) };
        yield frame('results', result);
        // Stream ordinary provider pagination as well; the browser receives one
        // continuous result stream regardless of whether the provider is batched.
        cursor = !capped ? page.nextCursor : undefined;
        if (!cursor) { complete = true; reason = capped || page.limitReached ? 'limit' : 'complete'; yield frame('done', { reason }); }
      } while (cursor && !controller.signal.aborted);
    } catch (error) {
      if (!controller.signal.aborted) {
        reason = 'provider_error';
        request.log.warn({ sourceId, sessionId: search.sessionId, code: error instanceof AppError ? error.code : 'SEARCH_FAILED', elapsedMs: Date.now() - startedAt }, 'search stream provider failed');
      }
      if (!controller.signal.aborted) yield frame('error', {
        code: error instanceof AppError ? error.code : 'SEARCH_FAILED',
        message: error instanceof AppError ? error.message : '搜索中断，已保留收到的结果。',
        status: error instanceof AppError ? error.statusCode : 500,
      });
    } finally {
      if (reason === 'running') reason = controller.signal.aborted ? 'superseded' : 'consumer_closed';
      controller.abort();
      request.raw.removeListener('aborted', aborted); reply.raw.removeListener('close', abort);
      const cleanupAt = Date.now();
      const context = { sourceId, sessionId: search.sessionId, reason, complete, pages, resultCount, progress: previous,
        elapsedMs: cleanupAt - startedAt, sinceLastEventMs: cleanupAt - lastEventAt };
      request.log.info(context, 'search stream ended');
      try {
        await previousConnection?.closed;
        if (search.sessionId && (!complete || previous)) await host.cancelSearch(userId, sourceId, search.sessionId).catch(error => {
          request.log.warn({ ...context, err: error, cleanupMs: Date.now() - cleanupAt }, 'search session cancellation failed');
        });
      } finally {
        if (active!.get(key) === connection) active!.delete(key);
        release();
      }
    }
  }
  return Readable.from(events(), { objectMode: false, highWaterMark: 64 * 1024 });
}
