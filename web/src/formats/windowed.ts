/**
 * Staged documents: a book that is read one window at a time.
 *
 * This is the client half of "服务端分章节" — the reader is handed the addressable
 * structure (chapters, pages, volumes) and fetches one unit at a time, so opening
 * a 1200-chapter omnibus costs one chapter of bytes and never the file.
 *
 * The design has three load-bearing parts.
 *
 * ### 1. A staged document is a `BookDoc`, not a second interface
 *
 * Everything downstream — pagination, gestures, progress, the table of contents —
 * is written against `BookDoc`. A parallel type would fork all of it. So a
 * `StagedDoc` *is* a `BookDoc` whose sections are placeholders, plus the two
 * things the reader needs to drive it: `loadSection` and a complete `toc`.
 *
 * ### 2. Locators are section ids, and section ids are the server's refs
 *
 * A window is a transport boundary; a locator must survive crossing one. The
 * server's `href` is stable across windows (`xhtml:OEBPS/ch1.xhtml`), so it is
 * what a saved position is matched on — never a spine index, which means a
 * different chapter in a different window.
 *
 * ### 3. A window is fetched when the reader asks for something outside it
 *
 * Windows are not a cache to be filled in the background; they are on-demand.
 * `RemoteZip` is the exception: for an EPUB, reading one chapter means reading
 * the archive's central directory once and then one entry, which is what keeps
 * the open cost at one chapter rather than one archive.
 */

import type { BookContent, ContentItem } from '../net/api.ts';
import { RemoteZip, type RangeSource } from './remote-zip.ts';
import type { BookDoc, Section, StagedBook, TocEntry } from './types.ts';

/**
 * How a staged section's bytes are obtained.
 *
 * `read` returns the chapter's markup already rewritten so its own relative
 * resource references resolve — the server does that rewriting for EPUB, and a
 * client-side staged EPUB has to do the same thing for itself.
 */
export interface SectionLoader {
  /** Section markup for a reflowable section, or a page's bytes. */
  read(item: ContentItem): Promise<{ html?: string; image?: { mediaType: string; bytes: Uint8Array } }>;
}

export interface StagedDocOptions {
  kind: BookContent['kind'];
  /** Every chapter of the book, so the table of contents is complete. */
  toc: TocEntry[];
  /** The window that is loaded right now. */
  content: BookContent;
  /** Fetches a window by group index, for a jump outside the loaded one. */
  windowFor?(group: number): Promise<BookContent>;
  loader: SectionLoader;
  /** True when section order comes from the book rather than the file name. */
  orderedByBook?: boolean;
}

/** A `BookDoc` whose section bodies are fetched on demand. */
export interface StagedDoc extends BookDoc {
  /** Load one section's body, filling in its `html`/`image` in place. */
  loadSection(index: number): Promise<Section | null>;
  /**
   * Replace the loaded window.
   *
   * Returns the local index of `spine` within the new window, or -1 when the new
   * window does not contain it.
   *
   * Named `setWindow` here and `loadWindow` on `StagedBook` — and one of those
   * two names is the reason this comment exists. The screen used to duck-type a
   * `loadWindow` off the document, found nothing (the method was called
   * `setWindow`), and so never swapped a window: tapping chapter 900 of a
   * 1200-chapter book did nothing at all. The duck type is gone; the contract is
   * this interface, and `adoptWindow` below is the single implementation of it.
   */
  setWindow(content: BookContent, spine: number): number;
  /** Whole-book index of the loaded window's first section. */
  windowOffset(): number;
}

/**
 * Build a staged document from a windowed manifest.
 *
 * `sections` is exactly the window's items; `toc` is the whole book. Keeping
 * those two separate is what stops the transport boundary leaking into the
 * navigation UI — a table of contents that read "第 1 章 – 第 40 章" because that
 * was the size of a window is the bug this split exists to prevent.
 */
export function createStagedDoc(options: StagedDocOptions): StagedDoc {
  const sections: Section[] = options.content.items.map((item) => ({
    id: item.href,
    label: item.title,
    depth: 0,
    render: item.kind === 'page' ? 'image' : 'reflowable',
    path: item.href,
  }));

  const base: BookDoc = {
    format: formatFor(options.kind),
    layout: options.kind === 'paged' || options.kind === 'single-image' ? 'fixed' : 'reflowable',
    render:
      options.kind === 'paged' || options.kind === 'single-image'
        ? 'image'
        : options.kind === 'document'
          ? 'document'
          : 'reflowable',
    direction: 'ltr',
    sections,
    toc: options.toc,
    styles: [],
    resources: new Map(),
    orderedByBook: options.orderedByBook ?? true,
  };

  let offset =
    options.content.groups[options.content.group ?? 0]?.offset ?? options.content.items[0]?.seq ?? 0;

  const doc: StagedDoc = {
    ...base,
    async loadSection(index: number): Promise<Section | null> {
      const section = doc.sections[index];
      const item = currentItems()[index];
      if (!section || !item) return null;
      // Already loaded: a re-style or a resize asks for the same section twice
      // and must not re-fetch it.
      if (section.html !== undefined || section.image !== undefined) return section;
      const loaded = await options.loader.read(item);
      if (loaded.html !== undefined) section.html = loaded.html;
      if (loaded.image !== undefined) section.image = loaded.image;
      return section;
    },
    setWindow(content: BookContent, spine: number): number {
      // Checked *before* anything is mutated. A window that does not hold the
      // chapter must leave the loaded one exactly as it was: swapping first and
      // then reporting -1 replaces the reader's chapter with a different one and
      // then tells the caller the jump failed, which is both wrong on screen and
      // impossible for the caller to undo — the old sections are already gone.
      const local = content.items.findIndex((item) => item.seq === spine);
      if (local === -1) return -1;

      // The offset comes from the group the response actually carries. A
      // response that omits `group` (a server that chose not to window, or a
      // hand-built one in a test) still has to answer correctly, so the offset
      // is derived from the items' own `seq` rather than assumed to be zero.
      const index = content.group ?? 0;
      const group = content.groups[index];
      offset = group?.offset ?? content.items[0]?.seq ?? 0;
      current = content;
      const items = currentItems();
      doc.sections.length = 0;
      for (const item of items) {
        doc.sections.push({
          id: item.href,
          label: item.title,
          depth: 0,
          render: item.kind === 'page' ? 'image' : 'reflowable',
          path: item.href,
        });
      }
      return local;
    },
    windowOffset(): number {
      return offset;
    },
  };

  let current = options.content;
  function currentItems(): ContentItem[] {
    return current.items;
  }

  return doc;
}

/**
 * Swaps a document's loaded window, whichever way the document exposes it.
 *
 * Two method names exist in the codebase for one operation — `setWindow` on a
 * client-built `StagedDoc`, `loadWindow` on the `StagedBook` interface — and the
 * reader screen used to pick between them by checking which one *looked* present.
 * It checked for `loadWindow`, the documents answer to `setWindow`, and the check
 * therefore always failed: every jump out of the loaded window was a silent
 * no-op. This function is the one place that knows both names, so no caller has
 * to guess and a future third name has one place to be added.
 *
 * Returns the local index of `spine` in the newly loaded window, or -1 when there
 * is no window to load or the window does not hold that spine.
 */
export function adoptWindow(doc: BookDoc, content: BookContent, spine: number): number {
  const staged = doc as StagedBook & Partial<StagedDoc>;
  if (typeof staged.setWindow === 'function') return staged.setWindow(content, spine);
  if (typeof staged.loadWindow === 'function') return staged.loadWindow(content, spine);
  return -1;
}

/**
 * Which window (group) holds a whole-book index.
 *
 * Derived from the manifest's own group sizes rather than from the constant the
 * client keeps, because a format is free to window at its own granularity — a
 * comic windows by volume, and a volume is not forty pages. The constant is only
 * a fallback for a manifest that ships no groups at all.
 *
 * The result is the group's *index*, which is what the endpoint takes, not the
 * group's `seq`.
 */
export function windowIndexOf(content: BookContent, spine: number): number {
  const groups = content.groups ?? [];
  if (groups.length > 0) {
    let offset = groups[0]?.offset ?? 0;
    for (const [index, group] of groups.entries()) {
      // The first group may declare an offset of its own instead of zero; the
      // running offset is anchored on it so both conventions answer correctly.
      if (index > 0) offset += groups[index - 1]?.count ?? 0;
      if (spine < offset + group.count) return index;
    }
    return groups.length - 1;
  }
  return Math.max(0, Math.floor(spine / CHAPTER_WINDOW));
}

/**
 * Chapters per window, for a manifest that reports no groups of its own.
 *
 * Duplicated from the server's constant on purpose (see `CHAPTER_WINDOW` in the
 * reader screen): overlapping by one window costs one request, never a wrong
 * chapter, because the response is always the authority on what it contains.
 */
const CHAPTER_WINDOW = 40;

function formatFor(kind: BookContent['kind']): BookDoc['format'] {
  switch (kind) {
    case 'paged':
      return 'cbz';
    case 'text':
      return 'txt';
    case 'document':
      return 'pdf';
    case 'single-image':
      return 'image';
    default:
      return 'epub';
  }
}

/** Whether a manifest's kind can be read a window at a time by a client. */
export function isStagedKind(kind: BookContent['kind'] | undefined): boolean {
  return kind === 'reflowable' || kind === 'paged' || kind === 'text';
}

export { RemoteZip };
export type { RangeSource };
