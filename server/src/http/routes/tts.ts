import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { authenticate } from '../auth.ts';
import { badRequest } from '../../lib/errors.ts';

/**
 * Speech synthesis over HTTP.
 *
 * Two routes, and the split between them is the whole design:
 *
 *  - `GET /api/v1/tts/voices` is the *capability* answer. A client asks it once
 *    when the reader opens the朗读 settings, and uses the reply to decide which
 *    engines to offer. An instance with no `TTS_URL` answers `{ http: false }`
 *    rather than 404, because the client's question is "what can I use here",
 *    not "does this endpoint exist".
 *  - `GET /api/v1/tts` is the *audio* answer, one utterance at a time.
 *
 * One utterance per request, not one chapter, and that is not an accident: the
 * client already speaks sentence by sentence (see `web/src/render/tts.ts` for
 * why), and a per-request boundary is what makes pause, resume, next-sentence
 * and rate changes work against a remote engine at all. It also bounds the
 * response to something a phone can buffer while walking, and lets the server
 * cache per sentence instead of per book.
 *
 * The access token travels in the query string on this route, like `/assets` and
 * `/cover`. An `<audio src>` cannot carry an `Authorization` header, and a fetch
 * + Blob URL would defeat the browser's own media buffering — which is the one
 * thing an audio element is genuinely better at than any hand-rolled player.
 */
export function registerTtsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = authenticate(ctx);

  app.get('/api/v1/tts/voices', { preHandler: auth }, async () => {
    const capabilities = ctx.tts.capabilities();
    if (!ctx.tts.enabled) return capabilities;
    return { ...capabilities, voices: await ctx.tts.voices() };
  });

  app.post('/api/v1/tts/test', { preHandler: auth }, async request => {
    const input = request.body as { voice?: unknown; speed?: unknown } | null;
    if (input?.voice !== undefined && typeof input.voice !== 'string') throw badRequest('voice must be a string');
    if (input?.speed !== undefined && (typeof input.speed !== 'number' || !Number.isFinite(input.speed))) throw badRequest('speed must be a number');
    const started = Date.now();
    const audio = await ctx.tts.synthesize({ text: '这是阅读器朗读试听。愿你享受阅读的时光。',
      ...(typeof input?.voice === 'string' ? { voice: input.voice } : {}),
      ...(typeof input?.speed === 'number' ? { speed: input.speed } : {}),
    });
    return { bytes: audio.bytes.length, contentType: audio.contentType, elapsedMs: Date.now() - started, cached: audio.cached };
  });

  app.get('/api/v1/tts', { preHandler: auth }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const text = query.text ?? '';
    if (!text.trim()) throw badRequest('text is required');
    const speed = query.speed !== undefined ? Number.parseFloat(query.speed) : undefined;
    if (speed !== undefined && !Number.isFinite(speed)) throw badRequest('speed must be a number');

    const audio = await ctx.tts.synthesize({
      text,
      ...(query.voice ? { voice: query.voice } : {}),
      ...(speed !== undefined ? { speed } : {}),
      ...(query.format ? { format: query.format } : {}),
    });

    reply.header('content-type', audio.contentType);
    reply.header('content-length', String(audio.bytes.byteLength));
    // Immutable per (text, voice, speed): the same sentence will always be the
    // same audio, so a second play of it should not reach the server at all.
    reply.header('cache-control', 'private, max-age=604800, immutable');
    reply.header('x-tts-cache', audio.cached ? 'hit' : 'miss');
    return reply.send(Buffer.from(audio.bytes));
  });
}
