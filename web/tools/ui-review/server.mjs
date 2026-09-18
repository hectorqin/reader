/**
 * A stand-in server for the UI review.
 *
 * The review has to render the *production bundle* against something that answers
 * its API, because the thing being reviewed is the real screen: a component
 * storybook would show the chrome with hand-fed state, and the two bugs this
 * harness is meant to catch (a panel that covers the page, a footer whose page
 * count disagrees with the presses left) are both about how the screen behaves
 * against a real response.
 *
 * Only the endpoints the reader touches are implemented, and each returns the
 * smallest body the screen will accept. Anything else answers 404 so a missing
 * endpoint fails loudly here rather than looking like a rendering bug.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = join(here, '..', '..', 'dist');

const BOOK_ID = 'review-book';
const TITLE = '剑来';
const AUTHOR = '烽火戏诸侯';

const CHAPTERS = [
  { title: '第一章 惊蛰', body: ['小镇上的人都知道，泥瓶巷住着一个少年。', '他叫陈平安。'] },
  { title: '第二章 山水', body: ['山上的风很大。', '他站在山顶，看了很久。'] },
  { title: '第三章 落雨', body: ['雨来了。', '他没有打伞，就这么走回去。'] },
];

/** Enough text that the chapter is several screens tall. */
const LONG = Array.from({ length: 40 }, (_v, i) =>
  `第 ${i + 1} 段。这一段特意写长一些，用来把这一章撑到好几屏，这样翻页和页数才看得出来。`,
).join('\n\n');

const CHAPTER_BODY = CHAPTERS.map((chapter, index) =>
  index === 0 ? [chapter.title, LONG].join('\n') : [chapter.title, ...chapter.body].join('\n'),
);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const json = (reply, body, status = 200) => {
  const text = JSON.stringify(body);
  reply.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  reply.end(text);
};

const html = (reply, body, status = 200) => {
  reply.writeHead(status, { 'content-type': MIME['.html'], 'content-length': Buffer.byteLength(body) });
  reply.end(body);
};

function session() {
  return {
    user: { id: 'u1', username: 'review', displayName: '评测', role: 'admin', createdAt: 0 },
    accessToken: 'review-token',
    accessTokenExpiresAt: Date.now() + 86_400_000,
    refreshToken: 'review-refresh',
    refreshTokenExpiresAt: Date.now() + 86_400_000,
  };
}

/**
 * A book, with every field `docs/api.md` declares.
 *
 * Written out in full rather than with the three fields that look load-bearing: the
 * client's own types are a contract, and a fixture that satisfies only the parts the
 * shelf happens to read today is a fixture that starts failing the day a column is
 * added — with no change to the code under review, which makes it look like a
 * regression in the review.
 */
const book = {
  id: BOOK_ID,
  title: TITLE,
  author: AUTHOR,
  publisher: '',
  language: 'zh',
  isbn: '',
  description: '',
  series: '',
  seriesIndex: null,
  tags: [],
  pubdate: '',
  format: 'epub',
  coverUrl: null,
  fileSize: 1024,
  pageCount: CHAPTERS.length,
  source: '',
  manualFields: [],
  addedAt: Date.now(),
  updatedAt: Date.now(),
};

/** The reader's own chapter markup, in the shape the server produces. */
function chapterHtml(index) {
  const paragraphs = CHAPTER_BODY[index]
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${block.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`)
    .join('\n');
  return `<div class="txt-body">\n${paragraphs}\n</div>\n`;
}

function manifest() {
  return {
    id: BOOK_ID,
    format: 'epub',
    total: CHAPTERS.length,
    files: [{ rel_path: '剑来.epub', size: 1024, missing: 0 }],
    content: {
      kind: 'reflowable',
      total: CHAPTERS.length,
      groups: [{ id: 'chapters', seq: 0, title: '章节', count: CHAPTERS.length, offset: 0 }],
      items: CHAPTERS.map((chapter, index) => ({
        id: `c${index}`,
        seq: index,
        title: chapter.title,
        kind: 'chapter',
        mediaType: 'application/xhtml+xml',
        href: `chapter:${index}`,
      })),
    },
  };
}

function toc() {
  return CHAPTERS.map((chapter, index) => ({
    href: `chapter:${index}`,
    title: chapter.title,
    level: 0,
    spine: index,
  }));
}

export function createReviewServer({ port = 5199 } = {}) {
  const seen = [];
  const server = createServer((request, reply) => {
    seen.push(`${request.method} ${request.url}`);
    void handle(request, reply);
  });
  server.seen = seen;

  async function handle(request, reply) {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    const path = url.pathname;

    if (path === '/__seen') {
      return json(reply, seen);
    }
    if (path.startsWith('/api/')) {
      return api(request, reply, url);
    }

    // Static bundle. `dist` has to exist: a review that renders last week's build
    // is worse than no review, because it looks like a pass.
    let file = path === '/' ? '/index.html' : path;
    let target = join(dist, file);
    if (!existsSync(target) || path.startsWith('/assets/') === false && !existsSync(target)) {
      target = join(dist, 'index.html');
    }
    if (!existsSync(target)) {
      reply.writeHead(404);
      reply.end('run `npm run build` first');
      return;
    }
    const bytes = await readFile(target);
    reply.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
    reply.end(bytes);
  }

  function api(request, reply, url) {
    const path = url.pathname;

    if (path === '/api/v1/instance') {
      return json(reply, { name: 'reader', apiVersion: 1, registrationOpen: false, userCount: 1 });
    }
    if (path === '/api/v1/auth/session') {
      // No session on the boot request, so the app shows its login screen — then
      // the driver logs in, which is what a real reader does too.
      return json(reply, null);
    }
    if (path === '/api/v1/auth/login') {
      return json(reply, session());
    }
    if (path === '/api/v1/auth/refresh') {
      return json(reply, session());
    }
    // Called on boot with a restored session, and the app refuses to enter with a
    // token the server will not confirm. Missing it made every scene after the first
    // land on the login screen again.
    if (path === '/api/v1/auth/me') {
      return json(reply, { user: session().user });
    }
    if (path === '/api/v1/books') {
      return json(reply, { items: [book], total: 1, page: 1, pageSize: 50 });
    }
    // The shelf asks for its "continue reading" strip in the same breath as the
    // list, and a 404 there makes the shelf render an empty state that looks like a
    // missing library rather than a missing endpoint.
    if (path === '/api/v1/library/continue') {
      // A `ContinueReadingItem` *is* a `Book` with the progress flattened onto it,
      // not a book-with-progress pair — see `ContinueReadingItem` in the client's
      // types. Reading the server contract wrong here is what made this fixture
      // crash the shelf's continue card, which is a useful thing for a review
      // harness to be able to do.
      return json(reply, {
        items: [{ ...book, percentage: 0.18, chapterTitle: CHAPTERS[1].title, lastReadAt: Date.now() }],
      });
    }
    if (path === `/api/v1/books/${BOOK_ID}/manifest`) {
      return json(reply, manifest());
    }
    if (path === `/api/v1/books/${BOOK_ID}/toc`) {
      // `{ toc: [...] }`, matching `docs/api.md`. A bare array here is the mistake
      // the reader is not allowed to make: it is what made the harness discover that
      // `openStaged` crashed on an unexpected response shape instead of falling back
      // to the manifest's own items.
      return json(reply, { toc: toc() });
    }
    if (path === `/api/v1/books/${BOOK_ID}/items`) {
      return json(reply, manifest().content);
    }
    if (path === `/api/v1/books/${BOOK_ID}/assets`) {
      const ref = url.searchParams.get('ref') ?? '';
      const index = Number.parseInt(ref.replace(/^chapter(-html)?:/, ''), 10);
      const body = chapterHtml(Number.isFinite(index) ? index : 0);
      reply.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return reply.end(body);
    }
    if (path === `/api/v1/books/${BOOK_ID}/progress`) {
      return json(reply, null);
    }
    // A pull is a GET on `/sync`; a push is a POST on the same path. Both have to
    // answer, or the sync engine retries into the review's screenshots.
    if (path === '/api/v1/sync') {
      if (request.method === 'POST') {
        return json(reply, { accepted: 0, rejected: 0, serverTime: Date.now(), progress: [], notes: [] });
      }
      return json(reply, { serverTime: Date.now(), progress: [], notes: [] });
    }
    if (path.startsWith('/api/v1/sync/progress/')) {
      // `{ progress: null }`, which is what the endpoint answers for a book nobody
      // has read. Returning a bare `null` makes the client dereference `undefined`
      // and the reader reports a crash it cannot explain.
      return json(reply, { progress: null });
    }
    if (path === '/api/v1/tts/capabilities') {
      return json(reply, { http: false, system: true });
    }
    return json(reply, { error: { code: 'NOT_FOUND', message: `no review handler for ${path}` } }, 404);
  }

  return {
    server,
    seen,
    listen: () => new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${port}`))),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export { CHAPTERS, BOOK_ID, CHAPTER_BODY, chapterHtml };
