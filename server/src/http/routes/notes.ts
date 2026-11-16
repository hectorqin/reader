import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { authenticate, currentUser } from '../auth.ts';
import { NotesLibraryService, type NotesExportQuery, type NotesFilter, type NotesListQuery } from '../../services/notes-library.ts';
import { BookReviewService } from '../../services/book-reviews.ts';

/**
 * 读书笔记 across books: the list, the books it spans, and the export.
 *
 * The list is read-only: creating, editing and deleting a note stay on the sync
 * routes (`/api/v1/sync`, `/api/v1/notes`), the one write path notes have. A 书评
 * is the exception — it is not a note, and is read and saved here.
 */
export function registerNotesRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = authenticate(ctx);
  // Built on first use: main.ts registers routes before it creates ctx.shelf.
  let service: NotesLibraryService | undefined;
  const notes = (): NotesLibraryService => (service ??= new NotesLibraryService(ctx.db, ctx.shelf));

  app.get('/api/v1/notes/library', { preHandler: auth }, async (request) => {
    return notes().list(currentUser(request).id, request.query as NotesListQuery);
  });

  app.get('/api/v1/notes/library/books', { preHandler: auth }, async (request) => {
    return { books: notes().books(currentUser(request).id, request.query as NotesFilter) };
  });

  app.get('/api/v1/notes/library/tags', { preHandler: auth }, async (request) => {
    return { tags: notes().tags(currentUser(request).id) };
  });

  const reviews = new BookReviewService(ctx.db);
  app.get('/api/v1/notes/reviews/:bookId', { preHandler: auth }, async (request) => {
    return { review: reviews.get(currentUser(request).id, (request.params as { bookId: string }).bookId) };
  });

  // An empty body removes the review.
  app.put('/api/v1/notes/reviews/:bookId', { preHandler: auth }, async (request) => {
    const body = (request.body ?? {}) as { body?: unknown };
    return { review: reviews.save(currentUser(request).id, (request.params as { bookId: string }).bookId, body.body) };
  });

  // The document comes back as JSON text, not a download: the Android shell's WebView
  // has no download handling, so the client decides between saving and copying.
  app.get('/api/v1/notes/export', { preHandler: auth }, async (request) => {
    return notes().export(currentUser(request).id, request.query as NotesExportQuery);
  });
}
