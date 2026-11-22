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
export const PDF_TEXT_VERSION = 4;

/** One line of text on a page, in PDF units (origin bottom-left). */
export interface PdfLine {
  /** Text. */
  t: string;
  /** Left edge, baseline, right edge, font size. */
  x: number;
  y: number;
  r: number;
  s: number;
  /** Share of the line set in a code font (0–1); absent when none. */
  m?: number;
  /** Share of the line set in a mathematics font (0–1); absent when none. */
  f?: number;
  /** The line's ink, top and bottom (ascenders, descenders, raised and lowered parts). */
  hi?: number;
  lo?: number;
}
/** A drawn box: x0, y0, x1, y1, and what drew it — 0 image, 1 embedded figure, 2 filled shape, 3 stroked line. */
export type PdfGraphic = [number, number, number, number, number];
export interface PdfPage {
  w: number;
  h: number;
  lines: PdfLine[];
  /** What the page draws besides text; absent when nothing. */
  g?: PdfGraphic[];
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
  // `row` is the line a run of split-off pieces belongs to: their shared baseline.
  let previous: { line: PdfLine; page: number; right: number; row: PdfLine } | null = null;
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
    // Figures, tables and formulas are drawn by the reader from the page itself; each
    // takes the place in the text of the first line it covers. Code stays text.
    const { regions, code } = findRegions(page, pageIndex + 1, body, left, right);
    const absorbed = new Set(regions.flatMap((region) => [...region.lines]));
    const at = new Map<number, PdfRegion[]>();
    const tail: PdfRegion[] = [];
    for (const region of regions) {
      if (region.anchor >= 0) at.set(region.anchor, [...(at.get(region.anchor) ?? []), region]);
      else tail.push(region);
    }
    const place = (region: PdfRegion) => {
      flush();
      chapter().blocks.push({
        kind: 'region',
        parts: [...pageMark(pageIndex + 1)],
        size: body,
        page: pageIndex + 1,
        region,
      });
      previous = null;
    };
    page.lines.forEach((line, lineIndex) => {
      const here = marks.get(`${pageIndex}:${lineIndex}`) ?? [];
      for (const region of at.get(lineIndex) ?? []) place(region);
      if (!here.length && (absorbed.has(line) || notes.has(line))) return;
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
      // A code block that runs on to the next page keeps its stragglers (a closing brace).
      const isCode = (code.has(line) || (open?.kind === 'code' && straggler(line))) && !heading;
      // A code block runs on line by line: its lines are short and indented on purpose.
      const continuesCode =
        open?.kind === 'code' && isCode && !here.length && !(prev && !newPage && prev.line.y - line.y > lineGap * 2.5);
      if (continuesCode) {
        if (newPage) open.parts.push(...pageMark(pageIndex + 1));
        open.code!.push(line);
        previous = { line, page: pageIndex, right, row: line };
        return;
      }
      // The rest of a line pdf.js split off (a raised or lowered part of an inline
      // formula) continues the line it sits beside, whatever its size or indent.
      const sameRow =
        prev !== null &&
        !newPage &&
        open?.kind === 'p' &&
        !isCode &&
        !here.length &&
        Math.abs(prev.row.y - line.y) < prev.row.s * 1.1 &&
        line.x >= prev.line.r - line.s;
      const breaks =
        !sameRow &&
        (open === null ||
          isCode ||
          open.kind === 'code' ||
          here.length > 0 ||
          heading !== (open.kind === 'h') ||
          Math.abs(line.s - open.size) > open.size * 0.12 ||
          (!newPage && prev !== null && prev.line.y - line.y > lineGap * 1.5) ||
          indented ||
          prevShort ||
          (heading && newPage));
      if (breaks) {
        flush();
        chapter();
        const anchors: Part[] = [];
        for (const mark of here) {
          const anchor = mark === opening ? '' : `pdf-toc-${mark.index}`;
          if (anchor) anchors.push({ anchor });
          placed.push({ index: mark.index, entry: mark.entry, chapter: chapters.length - 1, anchor });
        }
        current = isCode
          ? {
              kind: 'code',
              parts: [...anchors, ...pageMark(pageIndex + 1)],
              size: line.s,
              page: pageIndex + 1,
              code: [line],
            }
          : {
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
      previous = { line, page: pageIndex, right, row: sameRow ? prev!.row : line };
    });
    for (const region of tail) place(region);
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
  kind: 'p' | 'h' | 'code' | 'region';
  /** A code block's lines, kept apart so their indentation can be recovered. */
  code?: PdfLine[];
  region?: PdfRegion;
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
    const marks = block.parts
      .filter((part): part is { page: number } | { anchor: string } => typeof part !== 'string')
      .map((part) =>
        'page' in part
          ? `<span class="pdf-page" id="pdf-page-${part.page}" data-page="${part.page}"></span>`
          : `<span id="${part.anchor}"></span>`,
      )
      .join('');
    if (block.kind === 'region') {
      out.push(marks + regionHtml(block.region!));
      continue;
    }
    if (block.kind === 'code') {
      out.push(`${marks}<pre class="pdf-code"><code>${escapeHtml(codeText(block.code!))}</code></pre>`);
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
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title><style>${CHAPTER_STYLE}</style></head><body>${out.join('\n')}</body></html>`;
}

/**
 * How the reader shows what the server cannot: a figure, a table or a formula is a
 * placeholder the client fills by drawing that part of the page with PDF.js
 * (`data-page` and `data-box`, in page units). Its width and height are set now, so
 * the page is laid out once and does not move when the drawing arrives.
 */
const CHAPTER_STYLE = [
  'figure.pdf-region{margin:1em auto;max-width:100%}',
  'figure.pdf-region[data-kind="formula"]{margin:.5em auto}',
  'figure.pdf-region img{display:block;width:100%;height:auto;background:#fff;border-radius:2px}',
  'figure.pdf-region[data-state="unavailable"]::after{content:attr(data-unavailable);display:block;font-size:.85em;opacity:.7;text-align:center}',
  'pre.pdf-code{white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.86em;line-height:1.5;padding:.6em .8em;border-radius:4px;background:rgba(127,127,127,.12)}',
].join('');

const KIND_NAMES: Record<PdfRegion['kind'], string> = { figure: '插图', table: '表格', formula: '公式' };

function regionHtml(region: PdfRegion): string {
  const [x0, y0, x1, y1] = region.box;
  const label = `第 ${region.page} 页的${KIND_NAMES[region.kind]}${region.text ? `：${region.text.slice(0, 300)}` : ''}`;
  return (
    `<figure class="pdf-region" data-kind="${region.kind}" data-page="${region.page}" data-box="${x0},${y0},${x1},${y1}" style="width:${region.width}em">` +
    `<img alt="${escapeHtml(label)}" width="${Math.round((x1 - x0) * 2)}" height="${Math.round((y1 - y0) * 2)}"/></figure>`
  );
}

/** A code block's lines, indented as they were set: one space per half em of offset from the block's left. */
function codeText(lines: PdfLine[]): string {
  const left = Math.min(...lines.map((line) => line.x));
  return lines
    .map((line) => ' '.repeat(Math.max(0, Math.round((line.x - left) / (line.s * 0.5)))) + line.t.replace(/\s+$/, ''))
    .join('\n');
}

/** A figure, a table or a display formula: drawn from the page rather than read as text. */
export interface PdfRegion {
  kind: 'figure' | 'table' | 'formula';
  /** 1-based page. */
  page: number;
  /** x0, y0, x1, y1 in page units, origin bottom-left. */
  box: [number, number, number, number];
  /** The text inside, as a description. */
  text: string;
  /** Width in ems of the book's body text, so the drawing scales with the reader's font size. */
  width: number;
  /** The first line it covers (index on the page), where it goes in the text; -1 when it covers none. */
  anchor: number;
  lines: Set<PdfLine>;
}

type Box = [number, number, number, number];
const CAPTION = /^\s*(?:表|table|tab\.)\s*[\d一二三四五六七八九十ivxA-Z]/i;

/**
 * Where a page's figures, tables, formulas and code are.
 *
 * - **Figures**: images, embedded figures and drawn shapes, merged where they touch.
 *   A shape behind code lines is a code block's background, not a figure; a shape
 *   behind most of the page's text is the page's background.
 * - **Tables**: horizontal rules of the same width, one under another — a three-line
 *   table has three, a ruled one more. A caption between two such rules starts a
 *   new table.
 * - **Formulas**: lines set mostly in a mathematics font and standing apart from
 *   the text (indented, centred or short), with the fraction bars beside them.
 * - **Code**: lines set mostly in a code font. They stay text.
 */
export function findRegions(
  page: PdfPage,
  pageNumber: number,
  body: number,
  left: number,
  right: number,
): { regions: PdfRegion[]; code: Set<PdfLine> } {
  // Code is judged by the run, not the line: a listing's line numbers and a lone
  // closing brace are set in a text font, and a sentence that names a file in a code
  // font is still a sentence. A run of lines partly in a code font is code when, on
  // average, most of it is; a lone line only when nearly all of it is.
  const code = new Set<PdfLine>();
  const codeish = (line: PdfLine) => line.s <= body * 1.3 && ((line.m ?? 0) >= 0.6 || straggler(line));
  let runStart = 0;
  page.lines.forEach((line, index) => {
    const next = page.lines[index + 1];
    const continues =
      next && codeish(line) && codeish(next) && Math.abs(line.y - next.y) <= Math.max(line.s, next.s) * 3;
    if (continues) return;
    const run = page.lines.slice(runStart, index + 1).filter(codeish);
    const mean = run.reduce((sum, item) => sum + (item.m ?? 0), 0) / Math.max(1, run.length);
    if (run.length && mean >= 0.6 && (run.length >= 2 || (run[0]!.m ?? 0) >= 0.85))
      for (const item of run) code.add(item);
    runStart = index + 1;
  });
  const graphics = page.g ?? [];
  const width = (b: Box) => b[2] - b[0],
    height = (b: Box) => b[3] - b[1],
    area = (b: Box) => width(b) * height(b);
  const ruleH = (b: number[]) => b[3]! - b[1]! < 2 && b[2]! - b[0]! >= 20;
  const ruleV = (b: number[]) => b[2]! - b[0]! < 2 && b[3]! - b[1]! >= 20;
  const pageArea = page.w * page.h;
  const inside = (line: PdfLine, b: Box) =>
    line.y >= b[1] - 1 && line.y <= b[3] + 1 && (line.x + line.r) / 2 >= b[0] - 2 && (line.x + line.r) / 2 <= b[2] + 2;

  // Figures.
  const shapes: Box[] = graphics
    .filter((g) => !ruleH(g) && !ruleV(g) && (g[4] <= 1 || (g[2] - g[0] >= 4 && g[3] - g[1] >= 4)))
    .map((g) => [g[0], g[1], g[2], g[3]]);
  const figures = merge(shapes, 8).filter((b) => {
    const covered = page.lines.filter((line) => inside(line, b));
    // A shaded box behind code is the code block's background: every line on it is code
    // (a comment in another script included), and the box is not a figure.
    if (covered.length && covered.some((line) => (line.m ?? 0) >= 0.6 && line.s <= body * 1.3)) {
      const share = covered.filter((line) => (line.m ?? 0) >= 0.6 && line.s <= body * 1.3).length / covered.length;
      if (share >= 0.5) {
        for (const line of covered) code.add(line);
        return false;
      }
    }
    if (width(b) < 12 || height(b) < 12 || area(b) < 400) return false;
    return !(area(b) > pageArea * 0.7 && covered.length > 5);
  });

  // Tables.
  const rules = graphics
    .filter(ruleH)
    .filter((g) => !figures.some((b) => g[1] >= b[1] - 2 && g[1] <= b[3] + 2 && g[0] >= b[0] - 2 && g[2] <= b[2] + 2))
    .sort((a, b) => b[1] - a[1]);
  const groups: number[][][] = [];
  for (const rule of rules) {
    const group = groups[groups.length - 1];
    const last = group?.[group.length - 1];
    const captionBetween =
      last && page.lines.some((line) => line.y < last[1]! && line.y > rule[1]! && CAPTION.test(line.t));
    if (
      group &&
      last &&
      Math.abs(last[0]! - rule[0]!) < 6 &&
      Math.abs(last[2]! - rule[2]!) < 6 &&
      last[1]! - rule[1]! <= 400 &&
      !captionBetween
    )
      group.push(rule);
    else groups.push([rule]);
  }
  const tables: Box[] = groups
    .filter((group) => group.length >= 2)
    .map((group): Box => [
      Math.min(...group.map((g) => g[0]!)) - 2,
      group[group.length - 1]![1]! - 2,
      Math.max(...group.map((g) => g[2]!)) + 2,
      group[0]![1]! + 2,
    ])
    .filter((b) => page.lines.some((line) => line.y > b[1] && line.y < b[3]));

  const regions: PdfRegion[] = [];
  const add = (kind: PdfRegion['kind'], box: Box, lines: PdfLine[]) => {
    const order = new Map(page.lines.map((line, index) => [line, index]));
    const sorted = [...lines].sort((a, b) => order.get(a)! - order.get(b)!);
    let anchor = sorted.length ? order.get(sorted[0]!)! : -1;
    // Nothing of the text inside (a photograph): it goes before the first line below it.
    if (anchor < 0) anchor = page.lines.findIndex((line) => line.y < box[1]);
    const r = (v: number) => Math.round(v * 10) / 10;
    regions.push({
      kind,
      page: pageNumber,
      box: [r(box[0]), r(box[1]), r(box[2]), r(box[3])],
      text: sorted.map((line) => line.t.trim()).join(' '),
      width: Math.round((width(box) / Math.max(1, body)) * 100) / 100,
      anchor,
      lines: new Set(sorted),
    });
  };
  for (const box of figures)
    add(
      'figure',
      box,
      page.lines.filter((line) => inside(line, box)),
    );
  for (const box of tables)
    add(
      'table',
      box,
      page.lines.filter((line) => inside(line, box) && !regions.some((region) => region.lines.has(line))),
    );

  // Formulas.
  const taken = new Set(regions.flatMap((region) => [...region.lines]));
  // A display formula has its line to itself: the raised tail of an inline formula
  // shares its baseline with the sentence it is part of.
  const alone = (line: PdfLine) =>
    !page.lines.some(
      (other) =>
        other !== line &&
        (other.f ?? 0) < 0.5 &&
        !code.has(other) &&
        Math.abs(other.y - line.y) < Math.max(other.s, line.s) * 0.6 &&
        (other.r < line.x + line.s || other.x > line.r - line.s) &&
        other.t.trim().length > 3,
    );
  const display = page.lines.filter(
    (line) =>
      !taken.has(line) &&
      !code.has(line) &&
      (line.f ?? 0) >= 0.5 &&
      (line.x > left + line.s || line.r - line.x < (right - left) * 0.85) &&
      alone(line),
  );
  const runs: PdfLine[][] = [];
  for (const line of [...display].sort((a, b) => b.y - a.y)) {
    const run = runs[runs.length - 1];
    const last = run?.[run.length - 1];
    if (run && last && last.y - line.y <= Math.max(last.s, line.s) * 2.6) run.push(line);
    else runs.push([line]);
  }
  for (const run of runs) {
    const box: Box = [
      Math.min(...run.map((line) => line.x)),
      Math.min(...run.map((line) => line.lo ?? line.y - line.s * 0.25)),
      Math.max(...run.map((line) => line.r)),
      Math.max(...run.map((line) => line.hi ?? line.y + line.s * 0.85)),
    ];
    // Fraction bars and radicals drawn beside the symbols belong to the formula.
    for (const g of graphics)
      if (ruleH(g) || (g[3] - g[1] < 2 && g[2] - g[0] >= 2))
        if (g[1] >= box[1] - 2 && g[1] <= box[3] + 2 && g[2] >= box[0] - 2 && g[0] <= box[2] + 2) {
          box[0] = Math.min(box[0], g[0]);
          box[2] = Math.max(box[2], g[2]);
        }
    const padded: Box = [box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2];
    // An operator set in a text font ("lim", "max") inside the formula's box, or just
    // beside it on its baseline, is part of it.
    const within = page.lines.filter(
      (line) =>
        !taken.has(line) &&
        !run.includes(line) &&
        line.y >= padded[1] &&
        line.y <= padded[3] &&
        ((line.x >= padded[0] - 1 && line.r <= padded[2] + 1) ||
          (line.t.trim().length <= 6 && line.r >= padded[0] - line.s && line.x <= padded[2] + line.s)),
    );
    for (const line of within) {
      padded[0] = Math.min(padded[0], line.x - 2);
      padded[2] = Math.max(padded[2], line.r + 2);
      padded[1] = Math.min(padded[1], (line.lo ?? line.y - line.s * 0.25) - 2);
      padded[3] = Math.max(padded[3], (line.hi ?? line.y + line.s * 0.85) + 2);
    }
    add('formula', padded, [...run, ...within]);
  }
  return { regions, code };
}

/** A short line partly in a code font — a listing's closing brace with its line number. */
function straggler(line: PdfLine): boolean {
  const flat = line.t.replace(/\s+/g, '');
  return ((line.m ?? 0) >= 0.25 && flat.length <= 12) || ((line.m ?? 0) > 0 && /^\d{0,5}[{}()[\];,%]+$/.test(flat));
}

/** Boxes merged where they overlap or come within `gap` of each other. */
function merge(boxes: Box[], gap: number): Box[] {
  const out = boxes.map((b): Box => [...b]);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length; i += 1)
      for (let j = i + 1; j < out.length; j += 1) {
        const a = out[i]!,
          b = out[j]!;
        if (a[0] - gap <= b[2] && b[0] - gap <= a[2] && a[1] - gap <= b[3] && b[1] - gap <= a[3]) {
          out[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
          out.splice(j, 1);
          changed = true;
          j -= 1;
        }
      }
  }
  return out;
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
