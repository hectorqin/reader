import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.ts';

/**
 * Single error serialiser. Responses intentionally keep the same shape across
 * every endpoint so old clients keep working as the API grows (§8.3).
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
      return;
    }
    const fastifyError = error as { statusCode?: number; message?: string };
    const status = fastifyError.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'unhandled error');
      reply.status(status).send({ error: { code: 'INTERNAL', message: 'internal server error' } });
      return;
    }
    // Validation and content-type failures land here; they are the client's
    // fault, so the message is passed through verbatim.
    reply.status(status).send({
      error: { code: 'BAD_REQUEST', message: fastifyError.message || 'bad request' },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `no route for ${request.method} ${request.url}` },
    });
  });
}
