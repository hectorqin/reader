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

/**
 * A book whose chapters are *documents*, and whose first one carries an image.
 *
 * A second fixture rather than a variant of the TXT one, because the two exercise
 * opposite sides of the same decision — "does this body get parsed" — and the
 * report that produced this scene was exactly the case where they were conflated: a
 * TXT chapter was rendered as one paragraph *and* every illustration in an
 * illustrated EPUB came out as a broken-image placeholder. Both are visible only on
 * a screen, and both need a chapter of a shape the TXT fixture cannot have.
 *
 * The image is served from the book's own asset endpoint and reached through the
 * URL the server actually writes — an absolute one, carrying
 * `__reader-book-resource__` — because that is the URL the client has to accept.
 * A fixture that inlined a `data:` URI would leave the defect reproducible in
 * production and invisible here.
 */
const ILLUSTRATED_ID = 'review-illustrated';

const ILLUSTRATED_CHAPTERS = [
  { title: '第一卷 插图', path: 'OEBPS/Text/ch1.xhtml' },
  { title: '第一卷 后记', path: 'OEBPS/Text/ch2.xhtml' },
];

/** 1×1 is enough: the assertion is that the image *loads*, not how it looks. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFElEQVR42mP8z8DAwMDAwMDAQAcAABkAAe0lQh4AAAAASUVORK5CYII=',
  'base64',
);

/** The two paragraphs of a document chapter, and the image between them. */
function illustratedChapter(index) {
  if (index !== 0) {
    return [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一卷 后记</title></head>',
      '<body><p>后记：这一章没有插图，用来确认上一章的图片不是碰巧出现的。</p></body></html>',
    ].join('\n');
  }
  const image = `/api/v1/books/${ILLUSTRATED_ID}/assets?__reader-book-resource__=1&ref=${encodeURIComponent('OEBPS/Images/pic.png')}`;
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一卷 插图</title></head>',
    '<body>',
    `<div class="pic"><img src="${image}" alt="插图"/></div>`,
    '<p>台版 转自 天使动漫</p>',
    '<p>插图下面还有正文，这样图片没显示出来的时候，空出来的位置也是看得见的。</p>',
    '</body></html>',
  ].join('\n');
}

const CHAPTERS = [
  { title: '第一章 惊蛰', body: ['小镇上的人都知道，泥瓶巷住着一个少年。', '他叫陈平安。'] },
  { title: '第二章 山水', body: ['山上的风很大。', '他站在山顶，看了很久。'] },
  { title: '第三章 落雨', body: ['雨来了。', '他没有打伞，就这么走回去。'] },
];

/**
 * Enough text that the chapter is several screens tall, with a scraper's indentation.
 *
 * The full-width spaces are the point: they are what "段前空格" is, they are what a
 * converted TXT library is full of, and they have to be *gone* from the rendered page
 * — left in, they are indent added on top of the reader's own, and the screenshot is
 * where that is visible. A fixture indented with ordinary spaces would not show it,
 * because the browser collapses those.
 */
const LONG = Array.from({ length: 40 }, (_v, i) =>
  `　　第 ${i + 1} 段。这一段特意写长一些，用来把这一章撑到好几屏，这样翻页和页数才看得出来。`,
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

/**
 * A chapter, in the shape the server actually produces: the characters, as text.
 *
 * This used to answer with a `txt-body` div full of `<p>`s, which is what the server
 * rendered before the typesetting moved to the client. Keeping the fixture on the
 * *new* shape matters more than keeping it on the old one: the review runs against
 * the production bundle, and a fixture that still pre-rendered paragraphs would let
 * a regression in the client's own split render perfectly.
 *
 * The `\u3000` indents in `LONG` are kept deliberately — they are "段前空格", and
 * left in they are indent stacked on the reader's own. The screenshot is where that
 * is visible.
 */
function chapterText(index) {
  return `${CHAPTER_BODY[index]}\n`;
}

/** The illustrated book, with every field `docs/api.md` declares. */
function illustratedBook() {
  return {
    ...book,
    id: ILLUSTRATED_ID,
    title: '第一卷 插图',
    format: 'epub',
    pageCount: ILLUSTRATED_CHAPTERS.length,
  };
}

function illustratedManifest() {
  return {
    id: ILLUSTRATED_ID,
    format: 'epub',
    total: ILLUSTRATED_CHAPTERS.length,
    files: [{ rel_path: '插图.epub', size: 4096, missing: 0 }],
    content: {
      kind: 'reflowable',
      total: ILLUSTRATED_CHAPTERS.length,
      groups: [{ id: 'spine:0', seq: 0, title: '章节', count: ILLUSTRATED_CHAPTERS.length, offset: 0 }],
      items: ILLUSTRATED_CHAPTERS.map((chapter, index) => ({
        id: chapter.path,
        seq: index,
        title: chapter.title,
        kind: 'chapter',
        // A *document*, not characters: the media type is what tells the client to
        // parse this body instead of typesetting it, and it is the field the report
        // was about.
        mediaType: 'application/xhtml+xml',
        href: `xhtml:${chapter.path}`,
      })),
    },
  };
}

function manifest() {
  return {
    id: BOOK_ID,
    format: 'epub',
    total: CHAPTERS.length,
    files: [{ rel_path: '剑来.epub', size: 1024, missing: 0 }],
    content: {
      // Deliberately `reflowable` rather than `text`, and the manifest says `epub`.
      //
      // A TXT *is* reflowable, so a server windowing it that way is making a
      // reasonable choice — and the review found that the client believed the label
      // instead of looking at the chapter it had been sent, leaving the paragraphs
      // unstyled with no indent control beside them. Keeping the fixture on the
      // awkward path is what keeps that fixed.
      kind: 'reflowable',
      total: CHAPTERS.length,
      groups: [{ id: 'chapters', seq: 0, title: '章节', count: CHAPTERS.length, offset: 0 }],
      items: CHAPTERS.map((chapter, index) => ({
        id: `c${index}`,
        seq: index,
        title: chapter.title,
        kind: 'chapter',
        // The TXT manifest as the server actually emits it: plain characters, and
        // `format: 'html'` to say "this is a document to be typeset" rather than
        // "this is markup". The media type and the format field are both asserted
        // here because they are what `renditionRef` keys on — a fixture that omitted
        // them would have the client fetch `chapter:` and render an untitled slab,
        // which is a review of a path no reader is on.
        mediaType: 'text/plain; charset=utf-8',
        href: `chapter:${index}`,
        format: 'html',
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
    // The request log, *counted*, in the names the traffic assertions use.
    //
    // Counting at the HTTP boundary is the only place that sees every request the
    // bundle makes — including the ones a debounce was supposed to fold away — and
    // it is deliberately blind to *why* a request was made. A review of the traffic
    // has to be: the defects it is looking for are a request that was redundant, and
    // no amount of reading the client's intent tells you whether it was sent.
    if (path === '/__counts') {
      const counts = { sync: 0, 'sync-post': 0, 'sync-get': 0, assets: 0, toc: 0 };
      for (const entry of seen) {
        const [method, target = ''] = entry.split(' ');
        const bare = target.split('?')[0] ?? '';
        if (bare === '/api/v1/sync') {
          counts.sync += 1;
          if (method === 'POST') counts['sync-post'] += 1;
          else counts['sync-get'] += 1;
        }
        if (/\/assets$/.test(bare)) counts.assets += 1;
        if (/\/toc$/.test(bare)) counts.toc += 1;
      }
      return json(reply, counts);
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
      return json(reply, { items: [book, illustratedBook()], total: 2, page: 1, pageSize: 50 });
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
    if (path === `/api/v1/books/${ILLUSTRATED_ID}/manifest`) {
      return json(reply, illustratedManifest());
    }
    if (path === `/api/v1/books/${ILLUSTRATED_ID}/toc`) {
      return json(reply, {
        toc: ILLUSTRATED_CHAPTERS.map((chapter, index) => ({
          href: `xhtml:${chapter.path}`,
          title: chapter.title,
          level: 0,
          spine: index,
        })),
      });
    }
    if (path === `/api/v1/books/${ILLUSTRATED_ID}/items`) {
      return json(reply, illustratedManifest().content);
    }
    if (path === `/api/v1/books/${ILLUSTRATED_ID}/assets`) {
      const ref = url.searchParams.get('ref') ?? '';
      if (ref.endsWith('pic.png')) {
        reply.writeHead(200, { 'content-type': 'image/png' });
        return reply.end(PNG);
      }
      const index = ILLUSTRATED_CHAPTERS.findIndex((chapter) => ref === chapter.path);
      reply.writeHead(200, { 'content-type': 'application/xhtml+xml; charset=utf-8' });
      return reply.end(illustratedChapter(index < 0 ? 0 : index));
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
      const body = chapterText(Number.isFinite(index) ? index : 0);
      // `text/plain`, not `text/html`: the server stopped rendering markup, and the
      // content type is part of what the client is being reviewed against.
      reply.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
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

export { CHAPTERS, BOOK_ID, CHAPTER_BODY, chapterText, ILLUSTRATED_ID, ILLUSTRATED_CHAPTERS };
