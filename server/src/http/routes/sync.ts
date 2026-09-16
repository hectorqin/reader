import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { authenticate, currentUser } from '../auth.ts';
import { badRequest } from '../../lib/errors.ts';
import type { NoteRecord, ProgressRecord } from '../../services/sync.ts';

export function registerSyncRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = authenticate(ctx);

  /**
   * Catch-up pull. A client that has been offline passes the last `serverTime`
   * it saw and receives only the deltas, which keeps reconnect cheap on mobile
   * networks (§4, 三态切换).
   */
  app.get('/api/v1/sync', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    const q = request.query as { since?: string; bookId?: string };
    const since = q.since ? Number.parseInt(q.since, 10) : 0;
    if (!Number.isFinite(since) || since < 0) throw badRequest('since must be a non-negative integer');
    return ctx.sync.pull(user.id, since, q.bookId);
  });

  /**
   * Offline merge. Batches are applied in one transaction so a dropped
   * connection can never leave progress half written.
   */
  app.post('/api/v1/sync', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    const body = (request.body ?? {}) as { progress?: unknown; notes?: unknown };
    // Validate the shape explicitly. Iterating a non-array would otherwise walk
    // a string character by character and report nonsense rejections.
    if (body.progress !== undefined && !Array.isArray(body.progress)) {
      throw badRequest('progress must be an array', 'BAD_PAYLOAD');
    }
    if (body.notes !== undefined && !Array.isArray(body.notes)) {
      throw badRequest('notes must be an array', 'BAD_PAYLOAD');
    }
    const progress = (body.progress ?? []) as ProgressRecord[];
    const notes = (body.notes ?? []) as NoteRecord[];
    if (progress.length === 0 && notes.length === 0) {
      throw badRequest('at least one of progress or notes is required', 'BAD_PAYLOAD');
    }
    if (progress.length + notes.length > 5000) {
      throw badRequest('batch too large, split into chunks of 5000', 'BATCH_TOO_LARGE');
    }
    const result = ctx.sync.push(user.id, { progress, notes });
    // Returning the merged state lets the client reconcile in the same round
    // trip instead of issuing a follow-up pull.
    return { ...result, ...ctx.sync.pull(user.id, 0, undefined), accepted: result.accepted, rejected: result.rejected };
  });

  app.get('/api/v1/sync/progress/:bookId', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    const { bookId } = request.params as { bookId: string };
    return { progress: ctx.sync.progressFor(user.id, bookId) };
  });

  app.put('/api/v1/sync/progress/:bookId', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    const { bookId } = request.params as { bookId: string };
    const body = (request.body ?? {}) as Partial<ProgressRecord>;
    ctx.sync.push(user.id, {
      progress: [{
        bookId,
        locator: body.locator ?? '',
        percentage: typeof body.percentage === 'number' ? body.percentage : 0,
        chapterTitle: body.chapterTitle ?? '',
        device: body.device ?? '',
        updatedAt: body.updatedAt ?? Date.now(),
      }],
    });
    return { progress: ctx.sync.progressFor(user.id, bookId) };
  });

  app.get('/api/v1/notes', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    const q = request.query as { bookId?: string; since?: string };
    const since = q.since ? Number.parseInt(q.since, 10) : 0;
    const pulled = ctx.sync.pull(user.id, since, q.bookId);
    return { notes: pulled.notes.filter((n) => !n.deleted), serverTime: pulled.serverTime };
  });

  app.post('/api/v1/notes', { preHandler: auth }, async (request, reply) => {
    const user = currentUser(request);
    const body = (request.body ?? {}) as Partial<NoteRecord>;
    if (!body.bookId) throw badRequest('bookId is required');
    const note: NoteRecord = {
      id: body.id ?? crypto.randomUUID(),
      bookId: body.bookId,
      type: body.type ?? 'note',
      locator: body.locator ?? '',
      text: body.text ?? '',
      comment: body.comment ?? '',
      color: body.color ?? '',
      updatedAt: body.updatedAt ?? Date.now(),
      deleted: false,
    };
    ctx.sync.push(user.id, { notes: [note] });
    reply.status(201);
    return { note };
  });

  /** Deletion is a tombstone so an offline device cannot resurrect the note. */
  app.delete('/api/v1/notes/:id', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    const { id } = request.params as { id: string };
    const existing = ctx.db.get<{ book_id: string; type: string; locator: string; text: string; comment: string; color: string }>(
      'SELECT book_id, type, locator, text, comment, color FROM notes WHERE id = ? AND user_id = ?', id, user.id,
    );
    if (!existing) return { ok: true };
    ctx.sync.push(user.id, {
      notes: [{
        id,
        bookId: existing.book_id,
        type: existing.type as NoteRecord['type'],
        locator: existing.locator,
        text: existing.text,
        comment: existing.comment,
        color: existing.color,
        updatedAt: Date.now(),
        deleted: true,
      }],
    });
    return { ok: true };
  });

  app.get('/api/v1/library/continue', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    const q = request.query as { limit?: string };
    const limit = q.limit ? Math.min(100, Number.parseInt(q.limit, 10) || 20) : 20;
    return { items: ctx.sync.recentlyRead(user.id, limit) };
  });
}
