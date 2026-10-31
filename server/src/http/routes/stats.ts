import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { authenticate, currentUser, requireAdmin } from '../auth.ts';
import { TimeStatsService, type ReadingTimeEntry, type StatsQuery } from '../../services/time-stats.ts';

/**
 * 时长统计, the reading half. The media half lives with the media routes
 * (`/api/v1/media/stats/*`) because it is answered from media.db, which may still
 * be starting while this side already serves.
 */
export function registerStatsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = authenticate(ctx);
  // Built on first use, not here: main.ts registers routes before it creates the
  // services (ctx.shelf is still undefined at this point), as every route that reads
  // ctx.* per request already assumes.
  let service: TimeStatsService | undefined;
  const stats = (): TimeStatsService => (service ??= new TimeStatsService(ctx.db, ctx.shelf));

  app.post('/api/v1/stats/reading-time', { preHandler: auth }, async (request) => {
    const body = (request.body ?? {}) as { clientId?: string; entries?: ReadingTimeEntry[] };
    return stats().record(currentUser(request).id, body.clientId ?? '', body.entries ?? []);
  });

  app.get('/api/v1/stats/reading', { preHandler: auth }, async (request) => {
    return stats().summary(currentUser(request).id, request.query as StatsQuery);
  });

  app.get('/api/v1/stats/reading/users', { preHandler: auth }, async (request) => {
    requireAdmin(request);
    return { users: stats().users(request.query as StatsQuery) };
  });
}
