import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { Book, BookContent } from '../../../api/types.ts';
import { ApiError } from '../../../api/errors.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { createStagedDoc, windowIndexOf, type StagedDoc } from '../../../formats/windowed.ts';
import type { BookDoc } from '../../../formats/types.ts';
import { htmlToText, isTextOnlyMarkup } from '../../../formats/segments.ts';
import { renditionRef } from '../../../ui/rendition.ts';
import { applyCorrections, emptyOverrides, type ReadingOverrides } from '../../../ui/reading-overrides.ts';
import { ReaderView, type Position, type ViewSettings } from '../../../ui/reader-view.ts';
import { makeAssetSigner } from '../../../net/asset-url.ts';
import { notify } from '../../../ui/notifications.ts';
import { CompanionReader } from '../../../ui/companion-reader.tsx';
import { PublicationCache, publicationScope } from '../../../store/publications.ts';
import { useSettingsStore } from '../../../shared/stores/settings.store.ts';
import { useThemeState } from '../../../shared/theme/use-theme.ts';
import { resolveReaderSurface } from '../../../shared/theme/theme.ts';
import type { AppSettings } from '../../../store/settings.ts';
import { useCompanionStore, type CompanionRequest } from './companion-store.ts';

interface Engine {
  view: ReaderView;
  doc: StagedDoc;
  content: BookContent;
  overrides: ReadingOverrides;
  publication: PublicationCache;
}

interface Readout {
  label: string;
  index: number;
  page: number;
  pages: number;
}

const initialReadout = (request: CompanionRequest | null): Readout => ({
  label: '',
  index: (request?.spine ?? 0) + 1,
  page: 1,
  pages: 0,
});

/** The reading settings, for a document whose flow direction may be its own. */
function viewSettingsFor(settings: AppSettings, doc: BookDoc): Partial<ViewSettings> {
  return {
    mode: settings.mode,
    fontScale: settings.fontScale,
    lineHeight: settings.lineHeight,
    theme: settings.theme,
    fit: settings.fit,
    direction: doc.layout === 'fixed' ? settings.comicDirection : (doc.direction ?? 'ltr'),
    fontFamily: settings.fontFamily,
    pageMargin: settings.pageMargin,
    textAlign: settings.textAlign,
    brightness: settings.brightness,
    pageAnimation: settings.pageAnimation,
    focus: settings.focus,
    tapZone: settings.tapZone,
    txtIndent: settings.txtIndent,
    txtParagraphGap: settings.txtParagraphGap,
  };
}

/**
 * 小窗阅读, mounted once in the authenticated shell.
 *
 * It is deliberately *outside* the reader route: leaving the book for the shelf,
 * search or settings must not close the window. The frame is React; the chapter
 * inside it is a second imperative `ReaderView` with its own staged document, so
 * its window changes never rewrite the big reader's document.
 */
export function CompanionLayer(): JSX.Element | null {
  const runtime = useRuntime();
  const request = useCompanionStore(state => state.request);
  const settings = useSettingsStore(state => state.settings);
  const theme = useThemeState(runtime.mediaApi.preferenceScope());
  const [stageNode, setStageNode] = useState<HTMLElement | null>(null);
  const [readout, setReadout] = useState<Readout>(() => initialReadout(null));
  const [navigating, setNavigating] = useState(false);
  const engine = useRef<Engine | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const busy = useRef(false);

  const publication = useMemo(() => {
    const session = runtime.api.currentSession();
    return new PublicationCache(
      runtime.platform.kv,
      runtime.platform.blobs,
      publicationScope(runtime.api.baseUrl || (typeof location !== 'undefined' ? location.origin : ''), session?.user.id ?? ''),
    );
  }, [runtime]);

  const surface = resolveReaderSurface(
    theme.preference,
    theme.systemDark,
    settings.paper ?? 'theme',
    settings.paperFollowsDark ?? true,
  );

  useEffect(() => {
    if (!request || !stageNode) return;
    let cancelled = false;
    let built: ReaderView | null = null;

    const readSection = async (
      book: Book,
      item: { href: string; kind: string; mediaType: string; format?: string; resourceRef?: string },
    ): Promise<{ html?: string; image?: { mediaType: string; bytes: Uint8Array }; plainText?: boolean }> => {
      const ref = renditionRef(item);
      const cached = await publication.resource(book.id, ref);
      const blob = cached ? new Blob([toArrayBuffer(cached)]) : await runtime.api.asset(book.id, ref);
      if (!cached) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        await publication.putResource(book.id, ref, bytes).catch(() => undefined);
      }
      if (item.kind === 'page') return { image: { mediaType: item.mediaType, bytes: new Uint8Array(await blob.arrayBuffer()) } };
      const body = await blob.text();
      if (book.format === 'chapters' && item.kind === 'chapter' && /html/i.test(item.mediaType) && isTextOnlyMarkup(body)) {
        return { html: htmlToText(body), plainText: true };
      }
      return { html: body };
    };

    const readWindow = async (bookId: string, group: number): Promise<BookContent> => {
      try {
        const content = await runtime.api.items(bookId, group);
        await publication.putWindow(bookId, group, content).catch(() => undefined);
        return content;
      } catch (error) {
        if (error instanceof ApiError && !error.isConnectivity && error.kind !== 'server') throw error;
        const cached = await publication.window(bookId, group);
        if (cached) return cached;
        throw error;
      }
    };

    const build = async (): Promise<void> => {
      let overrides = emptyOverrides();
      try { overrides = await publication.overrides(request.book.id) ?? overrides; } catch { /* read as published */ }
      if (cancelled) return;

      const doc = createStagedDoc({
        kind: request.content.kind,
        toc: request.toc,
        content: request.content,
        orderedByBook: true,
        loader: { read: item => readSection(request.book, item) },
      });
      (doc as BookDoc & { staged?: unknown }).staged = doc;

      const signAssetUrl = makeAssetSigner({
        baseUrl: runtime.api.baseUrl,
        accessToken: () => runtime.api.currentSession()?.accessToken ?? null,
        resourceToken: () => runtime.api.currentSession()?.resourceToken ?? null,
      });
      const view = new ReaderView({
        container: stageNode,
        doc,
        ...(signAssetUrl ? { signAssetUrl } : {}),
        transformText: (root, sectionId) => { applyCorrections(root, sectionId, overrides); },
        onPositionChange: (position: Position) => {
          if (cancelled) return;
          setReadout({
            label: position.chapterTitle,
            index: position.chapterPosition + 1,
            page: position.pageInChapter,
            pages: position.chapterPages,
          });
        },
        onChapterChange: (_index, section) => {
          if (!cancelled) setReadout(current => ({ ...current, label: section.label }));
        },
        onChapterLink: (ref) => {
          const raw = ref.split('#')[0] ?? '';
          const bare = raw.replace(/^xhtml:/, '');
          const known = doc.sections.find(section => section.id === raw)
            ?? doc.sections.find(section => section.id.replace(/^xhtml:/, '') === bare);
          if (!known) return false;
          void view.open(doc.sections.indexOf(known), 0);
          return true;
        },
      });
      built = view;
      engine.current = { view, doc, content: request.content, overrides, publication };
      view.applySettings(viewSettingsFor(settingsRef.current, doc));
      setReadout(initialReadout(request));

      const main = useCompanionStore.getState().mainPosition;
      const spine = main?.bookId === request.book.id ? main.spine : request.spine;
      const within = main?.bookId === request.book.id ? main.within : request.within;
      try {
        await openAt(view, request.content, spine, within, readWindow);
      } catch {
        if (!cancelled) notify('小窗无法打开这一页');
      }
    };

    void build();
    return () => {
      cancelled = true;
      built?.dispose();
      if (engine.current?.view === built) engine.current = null;
    };
  }, [request, stageNode, runtime, publication]);

  useEffect(() => {
    const current = engine.current;
    if (current) current.view.applySettings(viewSettingsFor(settings, current.doc));
  }, [settings]);

  const openAt = async (
    view: ReaderView,
    content: BookContent,
    spine: number,
    within: number,
    readWindow: (bookId: string, group: number) => Promise<BookContent>,
  ): Promise<void> => {
    const book = useCompanionStore.getState().request?.book;
    if (!book) throw new Error('小窗阅读已关闭');
    const local = spine - view.windowOffset;
    if (local >= 0 && local < view.sectionCount) {
      await view.open(local, within);
      return;
    }
    const shape = content ?? useCompanionStore.getState().request?.content;
    if (!shape) throw new Error('没有可用的章节窗口');
    const next = await readWindow(book.id, windowIndexOf(shape, spine));
    const landed = await view.loadWindow(next, spine);
    if (!landed) throw new Error('这一章不在窗口里');
    const current = engine.current;
    if (current) current.content = next;
    await view.open(spine - view.windowOffset, within);
  };

  const run = async (task: (engine: Engine, readWindow: (bookId: string, group: number) => Promise<BookContent>) => Promise<void>): Promise<void> => {
    const current = engine.current;
    if (!current || busy.current) return;
    busy.current = true;
    setNavigating(true);
    try {
      const readWindow = async (bookId: string, group: number): Promise<BookContent> => {
        try {
          const content = await runtime.api.items(bookId, group);
          await publication.putWindow(bookId, group, content).catch(() => undefined);
          return content;
        } catch (error) {
          if (error instanceof ApiError && !error.isConnectivity && error.kind !== 'server') throw error;
          const cached = await publication.window(bookId, group);
          if (cached) return cached;
          throw error;
        }
      };
      await task(current, readWindow);
    } catch {
      notify('小窗无法跳到这一章');
    } finally {
      busy.current = false;
      setNavigating(false);
    }
  };

  const sync = (): void => {
    const state = useCompanionStore.getState();
    const main = state.mainPosition;
    const book = state.request?.book;
    void run((current, readWindow) => {
      if (!main || !book || main.bookId !== book.id) return Promise.resolve();
      return openAt(current.view, current.content, main.spine, main.within, readWindow);
    });
  };

  const chapter = (delta: 1 | -1): void => {
    void run(async (current, readWindow) => {
      const target = current.view.currentChapterPosition + delta;
      const total = useCompanionStore.getState().request?.content.total ?? 0;
      if (target < 0) {
        notify('已经是第一章');
        return;
      }
      if (total > 0 && target >= total) {
        notify('已经是最后一章');
        return;
      }
      await openAt(current.view, current.content, target, 0, readWindow);
    });
  };

  const page = (delta: 1 | -1): void => {
    const current = engine.current;
    if (!current || busy.current) return;
    void (async () => {
      let moved: boolean;
      try {
        moved = delta > 0 ? await current.view.next() : await current.view.previous();
      } catch {
        notify('小窗翻页失败');
        return;
      }
      if (!moved) {
        chapter(delta);
        return;
      }
      current.view.animatePage(delta > 0 ? 'next' : 'previous');
    })();
  };

  if (!request) return null;

  return (
    <div
      className="companion-layer"
      data-theme={surface.theme}
      data-mode={surface.mode}
      {...(surface.paper ? { 'data-paper': surface.paper } : {})}
    >
      <CompanionReader
        key={request.book.id}
        title={request.book.title}
        chapterLabel={readout.label}
        chapterIndex={readout.index}
        chapterCount={request.content.total}
        page={readout.page}
        pages={readout.pages}
        navigating={navigating}
        onClose={() => useCompanionStore.getState().close()}
        onSync={sync}
        onChapter={chapter}
        onPage={page}
        onStage={setStageNode}
      />
    </div>
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
