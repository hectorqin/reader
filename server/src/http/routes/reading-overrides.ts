import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { authenticate, currentUser } from '../auth.ts';
import { ReadingOverrideService, type ReadingOverrides } from '../../services/reading-overrides.ts';
import { badRequest } from '../../lib/errors.ts';
export function registerReadingOverrideRoutes(app: FastifyInstance, ctx: AppContext): void {
  const service = new ReadingOverrideService(ctx.db), auth = authenticate(ctx);
  const access = (request: Parameters<ReturnType<typeof authenticate>>[0]) => {
    const user = currentUser(request), { id } = request.params as { id: string };
    ctx.shelf.get(user.id,id); return { userId:user.id,bookId:id };
  };
  app.get('/api/v1/books/:id/reading-overrides',{preHandler:auth},async request => { const {userId,bookId}=access(request); return service.get(userId,bookId); });
  app.put('/api/v1/books/:id/reading-overrides',{preHandler:auth},async request => { const {userId,bookId}=access(request); return service.save(userId,bookId,request.body as ReadingOverrides); });
  app.post('/api/v1/books/:id/reading-overrides/undo',{preHandler:auth},async request => {
    const {userId,bookId}=access(request); const version = (request.body as {version?:number}|null)?.version;
    if (!Number.isSafeInteger(version) || !version || version < 1) throw badRequest('invalid version');
    return service.undo(userId,bookId,version);
  });
}
