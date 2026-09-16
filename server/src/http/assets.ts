import type { FastifyReply, FastifyRequest } from 'fastify';
import { Transform, type Readable } from 'node:stream';
import { badRequest } from '../lib/errors.ts';
import type { AssetPayload } from '../indexer/formats/index.ts';

/**
 * Response plumbing for book resources.
 *
 * Everything a client reads — a chapter document, a comic page, a PDF, a resized
 * cover — goes through here, and it all goes through here for one reason: the
 * bytes are the user's, not ours. A 400MB comic volume or a scanned PDF must not
 * be buffered in the process just because the response was convenient to build
 * that way.
 *
 * Three behaviours that were easy to get wrong and are now in one place:
 *
 *  1. **Streams are piped, not collected.** `reply.send(stream)` on a Readable
 *     works, but the resource has to be released when the client disconnects —
 *     a phone that goes out of range mid-page must not leave a file handle and
 *     an inflate stream alive until the process restarts.
 *  2. **Range is honoured when the payload is seekable.** "Jump to page 180" of
 *     a comic and "jump to page 300" of a PDF are the two places a reader feels
 *     a server's latency most, and both are pure waste without Range.
 *  3. **Size is set when known.** A progress bar without a length is guesswork,
 *     and a chunked response cannot be resumed.
 */

/** Cap on how much of a book body one response may serve as a range. */
const DEFAULT_CHUNK = 2 * 1024 * 1024;

/**
 * Maximum length of a range whose bytes are held in memory before being sent.
 *
 * A suffix range (`bytes=-500`) needs the file's *tail*, which a forward-only
 * stream cannot produce by skipping, so that one case falls back to reading the
 * bytes. The bound exists because "read the last 4GB" is a request anyone can
 * make and nobody wants to serve.
 */
const MAX_SUFFIX_RANGE = 8 * 1024 * 1024;

const RANGE_RE = /^bytes=(\d*)-(\d*)$/;

interface Range {
  start: number;
  end: number;
  /**
   * True when the client asked for a trailing window (`bytes=-500`).
   *
   * Worth carrying out of the parser: a suffix range is the only one that cannot
   * be produced by skipping forward in a stream, so the sender has to decide
   * between reading the file and declaring that it cannot.
   */
  suffix?: boolean;
}

/**
 * Parse a single-range `Range` header against a known total length.
 *
 * Returns `null` for a malformed header (the caller answers 200 with the whole
 * body, which is what the spec asks for) and `'unsatisfiable'` when the range is
 * syntactically fine but points past the end (the caller answers 416).
 */
export function parseRange(header: string | undefined, total: number): Range | null | 'unsatisfiable' {
  if (!header) return null;
  const match = RANGE_RE.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  let start: number;
  let end: number;
  if (!rawStart) {
    // `bytes=-500` means the LAST 500 bytes, not bytes 0..500. Getting this
    // backwards makes a resumable download restart from the beginning, which is
    // the one case the header exists for.
    const suffix = Number.parseInt(rawEnd ?? '', 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable';
    start = Math.max(0, total - suffix);
    end = total - 1;
    return { start, end, suffix: true };
  } else {
    start = Number.parseInt(rawStart, 10);
    end = !rawEnd ? Math.min(total - 1, start + DEFAULT_CHUNK - 1) : Number.parseInt(rawEnd, 10);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
    return 'unsatisfiable';
  }
  return { start, end: Math.min(end, total - 1) };
}

/**
 * Send an asset payload, streaming when the handler produced one.
 *
 * Cache headers are set from the book's identity rather than the file's mtime:
 * a book id is derived from content, so the bytes behind a URL can never change
 * and the client can keep them forever.
 */
export async function sendAssetPayload(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: AssetPayload,
  options: { notModifiedOn?: number | undefined } = {},
): Promise<FastifyReply> {
  reply.header('content-type', payload.contentType);
  reply.header('cache-control', 'private, max-age=31536000, immutable');
  if (payload.etag) reply.header('etag', `"${payload.etag}"`);
  if (payload.lastModified) reply.header('last-modified', new Date(payload.lastModified).toUTCString());
  if (payload.filename) {
    reply.header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(payload.filename)}`);
  }

  if (options.notModifiedOn && payload.lastModified && payload.lastModified <= options.notModifiedOn) {
    return reply.status(304).send();
  }

  // Buffered payloads: small and already parsed, no range semantics to offer.
  if (payload.data) {
    reply.header('content-length', String(payload.data.byteLength));
    return reply.send(payload.data);
  }

  const stream = payload.stream;
  if (!stream) throw badRequest('asset payload has neither data nor stream', 'EMPTY_ASSET');
  return sendStream(request, reply, stream, payload);
}

function sendStream(
  request: FastifyRequest,
  reply: FastifyReply,
  stream: Readable,
  payload: AssetPayload,
): FastifyReply {
  const total = payload.size;
  const range = payload.seekable && total !== undefined ? parseRange(request.headers.range, total) : null;

  if (range === 'unsatisfiable') {
    reply.header('content-range', `bytes */${total}`);
    void stream.destroy();
    return reply.status(416).send();
  }

  if (!range) {
    reply.header('accept-ranges', payload.seekable ? 'bytes' : 'none');
    if (total !== undefined) reply.header('content-length', String(total));
    return sendWithRelease(request, reply, stream);
  }

  // A ranged request is served by dropping the prefix off the stream. The
  // handlers hand us a stream positioned at byte 0 (a fresh file read), so
  // seeking would mean re-opening the container and paying for a second parse
  // of a comic archive just to serve one page.
  const length = range.end - range.start + 1;
  reply.status(206);
  reply.header('accept-ranges', 'bytes');
  reply.header('content-range', `bytes ${range.start}-${range.end}/${total}`);
  reply.header('content-length', String(length));

  // A *suffix* range is the one that cannot be produced by skipping. The stream
  // is forward-only, and `start` is `total - suffix`, so surviving it means
  // walking the whole file: for a 400MB comic that is the entire download, held
  // open, for the two bytes of the ZIP end-of-central-directory record the
  // client actually wants. Saying `none` is the honest answer there — the
  // client's fallback is a full download it can plan for, rather than one it
  // discovers halfway through.
  if (range.suffix && length > MAX_SUFFIX_RANGE) {
    reply.removeHeader('accept-ranges');
    reply.header('accept-ranges', 'none');
    reply.removeHeader('content-length');
    reply.removeHeader('content-range');
    void stream.destroy();
    return reply.status(200).send(payload.stream ?? stream);
  }

  return sendWithRelease(request, reply, stream, { skip: range.start, take: length });
}

/** Send a stream, releasing it when the client goes away. */
function sendWithRelease(
  request: FastifyRequest,
  reply: FastifyReply,
  stream: Readable,
  window?: { skip: number; take: number },
): FastifyReply {
  const release = (): void => {
    if (!stream.destroyed) stream.destroy();
  };
  // Both events matter: `close` fires for a clean end, `aborted` for a client
  // that hung up. Listening to only one leaks in the other case, and the leak is
  // a file handle plus an inflate stream per abandoned page turn.
  request.raw.on('close', release);
  request.raw.on('aborted', release);
  reply.raw.on('close', () => {
    if (!reply.raw.writableEnded) release();
  });

  if (!window) return reply.send(stream);
  return reply.send(sliceStream(stream, window));
}

/**
 * A pass-through that emits a byte window of another stream.
 *
 * Built as a transform rather than by listening for `data` on the source and
 * pushing manually: a manual reader has to re-emit through the readable side of
 * the same object, which is easy to get wrong (and was: the first version
 * re-pushed chunks that had already been pushed, so a `bytes=0-3` request
 * returned the entire file). A dedicated transform has one producer and one
 * consumer.
 */
function sliceStream(source: Readable, window: { skip: number; take: number }): Readable {
  let skipped = 0;
  let remaining = window.take;
  return source.pipe(
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        if (remaining <= 0) {
          callback();
          return;
        }
        let data = chunk;
        if (skipped < window.skip) {
          const drop = Math.min(window.skip - skipped, data.byteLength);
          skipped += drop;
          data = data.subarray(drop);
        }
        if (data.byteLength === 0) {
          callback();
          return;
        }
        if (data.byteLength > remaining) {
          const keep = data.subarray(0, remaining);
          remaining = 0;
          this.push(keep);
          // Ending the transform closes the response at the requested length and
          // releases the source, instead of reading the rest of a 400MB volume
          // for bytes nobody asked for.
          callback(null);
          this.push(null);
          return;
        }
        remaining -= data.byteLength;
        this.push(data);
        callback();
      },
    }),
  );
}
