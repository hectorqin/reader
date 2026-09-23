// @vitest-environment jsdom
import { noticeText } from './helpers/notices.ts';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ReaderApi } from '../src/api/client.ts';
import { ApiError } from '../src/api/errors.ts';
import type { Book, BookContent, Manifest, Session } from '../src/api/types.ts';
import { OfflineStore } from '../src/store/offline.ts';
import { PublicationCache, publicationScope } from '../src/store/publications.ts';
import { DEFAULT_APP_SETTINGS } from '../src/store/settings.ts';
import { ReaderScreen } from '../src/ui/reader-screen.tsx';
import type { SyncEngine } from '../src/core/sync.ts';
import { FakeTransport, MemoryBlobs, MemoryKv, makePlatform } from './helpers/env.ts';

const book: Book = {
  id: 'book-1', title: '远程小说', author: '作者', publisher: '', language: 'zh', isbn: '',
  description: '', series: '', seriesIndex: null, tags: [], pubdate: '', format: 'chapters',
  coverUrl: null, fileSize: 0, pageCount: null, source: '', manualFields: [], updatedAt: 1,
};
const session: Session = {
  user: { id: 'u1', username: 'one', displayName: '一', role: 'member', createdAt: 0 },
  accessToken: 'access', accessTokenExpiresAt: 9e15, refreshToken: 'refresh', refreshTokenExpiresAt: 9e15,
};

function content(ids: string[], revision = 'r1'): BookContent {
  return {
    kind: 'text', total: ids.length, revision,
    groups: [{ id: 'all', seq: 0, offset: 0, count: ids.length, title: '全部章节' }],
    items: ids.map((id, seq) => ({
      id, seq, title: `章节 ${id}`, href: `chapter:${id}`, resourceRef: `resource:${revision}:${id}`,
      kind: 'chapter', format: 'html', mediaType: 'text/plain; charset=utf-8',
    })),
  };
}

function manifest(value: BookContent): Manifest {
  return { book, contentUrl: '', coverUrl: null, files: [], ...value, content: value };
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function() { this.removeAttribute('open'); };
  vi.stubGlobal('Blob', NodeBlob);
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  URL.createObjectURL ??= () => 'blob:test';
  URL.revokeObjectURL ??= () => undefined;
});

const screens: ReaderScreen[] = [];
afterEach(() => {
  for (const screen of screens.splice(0)) screen.dispose();
  document.body.replaceChildren();
});

async function setup(kv = new MemoryKv(), blobs = new MemoryBlobs(), userId = 'u1', server = 'http://one.test') {
  const transport = new FakeTransport();
  const platform = makePlatform(transport, kv, blobs);
  const api = new ReaderApi(platform, {
    async load() { return { ...session, user: { ...session.user, id: userId } }; },
    async save() {}, async clear() {},
  });
  api.setBaseUrl(server);
  await api.restore();
  const offline = new OfflineStore(kv);
  await offline.setScope(publicationScope(server, userId));
  const onSignedOut = vi.fn();
  const sync = {
    status: () => ({ state: 'idle', pending: false, message: '', lastSyncAt: null }),
    onStatus: () => () => undefined,
    schedule: vi.fn(),
  } as unknown as SyncEngine;
  const screen = new ReaderScreen({ api, offline, sync, platform, settings: DEFAULT_APP_SETTINGS,
    onBack() {}, onSettingsChange() {}, onSignedOut });
  screens.push(screen);
  document.body.append(screen.element);
  return { screen, api, offline, transport, platform, onSignedOut };
}

function serve(transport: FakeTransport, current: BookContent, next = current) {
  transport.respondWith((request) => {
    if (request.url.endsWith('/manifest')) return { status: 200, headers: {}, json: manifest(current) };
    if (request.url.endsWith('/refresh')) return { status: 200, headers: {}, json: next };
    if (request.url.includes('/assets?')) {
      const ref = new URL(request.url, 'http://test').searchParams.get('ref');
      return { status: 200, headers: {}, bytes: new TextEncoder().encode(`${ref}\n\n<script>alert(1)</script> 正文`) };
    }
    return { status: 200, headers: {}, json: { progress: null } };
  });
}

function body(screen: ReaderScreen): ShadowRoot | null | undefined {
  return screen.element.querySelector('book-content')?.shadowRoot;
}

async function click(screen: ReaderScreen, label: string): Promise<void> {
  const button = [...screen.element.querySelectorAll('button')].find((candidate) =>
    candidate.getAttribute('aria-label') === label || candidate.textContent?.trim().endsWith(label));
  expect(button, label).toBeDefined();
  button!.click();
  await Promise.resolve();
}

describe('chapter publication reading', () => {
  it('switches from the contents panel only after chapter selection and preserves the old view on failure', async () => {
    const env = await setup(); let failSwitch = true;
    env.transport.respondWith(request => {
      if (request.url.endsWith('/source-options')) return { status: 200, headers: {}, json: { canSwitch: true } };
      if (request.url.endsWith('/manifest')) return { status: 200, headers: {}, json: manifest(content(['a', 'b'])) };
      if (request.url.endsWith('/alternatives')) return { status: 200, headers: {}, stream: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('event: results\ndata: ' + JSON.stringify({ items: [{ ref: 'other-book', title: '同一本书', authors: ['作者'], sourceName: '其它书源', latestChapter: '最新章节' }] }) + '\n\nevent: done\ndata: {}\n\n')); controller.close(); } }) };
      if (request.url.endsWith('/switch-preview')) return { status: 200, headers: {}, json: { chapters: [{ id: 'x', title: '另一个章节' }] } };
      if (request.url.endsWith('/switch-source')) return failSwitch
        ? { status: 502, headers: {}, json: { error: { code: 'SOURCE_ERROR', message: '正文获取失败' } } }
        : { status: 200, headers: {}, json: { content: content(['x', 'y'], 'r2'), href: 'chapter:x' } };
      if (request.url.includes('/assets?')) return { status: 200, headers: {}, bytes: new TextEncoder().encode(new URL(request.url, 'http://test').searchParams.get('ref')!) };
      return { status: 200, headers: {}, json: { progress: null } };
    });
    await env.screen.open(book); await click(env.screen, '目录'); await click(env.screen, '切换书源');
    await vi.waitFor(() => expect(env.screen.element.querySelector('.alternative-book')?.textContent).toContain('其它书源')); await click(env.screen, '查看此源目录');
    await vi.waitFor(() => expect(env.screen.element.querySelector('section[aria-label="切换书源"] select')).not.toBeNull());
    const submit = [...env.screen.element.querySelectorAll('button')].find(button => button.textContent === '确认换源并阅读')!;
    expect(submit.disabled).toBe(true);
    const select = env.screen.element.querySelector<HTMLSelectElement>('section[aria-label="切换书源"] select')!;
    select.value = 'x'; select.dispatchEvent(new Event('change', { bubbles: true })); await click(env.screen, '确认换源并阅读');
    await vi.waitFor(() => expect(noticeText()).toContain('正文获取失败'));
    expect(body(env.screen)?.textContent).toContain('resource:r1:a');
    expect(env.screen.element.querySelector('section[aria-label="切换书源"]')?.textContent).toContain('最新章节');
    failSwitch = false; await click(env.screen, '确认换源并阅读');
    await vi.waitFor(() => expect(body(env.screen)?.textContent).toContain('resource:r2:x'));
    await vi.waitFor(() => expect(env.offline.current.progress[book.id]?.locator).toContain('chapter:x'));
    expect(noticeText()).toContain('已切换书源');
  });
  it('renders cached rich chapters with images without requesting an external origin, including offline reopening', async () => {
    const kv = new MemoryKv(); const blobs = new MemoryBlobs();
    const first = await setup(kv, blobs);
    const rich = content(['rich']); rich.kind = 'reflowable';
    delete rich.items[0]!.format; rich.items[0]!.mediaType = 'text/html; charset=utf-8';
    const html = '<h2>插图章节</h2><p>含有<strong>强调</strong>的正文。</p><img alt="插图" src="data:image/png;base64,iVBORw0KGgo=">';
    first.transport.respondWith((request) => {
      if (request.url.endsWith('/manifest')) return { status: 200, headers: {}, json: manifest(rich) };
      if (request.url.includes('/assets?')) return { status: 200, headers: {}, bytes: new TextEncoder().encode(html) };
      return { status: 200, headers: {}, json: { progress: null } };
    });
    await first.screen.open(book);
    expect(body(first.screen)?.querySelector('strong')?.textContent).toBe('强调');
    expect(body(first.screen)?.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png/);
    first.screen.dispose(); screens.splice(screens.indexOf(first.screen), 1); await first.offline.flush();
    const second = await setup(kv, blobs); second.transport.failWith(new ApiError('offline', 'offline'));
    await second.screen.open(book);
    expect(body(second.screen)?.querySelector('h2')?.textContent).toBe('插图章节');
    expect(body(second.screen)?.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png/);
    expect(second.transport.requests.some((request) => request.url.includes('/assets?'))).toBe(false);
  });
  it('ignores delayed chapter callbacks after disposal and an offline account switch', async () => {
    const env = await setup();
    let release!: () => void;
    let started!: () => void;
    const bodyGate = new Promise<void>((resolve) => { release = resolve; });
    const bodyStarted = new Promise<void>((resolve) => { started = resolve; });
    env.transport.respondWith(async (request) => {
      if (request.url.endsWith('/manifest')) return { status: 200, headers: {}, json: manifest(content(['a'])) };
      if (request.url.includes('/assets?')) {
        started();
        await bodyGate;
        return { status: 200, headers: {}, bytes: new TextEncoder().encode('delayed private chapter') };
      }
      return { status: 200, headers: {}, json: { progress: null } };
    });
    const opening = env.screen.open(book);
    await bodyStarted;
    env.screen.dispose();
    screens.splice(screens.indexOf(env.screen), 1);
    await env.offline.setScope('other-account');
    release();
    await opening;
    expect(env.offline.current.progress).toEqual({});
    expect(env.screen.element.isConnected).toBe(false);
  });
  it('caches the complete manifest and read text, reopens offline, and renders markup as literal text', async () => {
    const kv = new MemoryKv();
    const blobs = new MemoryBlobs();
    const first = await setup(kv, blobs);
    serve(first.transport, content(['a', 'b']));
    await first.screen.open(book);
    expect(body(first.screen)?.textContent).toContain('<script>alert(1)</script>');
    expect(body(first.screen)?.querySelector('script')).toBeNull();
    expect(first.transport.requests.some((request) => /\/(toc|items)$/.test(request.url))).toBe(false);
    first.screen.dispose();
    screens.splice(screens.indexOf(first.screen), 1);
    await first.offline.flush();

    const second = await setup(kv, blobs);
    second.transport.failWith(new ApiError('offline', 'offline'));
    await second.screen.open(book);
    expect(body(second.screen)?.textContent).toContain('resource:r1:a');
    await click(second.screen, '目录');
    expect(second.screen.element.querySelectorAll('.toc-list li')).toHaveLength(2);
    await click(second.screen, '2章节 b');
    await vi.waitFor(() => expect(noticeText()).toContain('这一章尚未缓存'));
    expect(body(second.screen)?.textContent).toContain('resource:r1:a');
    expect(body(second.screen)?.textContent).not.toContain('resource:r1:b');
  });

  it('refreshes by stable href, preserving the chapter after insertion and keeping old content on failure', async () => {
    const { screen, offline, transport } = await setup();
    await offline.setProgress({ bookId: book.id, locator: 'r1:0.2500:chapter:b', chapterTitle: '章节 b',
      percentage: 0.6, device: 'test', updatedAt: Date.now() });
    serve(transport, content(['a', 'b']), content(['new', 'a', 'b'], 'r2'));
    await screen.open(book);
    expect(body(screen)?.textContent).toContain('resource:r1:b');
    await click(screen, '目录');
    await click(screen, '刷新目录');
    await vi.waitFor(() => expect(noticeText()).toContain('新增 1 章'));
    expect(body(screen)?.textContent).toContain('resource:r2:b');
    expect(screen.element.querySelector('[aria-current="true"]')?.closest('li')?.getAttribute('data-section')).toBe('chapter:b');
    expect(screen.element.querySelectorAll('.toc-list li')).toHaveLength(3);

    transport.failWith(new ApiError('server', 'plugin unavailable', 'PLUGIN_DISABLED', 503));
    await click(screen, '刷新目录');
    await vi.waitFor(() => expect(noticeText()).toContain('已保留当前章节'));
    expect(body(screen)?.textContent).toContain('resource:r2:b');
    expect(screen.element.querySelectorAll('.toc-list li')).toHaveLength(3);
  });

  it.each([400, 401, 403, 404])('does not fall back to cached content after an HTTP %i response', async (status) => {
    const env = await setup();
    const cache = new PublicationCache(env.platform.kv, env.platform.blobs, publicationScope(env.api.baseUrl, 'u1'));
    await cache.putManifest(book.id, manifest(content(['a'])));
    await cache.putResource(book.id, 'resource:r1:a', new TextEncoder().encode('private chapter'));
    env.transport.json({ error: { code: 'DENIED', message: 'Denied' } }, status);
    await env.screen.open(book);
    expect(body(env.screen)?.textContent ?? '').not.toContain('private chapter');
    expect(env.transport.requests.some((request) => request.url.includes('/assets?'))).toBe(false);
    if (status === 401) expect(env.onSignedOut).toHaveBeenCalled();
  });

  it('separates cached manifests, chapter bytes and progress between accounts and servers', async () => {
    const kv = new MemoryKv();
    const blobs = new MemoryBlobs();
    const one = new PublicationCache(kv, blobs, publicationScope('http://one.test/', 'u1'));
    await one.putManifest(book.id, manifest(content(['a'])));
    await one.putResource(book.id, 'ref', new TextEncoder().encode('private'));
    for (const [server, user] of [['http://one.test', 'u2'], ['http://two.test', 'u1']]) {
      const other = new PublicationCache(kv, blobs, publicationScope(server!, user!));
      expect(await other.manifest(book.id)).toBeNull();
      expect(await other.resource(book.id, 'ref')).toBeNull();
    }
    const scope = new OfflineStore(kv);
    await scope.setScope(publicationScope('http://one.test', 'u1'));
    await scope.setProgress({ bookId: book.id, locator: 'chapter:a', percentage: 0.2, chapterTitle: '', device: '', updatedAt: 1 });
    await scope.setScope(publicationScope('http://one.test', 'u2'));
    expect(await scope.getProgress(book.id)).toBeUndefined();
    await scope.setScope(publicationScope('http://one.test', 'u1'));
    expect((await scope.getProgress(book.id))?.locator).toBe('chapter:a');
  });
});

it('refreshes only the current chapter, updates offline cache and preserves text after errors', async () => {
  const env = await setup(); const value = content(['a']); value.sourceName = '示例源'; value.items[0]!.sourceUrl = 'https://example.test/a';
  let fail = false, refreshes = 0;
  env.transport.respondWith(request => {
    if (request.url.endsWith('/manifest')) return { status: 200, headers: {}, json: manifest(value) };
    if (request.url.endsWith('/refresh-chapter')) {
      refreshes++;
      return fail ? { status: 502, headers: {}, json: { error: { code: 'SOURCE_ERROR', message: 'offline' } } }
        : { status: 200, headers: {}, bytes: new TextEncoder().encode('已更新的章节正文') };
    }
    if (request.url.includes('/assets?')) return { status: 200, headers: {}, bytes: new TextEncoder().encode('原来的正文') };
    return { status: 200, headers: {}, json: {} };
  });
  await env.screen.open(book);
  expect(body(env.screen)?.textContent).toContain('原来的正文');
  expect(env.screen.element.querySelector('.reader-source-info')?.textContent).toContain('示例源');
  expect(env.screen.element.querySelector('.reader-source-info a')?.getAttribute('href')).toBe('https://example.test/a');
  await click(env.screen, '刷新当前章节');
  await vi.waitFor(() => expect(body(env.screen)?.textContent).toContain('已更新的章节正文'));
  fail = true; await click(env.screen, '刷新当前章节');
  await vi.waitFor(() => expect(noticeText()).toContain('刷新正文失败'));
  expect(body(env.screen)?.textContent).toContain('已更新的章节正文'); expect(refreshes).toBe(2);
  const cache = new PublicationCache(env.platform.kv, env.platform.blobs, publicationScope(env.api.baseUrl, 'u1'));
  expect(new TextDecoder().decode((await cache.resource(book.id, 'resource:r1:a'))!)).toContain('已更新的章节正文');
});

describe('legacy offline migration', () => {
  it('claims a restored session once and preserves pending progress, notes, deletes and the original backup', async () => {
    const kv = new MemoryKv();
    const legacy = new OfflineStore(kv);
    await legacy.setProgress({ bookId: 'b', locator: 'r1:0.5000:chapter:a', percentage: 0.5, chapterTitle: '', device: '', updatedAt: 1 });
    await legacy.upsertNotes([{ id: 'n', bookId: 'b', locator: 'x', type: 'note', text: '待同步', comment: '', color: '', updatedAt: 1 }]);
    await legacy.deleteNote('old');
    const backup = await kv.get('reader.offline.v1');
    const migrated = new OfflineStore(kv);
    await migrated.setScope('server/account-1', { claimLegacy: true });
    expect(migrated.outbox()).toEqual(legacy.outbox());
    expect(await kv.get('reader.offline.v1')).toBe(backup);
    const second = new OfflineStore(kv);
    await second.setScope('server/account-2', { claimLegacy: true });
    expect(second.outbox()).toEqual({ progress: [], notes: [], deletes: [] });
  });

  it('does not give a fresh login legacy data when its session is restored on the next launch', async () => {
    const kv = new MemoryKv();
    await kv.set('reader.offline.v1', JSON.stringify({ progress: { secret: { locator: 'private' } } }));
    const fresh = new OfflineStore(kv);
    await fresh.setScope('new-account');
    const reopened = new OfflineStore(kv);
    await reopened.setScope('new-account', { claimLegacy: true });
    expect(reopened.current.progress).toEqual({});
  });
});
