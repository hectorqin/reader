import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { authenticate, currentUser, requireAdmin } from '../auth.ts';
import { badRequest } from '../../lib/errors.ts';
import { AiService } from '../../services/ai.ts';
import { AiCompanionService, COMPANION_ENTITY_CATEGORIES, type CompanionEntityCategory } from '../../services/ai-companion.ts';
import { BusinessSettingsReader } from '../../services/business-settings.ts';
import { withSignal } from '../request-signal.ts';

export function registerAiRoutes(app: FastifyInstance, ctx: AppContext) {
  const readAi = () => new BusinessSettingsReader(ctx.db).read('ai');
  const service = new AiService(ctx.db, readAi, app.log);
  const companion = new AiCompanionService(ctx, readAi, app.log);
  const auth = authenticate(ctx),
    admin = async (req: any, reply: any) => {
      await auth(req, reply);
      requireAdmin(req);
    };
  app.post<{ Body: { baseUrl?: string; apiKey?: string } }>(
    '/api/v1/admin/ai/models',
    {
      preHandler: admin,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { baseUrl: { type: 'string', maxLength: 4096 }, apiKey: { type: 'string', maxLength: 4096 } },
        },
      },
    },
    async (req) => ({ models: await service.models(req.body?.baseUrl, req.body?.apiKey) }),
  );
  // What a reader may ask for, so the client can leave out a button that would only answer AI_DISABLED.
  app.get('/api/v1/ai/capabilities', { preHandler: auth }, async () => {
    const c = new BusinessSettingsReader(ctx.db).read('ai');
    const configured = !!(c.baseUrl && c.apiKey && c.model);
    return {
      summary: c.enabled && c.summaryEnabled && configured,
      companion: c.enabled && c.summaryEnabled && configured,
      scan: c.enabled && c.scanEnabled && configured,
      assist: c.enabled && c.assistEnabled && configured,
    };
  });
  app.post<{ Body: { bookId: string; chapterId: string; content: string } }>(
    '/api/v1/ai/summary',
    { preHandler: auth },
    async (req) => {
      const body = req.body;
      if (
        !body ||
        typeof body.bookId !== 'string' ||
        typeof body.chapterId !== 'string' ||
        typeof body.content !== 'string'
      )
        throw badRequest('缺少章节内容');
      return service.summary(currentUser(req).id, body.bookId, body.chapterId, body.content);
    },
  );
  // Spoiler-free AI companion: recap + evolving character relationship graph bounded by reading progress.
  app.post<{
    Body: {
      bookId: string;
      sectionIndex?: number;
      window?: number;
      generateRecap?: boolean;
    };
  }>(
    '/api/v1/ai/companion',
    {
      preHandler: auth,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['bookId'],
          properties: {
            bookId: { type: 'string', minLength: 1, maxLength: 200 },
            sectionIndex: { type: 'integer', minimum: 0, maximum: 1_000_000 },
            window: { type: 'integer', minimum: 1, maximum: 20 },
            generateRecap: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      const { bookId, sectionIndex, window, generateRecap } = req.body;
      return withSignal(req, reply, (signal) =>
        companion.companion(
          currentUser(req).id,
          bookId,
          {
            ...(sectionIndex !== undefined ? { sectionIndex } : {}),
            ...(window !== undefined ? { window } : {}),
            ...(generateRecap !== undefined ? { generateRecap } : {}),
          },
          signal,
        ),
      );
    },
  );
  // Instant spoiler-free glossary lookup (characters, items, places, organizations, terms) with zero LLM calls.
  app.get('/api/v1/ai/glossary', { preHandler: auth }, async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const bookId = (query.bookId ?? '').trim();
    if (!bookId || bookId.length > 200) throw badRequest('缺少有效的 bookId');
    const rawCategory = (query.category ?? '').trim();
    if (rawCategory && !(COMPANION_ENTITY_CATEGORIES as readonly string[]).includes(rawCategory)) {
      throw badRequest('无效的词典分类');
    }
    const rawSection = query.sectionIndex;
    const sectionIndex = rawSection !== undefined && rawSection !== '' ? Number.parseInt(rawSection, 10) : undefined;
    if (sectionIndex !== undefined && (!Number.isSafeInteger(sectionIndex) || sectionIndex < 0)) {
      throw badRequest('无效的 sectionIndex');
    }
    return companion.lookupGlossary(currentUser(req).id, bookId, {
      ...(query.q ? { query: query.q } : {}),
      ...(rawCategory ? { category: rawCategory as CompanionEntityCategory } : {}),
      ...(sectionIndex !== undefined ? { sectionIndex } : {}),
    });
  });
  // A question about a passage the reader selected. The lengths are checked again in the service, which words the refusal.
  app.post<{
    Body: {
      bookId: string;
      action: 'translate' | 'explain' | 'ask';
      text: string;
      context?: string;
      question?: string;
      sectionIndex?: number;
    };
  }>(
    '/api/v1/ai/assist',
    {
      preHandler: auth,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['bookId', 'action', 'text'],
          properties: {
            bookId: { type: 'string', minLength: 1, maxLength: 200 },
            action: { type: 'string', enum: ['translate', 'explain', 'ask'] },
            text: { type: 'string', maxLength: 20000 },
            context: { type: 'string', maxLength: 20000 },
            question: { type: 'string', maxLength: 2000 },
            sectionIndex: { type: 'integer', minimum: 0, maximum: 1_000_000 },
          },
        },
      },
    },
    async (req) => {
      const { bookId, sectionIndex, ...input } = req.body;
      let context = input.context ?? '';
      if (sectionIndex !== undefined && input.action !== 'translate') {
        const memory = companion.buildSpoilerFreeMemory(bookId, sectionIndex, input.text);
        if (memory) context = context ? `${memory}\n\n${context}` : memory;
      }
      return service.assist(currentUser(req).id, bookId, { ...input, ...(context ? { context } : {}) });
    },
  );
}
