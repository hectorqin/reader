/**
 * 增强解析: a PDF's text layer, read back as chapters (docs/pdf.md).
 *
 * A PDF has no paragraphs, only glyphs placed on pages. pdf.js gives us those as
 * runs of text with positions; this module turns them into what a reader expects:
 * lines, then paragraphs and headings, then chapters cut where the book's own
 * bookmarks (the outline) say chapters begin. The extraction itself (pdf.js) runs
 * in a worker thread (`pdf-text-worker.ts`); everything here is pure, so the
 * judgement calls are tested on hand-made pages rather than on whichever PDFs
 * happen to be at hand.
 *
 * What it gives up, on purpose: layout. Columns are read in content order, tables
 * become lines of text, figures and formulas are not drawn. That is the trade the
 * reader chose by picking this mode over the pages (`pdfjs`).
 */

/** Bump when the extracted shape or the structuring rules change: cached results are keyed by it. */
export const PDF_TEXT_VERSION = 2;

/** One line of text on a page, in PDF units (origin bottom-left). */
export interface PdfLine {
  /** Text. */
  t: string;
  /** Left edge, baseline, right edge, font size. */
  x: number;
  y: number;
  r: number;
  s: number;
}
export interface PdfPage {
  w: number;
  h: number;
  lines: PdfLine[];
}
/** A bookmark, resolved to a page (0-based) and, when the bookmark says so, a height on it. */
export interface PdfOutlineEntry {
  title: string;
  level: number;
  page: number;
  top: number | null;
}
export interface PdfText {
  version: number;
  pages: PdfPage[];
  outline: PdfOutlineEntry[];
}

export interface PdfChapter {
  title: string;
  /** First page (1-based) the chapter's text comes from. */
  page: number;
  html: string;
}
export interface PdfTocEntry {
  title: string;
  level: number;
  chapter: number;
  /** Element id inside the chapter, or '' for the chapter's start. */
  anchor: string;
}
export interface PdfBook {
  /** False for a scan: too little text to read; the pages are the book. */
  hasText: boolean;
  chapters: PdfChapter[];
  toc: PdfTocEntry[];
}

/** Pages per chapter when the PDF has no bookmarks to cut at. */
export const PAGES_PER_CHAPTER = 20;

const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/;
const PAGE_NUMBER =
  /^[\s\-–—·•|]*(?:第\s*)?(?:\d{1,4}|[ivxlcdm]{1,8})(?:\s*页)?(?:\s*(?:[/／]|of)\s*\d{1,4})?[\s\-–—·•|]*$/i;

/** Reads a PDF's text into chapters. */
export function buildPdfBook(text: PdfText): PdfBook {
  const pages = stripRunningLines(
    text.pages,
    text.outline.map((entry) => entry.title),
  );
  const allLines = pages.flatMap((page) => page.lines);
  const chars = allLines.reduce((sum, line) => sum + line.t.length, 0);
  const pagesWithText = pages.filter((page) => page.lines.length > 0).length;
  // A scan has an empty (or near-empty: a stamped page number) text layer.
  const hasText = pages.length > 0 && chars >= 4 * pages.length && pagesWithText >= pages.length * 0.3;
  if (!hasText) return { hasText: false, chapters: [], toc: [] };

  const body = weightedMedian(allLines.map((line) => [line.s, line.t.length]));
  const gaps: number[] = [];
  for (const page of pages) {
    for (let i = 1; i < page.lines.length; i += 1) {
      const a = page.lines[i - 1]!,
        b = page.lines[i]!;
      const gap = a.y - b.y;
      if (gap > 0 && near(a.s, body) && near(b.s, body)) gaps.push(gap);
    }
  }
  const lineGap = median(gaps) || body * 1.4;

  // Where each bookmark lands: the first line at or below its height on its page.
  const outline = text.outline.filter((entry) => entry.page >= 0 && entry.page < pages.length && entry.title.trim());
  const chapterLevel = pickChapterLevel(outline);
  const marks = new Map<string, Array<{ entry: PdfOutlineEntry; index: number; titled: boolean }>>();
  outline.forEach((entry, index) => {
    const at = landing(pages, entry);
    if (!at) return;
    const key = `${at.page}:${at.line}`;
    marks.set(key, [...(marks.get(key) ?? []), { entry, index, titled: at.titled }]);
  });
  const chapterEntries = outline.filter((entry) => entry.level === chapterLevel);
  const byOutline = chapterEntries.length >= 2;

  const chapters: Array<{ title: string; page: number; blocks: Block[] }> = [];
  const placed: Array<{ index: number; entry: PdfOutlineEntry; chapter: number; anchor: string }> = [];
  let current: Block | null = null;
  let previous: { line: PdfLine; page: number; right: number } | null = null;
  // A page marker goes where a page begins in the text, once per page and chapter.
  let marked = 0;
  const pageMark = (page: number): Part[] => {
    if (page === marked) return [];
    marked = page;
    return [{ page }];
  };
  const flush = () => {
    if (current) chapter().blocks.push(current);
    current = null;
  };
  const chapter = () => {
    // Text before the first bookmark (a title page, a preface without one) is a chapter of its own.
    if (!chapters.length) chapters.push({ title: '开头', page: 1, blocks: [] });
    return chapters[chapters.length - 1]!;
  };
  const startChapter = (title: string, page: number) => {
    flush();
    chapters.push({ title, page, blocks: [] });
    marked = 0;
    previous = null;
  };

  pages.forEach((page, pageIndex) => {
    const { left, right } = textBlock(page, body);
    const notes = marginNotes(page, left, right);
    if (!byOutline && pageIndex % PAGES_PER_CHAPTER === 0) {
      const last = Math.min(pages.length, pageIndex + PAGES_PER_CHAPTER);
      startChapter(last - pageIndex === 1 ? `第 ${pageIndex + 1} 页` : `第 ${pageIndex + 1}–${last} 页`, pageIndex + 1);
    }
    if (!page.lines.length) {
      flush();
      chapter().blocks.push({ kind: 'note', parts: [], size: body, page: pageIndex + 1 });
      marked = pageIndex + 1;
      previous = null;
      return;
    }
    page.lines.forEach((line, lineIndex) => {
      const here = marks.get(`${pageIndex}:${lineIndex}`) ?? [];
      if (!here.length && notes.has(line)) return;
      const opening = byOutline ? here.find((mark) => mark.entry.level === chapterLevel) : undefined;
      if (opening) startChapter(opening.entry.title.trim(), pageIndex + 1);
      const prev = previous;
      // A line a bookmark names is a heading whatever its size: many books set
      // headings in bold at body size, which the text layer cannot see.
      const titled = here.find((mark) => mark.titled);
      const heading = !!titled || (line.s >= body * 1.25 && line.t.trim().length <= 80);
      const newPage = prev !== null && prev.page !== pageIndex;
      const indented = line.x > left + line.s * 0.9;
      const prevShort = prev !== null && prev.line.r < prev.right - prev.line.s * 1.5;
      const open = current as Block | null;
      const breaks =
        open === null ||
        here.length > 0 ||
        heading !== (open.kind === 'h') ||
        Math.abs(line.s - open.size) > open.size * 0.12 ||
        (!newPage && prev !== null && prev.line.y - line.y > lineGap * 1.5) ||
        indented ||
        prevShort ||
        (heading && newPage);
      if (breaks) {
        flush();
        chapter();
        const anchors: Part[] = [];
        for (const mark of here) {
          const anchor = mark === opening ? '' : `pdf-toc-${mark.index}`;
          if (anchor) anchors.push({ anchor });
          placed.push({ index: mark.index, entry: mark.entry, chapter: chapters.length - 1, anchor });
        }
        current = {
          kind: heading ? 'h' : 'p',
          parts: [...anchors, ...pageMark(pageIndex + 1), line.t.trim()],
          size: line.s,
          page: pageIndex + 1,
          ...(titled ? { tag: titled.entry.level <= chapterLevel ? ('h2' as const) : ('h3' as const) } : {}),
        };
      } else {
        if (newPage) open!.parts.push(...pageMark(pageIndex + 1));
        join(open!, line.t.trim());
      }
      previous = { line, page: pageIndex, right };
    });
  });
  flush();
  const last = chapters[chapters.length - 1];
  if (last && !last.blocks.length && chapters.length > 1) chapters.pop();
  return {
    hasText: true,
    chapters: chapters.map((item) => ({
      title: item.title,
      page: item.page,
      html: chapterHtml(item.title, item.blocks, body),
    })),
    toc: byOutline
      ? placed
          .filter((item) => item.chapter < chapters.length)
          .sort((a, b) => a.index - b.index)
          .map((item) => ({
            title: item.entry.title.trim(),
            level: item.entry.level,
            chapter: item.chapter,
            anchor: item.anchor,
          }))
      : chapters.map((item, index) => ({ title: item.title, level: 0, chapter: index, anchor: '' })),
  };
}

type Part = string | { page: number } | { anchor: string };
interface Block {
  /** A heading's tag, when a bookmark decided it rather than the font size. */
  tag?: 'h2' | 'h3';
  kind: 'p' | 'h' | 'note';
  parts: Part[];
  size: number;
  page: number;
}

/** Joins a line onto a paragraph: no space between CJK, hyphenated Latin rejoined. */
function join(block: Block, text: string): void {
  const last = block.parts.findLastIndex((part) => typeof part === 'string');
  const before = last >= 0 ? (block.parts[last] as string) : '';
  const tail = before.slice(-1),
    head = text.slice(0, 1);
  if (!before) {
    block.parts.push(text);
    return;
  }
  // Markers (page starts) may sit between the two pieces; join onto the text, keep the marker.
  if (/[a-z]-$/i.test(before) && /^[a-z]/.test(text) && last === block.parts.length - 1) {
    block.parts[last] = before.slice(0, -1) + text;
    return;
  }
  const glue = CJK.test(tail) || CJK.test(head) || /\s$/.test(before) ? '' : ' ';
  block.parts.push(glue + text);
}

function chapterHtml(title: string, blocks: Block[], body: number): string {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.kind === 'note') {
      out.push(
        `<p class="pdf-no-text" id="pdf-page-${block.page}" data-page="${block.page}">第 ${block.page} 页没有可提取的文字（可能是插图或扫描页），可切换到「原版页面」查看。</p>`,
      );
      continue;
    }
    const inner = block.parts
      .map((part) =>
        typeof part === 'string'
          ? escapeHtml(part)
          : 'page' in part
            ? `<span class="pdf-page" id="pdf-page-${part.page}" data-page="${part.page}"></span>`
            : `<span id="${part.anchor}"></span>`,
      )
      .join('');
    const tag = block.tag ?? (block.size >= body * 1.6 ? 'h2' : 'h3');
    if (block.kind === 'h') out.push(`<${tag}>${inner}</${tag}>`);
    else out.push(`<p>${inner}</p>`);
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title></head><body>${out.join('\n')}</body></html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Running heads and page numbers: the same line (digits aside) at the top or the
 * bottom of many pages, or a bare page number there. They are the page's furniture,
 * not the book's text, and left in they would interrupt a paragraph on every page.
 */
export function stripRunningLines(pages: PdfPage[], titles: string[] = []): PdfPage[] {
  const edges = (page: PdfPage): PdfLine[] => {
    if (page.lines.length < 2) return page.lines.slice();
    const sorted = [...page.lines].sort((a, b) => b.y - a.y);
    return [...sorted.slice(0, 2), ...sorted.slice(-2)];
  };
  const key = (line: PdfLine) => line.t.replace(/\d+/g, '#').replace(/\s+/g, '').toLowerCase();
  const counts = new Map<string, number>();
  for (const page of pages)
    for (const k of new Set(edges(page).map(key))) if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  const withText = pages.filter((page) => page.lines.length).length;
  const threshold = Math.max(3, withText * 0.3);
  const size = weightedMedian(
    pages.flatMap((page) => page.lines.map((line): [number, number] => [line.s, line.t.length])),
  );
  return pages.map((page) => {
    const edge = new Set(edges(page));
    return {
      ...page,
      lines: page.lines.filter((line) => {
        if (!edge.has(line)) return true;
        if (PAGE_NUMBER.test(line.t.trim())) return false;
        // A running head that names the current section changes from page to page,
        // so it is not caught by counting. It is a bookmark's title at the top of the
        // page — but so is a chapter's own heading on its first page. The head is the
        // smaller one, or the one repeated further down the page by the heading itself.
        if (isTopEdge(page, line)) {
          const title = titles.find((candidate) => namesTitle(line.t, candidate));
          if (
            title &&
            (line.s < size * 0.95 || page.lines.some((other) => other !== line && namesTitle(other.t, title)))
          )
            return false;
          // A head that sets the section and the chapter side by side reads as one line
          // ("4.1 示例文件 4 使用说明"): short, and holding a title plus something else.
          const flat = line.t.replace(/\s+/g, '').toLowerCase();
          const holdsTitle = titles.some((candidate) => {
            const t = candidate.replace(/\s+/g, '').toLowerCase();
            return t.length >= 2 && flat.includes(t) && flat.length > t.length + 1;
          });
          if (holdsTitle && flat.length <= 40 && line.s <= size * 1.02) return false;
        }
        return withText < 4 || (counts.get(key(line)) ?? 0) < threshold;
      }),
    };
  });
}

function isTopEdge(page: PdfPage, line: PdfLine): boolean {
  return page.lines.every((other) => other === line || other.y <= line.y);
}

/**
 * Which outline level makes the chapters: the top level, unless it is one entry
 * (the book's own title) wrapping everything, in which case the level below.
 */
function pickChapterLevel(outline: PdfOutlineEntry[]): number {
  const top = outline.filter((entry) => entry.level === 0).length;
  if (top >= 2) return 0;
  return outline.some((entry) => entry.level === 1) ? 1 : 0;
}

/**
 * The line a bookmark lands on. Its own title on its page wins: the height a
 * bookmark records is often a little below the heading it names (a typesetter's
 * anchor sits after the heading's top margin), and landing there would leave the
 * heading at the end of the previous chapter. Otherwise, the first line at or
 * below its height, on its page or the next one with text.
 */
function landing(pages: PdfPage[], entry: PdfOutlineEntry): { page: number; line: number; titled: boolean } | null {
  // Near its height when it has one: a running head repeating the title sits higher up.
  const own =
    pages[entry.page]?.lines.findIndex(
      (line) => namesTitle(line.t, entry.title) && (entry.top === null || line.y <= entry.top + line.s * 2),
    ) ?? -1;
  if (own >= 0) return { page: entry.page, line: own, titled: true };
  for (let page = entry.page; page < pages.length; page += 1) {
    const lines = pages[page]!.lines;
    if (!lines.length) continue;
    if (page === entry.page && entry.top !== null) {
      const index = lines.findIndex((line) => line.y <= entry.top! + line.s * 0.5);
      if (index >= 0) return { page, line: index, titled: false };
      continue;
    }
    return { page, line: 0, titled: false };
  }
  return null;
}

/** Whether a line is a bookmark's title, perhaps with its number in front ("2 Background", "第1章 …"). */
export function namesTitle(line: string, title: string): boolean {
  const a = line.replace(/\s+/g, '').toLowerCase(),
    b = title.replace(/\s+/g, '').toLowerCase();
  if (b.length < 2 || a.length > b.length + 8) return false;
  return a === b || (a.endsWith(b) && /^[\d.第章节部分卷篇ivxlcdm]+$/i.test(a.slice(0, a.length - b.length)));
}

/**
 * Where the page's text block starts and ends. The left edge is where most lines
 * start — not the leftmost, which a margin note or a hanging number would pull
 * out and make every ordinary line look indented.
 */
export function textBlock(page: PdfPage, body: number): { left: number; right: number } {
  const lines = page.lines.filter((line) => near(line.s, body));
  const source = lines.length ? lines : page.lines;
  const starts = new Map<number, number>();
  for (const line of source) starts.set(Math.round(line.x), (starts.get(Math.round(line.x)) ?? 0) + 1);
  let left = 0,
    seen = -1;
  for (const [x, count] of starts) if (count > seen || (count === seen && x < left)) [left, seen] = [x, count];
  const rights = source.map((line) => line.r).sort((a, b) => a - b);
  return { left, right: rights[Math.floor(rights.length * 0.9)] ?? page.w };
}

/**
 * Short notes in the margin beside the text block (a label, not part of the
 * sentence it sits next to). A note is narrow. When a line left of the block is
 * about as wide as the block itself, the page is set in two columns and those
 * lines are the other column, so nothing is dropped.
 */
function marginNotes(page: PdfPage, left: number, right: number): Set<PdfLine> {
  const width = Math.max(1, right - left);
  const outside = page.lines.filter((line) => line.r <= left + 1);
  if (outside.some((line) => line.r - line.x > width * 0.5)) return new Set();
  return new Set(outside.filter((line) => line.t.trim().length <= 24 && line.r - line.x < width * 0.3));
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= b * 0.12;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function weightedMedian(pairs: Array<[number, number]>): number {
  const sorted = pairs.filter(([, w]) => w > 0).sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((sum, [, w]) => sum + w, 0);
  let seen = 0;
  for (const [value, weight] of sorted) {
    seen += weight;
    if (seen >= total / 2) return value;
  }
  return 10;
}
