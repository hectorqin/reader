import type { FastifyReply, FastifyRequest } from 'fastify';

/** Cancels source work when the requesting client leaves. */
export async function withSignal<T>(request: FastifyRequest, reply: FastifyReply, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.raw.once('aborted', abort);
  reply.raw.once('close', abort);
  try { return await action(controller.signal); }
  finally { request.raw.removeListener('aborted', abort); reply.raw.removeListener('close', abort); }
}
