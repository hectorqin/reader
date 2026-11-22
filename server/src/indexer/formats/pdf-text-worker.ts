import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { PDF_TEXT_VERSION, type PdfLine, type PdfOutlineEntry, type PdfText } from './pdf-text.ts';

/**
 * Reads a PDF's text layer and bookmarks with pdf.js, in its own thread
 * (`pdf-text-runner.ts`): a 600-page book takes seconds of CPU, and the server's
 * event loop must not wait on it. Only text is read — no page is drawn, so the
 * optional native canvas package pdf.js can use is never needed.
 */
const require = createRequire(import.meta.url);
const root = dirname(require.resolve('pdfjs-dist/package.json'));

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
  fontName: string;
}

/** What a font is for, as far as reading goes: code, mathematics, or text. */
type FontKind = 'mono' | 'math' | 'text';
const MONO_NAME =
  /mono|courier|cursor|consol|menlo|inconsolata|sourcecode|typewriter|cmtt|sftt|lmmono|dejavusansm|firacode|jetbrains/i;
/** CJK fonts are all fixed-pitch, so pdf.js's own monospace flag says nothing about them. */
const CJK_NAME =
  /song|hei|kai|fang|ming|mincho|gothic|cjk|sim|yahei|han|noto.*(sc|tc|jp|kr)|source.*(sc|tc|cn)|fandol|uming|ukai|wenquanyi|droid.*fallback/i;
const MATH_NAME = /math|(?:^|\+)(?:cmmi|cmsy|cmex|cmbsy|cmmib|msam|msbm|eufm|eusm|rsfs|esint|stmary|wasy)\d*|symbol/i;

async function extract(path: string): Promise<PdfText> {
  // pdf.js announces, on load, that it cannot draw without its optional canvas
  // package. Nothing is drawn here, so the warning is noise in the server log.
  const warn = console.warn;
  console.warn = () => undefined;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs').finally(() => {
    console.warn = warn;
  });
  const data = new Uint8Array(await readFile(path));
  const task = pdfjs.getDocument({
    data,
    // Keeps each font's real name, which is how code and mathematics are told apart from text.
    fontExtraProperties: true,
    // CJK text in CID fonts is only Unicode through these maps.
    cMapUrl: join(root, 'cmaps') + '/',
    cMapPacked: true,
    standardFontDataUrl: join(root, 'standard_fonts') + '/',
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const pdf = await task.promise;
  try {
    const pages: PdfText['pages'] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const view = page.getViewport({ scale: 1 });
      // The drawing operations first: they load the fonts, whose names the text needs.
      const operators = await page.getOperatorList();
      const content = await page.getTextContent();
      const kinds = new Map<string, FontKind>();
      const kindOf = (name: string): FontKind => {
        let kind = kinds.get(name);
        if (!kind) {
          const font = page.commonObjs.has(name) ? (page.commonObjs.get(name) as { name?: string }) : undefined;
          const real = font?.name ?? '';
          const family = (content.styles as Record<string, { fontFamily?: string }>)[name]?.fontFamily;
          kind = MATH_NAME.test(real)
            ? 'math'
            : MONO_NAME.test(real) || (family === 'monospace' && !CJK_NAME.test(real))
              ? 'mono'
              : 'text';
          kinds.set(name, kind);
        }
        return kind;
      };
      const graphics = drawn(operators, pdfjs.OPS as Record<string, number>, view.width * view.height);
      pages.push({
        w: view.width,
        h: view.height,
        lines: lines(
          content.items as TextItem[],
          kindOf,
          content.styles as Record<string, { ascent?: number; descent?: number }>,
        ),
        ...(graphics.length ? { g: graphics } : {}),
      });
      page.cleanup();
    }
    const outline: PdfOutlineEntry[] = [];
    const walk = async (items: Array<{ title: string; dest: unknown; items: unknown[] }> | null, level: number) => {
      for (const item of items ?? []) {
        const target = await destination(pdf, item.dest).catch(() => null);
        if (target) outline.push({ title: String(item.title ?? ''), level, ...target });
        await walk(item.items as typeof items, level + 1);
      }
    };
    await walk((await pdf.getOutline().catch(() => null)) as never, 0);
    return { version: PDF_TEXT_VERSION, pages, outline };
  } finally {
    await task.destroy();
  }
}

/** Text runs in content order, gathered into lines: a new line where the baseline moves or pdf.js says so. */
function lines(
  items: TextItem[],
  kindOf: (fontName: string) => FontKind,
  styles: Record<string, { ascent?: number; descent?: number }>,
): PdfLine[] {
  const out: PdfLine[] = [];
  let line: PdfLine | null = null;
  let mono = 0,
    math = 0,
    chars = 0;
  // Where the line's columns start (a gap of more than an em between runs), and its
  // runs set in a mathematics font: [first char, end char, x0, x1, bottom, top].
  let starts: number[] = [];
  let spans: Array<[number, number, number, number, number, number]> = [];
  // A line's size is the one most of its characters are set in: a word in a code
  // font or a footnote mark on the line must not make it look like a heading.
  let sizes = new Map<number, number>();
  const finish = () => {
    if (!line) return;
    let best = line.s,
      most = -1;
    for (const [size, count] of sizes) if (count > most) [best, most] = [size, count];
    line.s = best;
    // How much of the line is set in a code font, or a mathematics font (0–1, left out when none).
    if (chars && mono) line.m = Math.round((mono / chars) * 100) / 100;
    if (chars && math) line.f = Math.round((math / chars) * 100) / 100;
    line.hi = Math.round(line.hi! * 10) / 10;
    line.lo = Math.round(line.lo! * 10) / 10;
    const r = (v: number) => Math.round(v * 10) / 10;
    if (starts.length >= 2) line.c = starts.map(r);
    if (spans.length) line.ms = spans.map(([a, b, x0, x1, lo, hi]) => [a, b, r(x0), r(x1), r(lo), r(hi)]);
    out.push(line);
    line = null;
    sizes = new Map();
    mono = math = chars = 0;
    starts = [];
    spans = [];
  };
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const [a = 1, b = 0, c = 0, d = 1, x = 0, y = 0] = item.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b) || item.height || 10;
    // A run of spaces is a space, not ink: it must not stretch the line across a gap
    // between columns, or the columns could not be seen.
    if (item.str && !item.str.trim()) {
      if (line && !/\s$/.test(line.t)) line.t += ' ';
      if (item.hasEOL && line) finish();
      continue;
    }
    if (item.str) {
      // A superscript, a subscript or a fraction's parts sit off the baseline but on the line.
      if (line && (Math.abs(y - line.y) > Math.max(size, line.s) * 0.6 || x < line.x - size)) finish();
      const style = styles[item.fontName];
      const top = y + (style?.ascent ?? 0.85) * size,
        bottom = y + (style?.descent ?? -0.25) * size;
      let at = 0;
      if (!line) {
        line = { t: item.str, x, y, r: x + item.width, s: size, hi: top, lo: bottom };
        starts = [x];
      } else {
        const gap = x - line.r;
        const latin = /[\x21-\x7e]$/.test(line.t) && /^[\x21-\x7e]/.test(item.str);
        if (gap > Math.max(size, line.s) * 1.2) starts.push(x);
        line.t += gap > size * 0.25 && latin ? ' ' : '';
        at = line.t.length;
        line.t += item.str;
        line.r = Math.max(line.r, x + item.width);
        line.hi = Math.max(line.hi ?? top, top);
        line.lo = Math.min(line.lo ?? bottom, bottom);
      }
      if (kindOf(item.fontName) === 'math' && item.str.trim()) {
        const last = spans[spans.length - 1];
        // Runs of mathematics a thin space apart are one formula.
        if (last && x - last[3] < size * 0.6) {
          last[1] = at + item.str.length;
          // A combining mark (the bar of x̄) may come first but sit further right.
          last[2] = Math.min(last[2], x);
          last[3] = Math.max(last[3], x + item.width);
          last[4] = Math.min(last[4], bottom);
          last[5] = Math.max(last[5], top);
        } else spans.push([at, at + item.str.length, x, x + item.width, bottom, top]);
      }
      const rounded = Math.round(size * 10) / 10;
      sizes.set(rounded, (sizes.get(rounded) ?? 0) + item.str.length);
      const visible = item.str.replace(/\s+/g, '').length;
      const kind = kindOf(item.fontName);
      chars += visible;
      if (kind === 'mono') mono += visible;
      else if (kind === 'math') math += visible;
    }
    if (item.hasEOL && line) finish();
  }
  finish();
  return out.filter((entry) => entry.t.trim());
}

type Matrix = [number, number, number, number, number, number];
const multiply = (m: Matrix, n: number[]): Matrix => [
  m[0] * n[0]! + m[2] * n[1]!,
  m[1] * n[0]! + m[3] * n[1]!,
  m[0] * n[2]! + m[2] * n[3]!,
  m[1] * n[2]! + m[3] * n[3]!,
  m[0] * n[4]! + m[2] * n[5]! + m[4],
  m[1] * n[4]! + m[3] * n[5]! + m[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

/**
 * The boxes the page draws, in page units: images, embedded figures and painted
 * paths (a table's rules, a plot's lines, a code block's background). Painted in
 * white or covering the page, a shape is background, and left out.
 */
export function drawn(
  operators: { fnArray: number[]; argsArray: unknown[][] },
  OPS: Record<string, number>,
  pageArea: number,
): Array<[number, number, number, number, number]> {
  const out: Array<[number, number, number, number, number]> = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  let fill = '#000000';
  const box = (corners: Array<[number, number]>, kind: number) => {
    const xs = corners.map(([x]) => x),
      ys = corners.map(([, y]) => y);
    const x0 = Math.min(...xs),
      x1 = Math.max(...xs),
      y0 = Math.min(...ys),
      y1 = Math.max(...ys);
    if (!Number.isFinite(x0 + x1 + y0 + y1) || (x1 - x0) * (y1 - y0) > pageArea * 0.8) return;
    if (x1 - x0 < 1 && y1 - y0 < 1) return;
    const r = (v: number) => Math.round(v * 10) / 10;
    out.push([r(x0), r(y0), r(x1), r(y1), kind]);
  };
  const square = (m: Matrix) => [apply(m, 0, 0), apply(m, 1, 0), apply(m, 0, 1), apply(m, 1, 1)];
  const images = new Set(
    [
      'paintImageXObject',
      'paintInlineImageXObject',
      'paintImageMaskXObject',
      'paintImageXObjectRepeat',
      'paintSolidColorImageMask',
      'paintInlineImageXObjectGroup',
      'paintImageMaskXObjectGroup',
    ].map((name) => OPS[name]),
  );
  operators.fnArray.forEach((fn, index) => {
    const args = operators.argsArray[index] ?? [];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = multiply(ctm, args as number[]);
    else if (fn === OPS.setFillRGBColor) fill = String(args[0] ?? fill).toLowerCase();
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args[0]) || ArrayBuffer.isView(args[0]))
        ctm = multiply(ctm, Array.from(args[0] as ArrayLike<number>));
      const bbox = args[1] as ArrayLike<number> | null;
      if (bbox && bbox.length === 4)
        box(
          [
            apply(ctm, bbox[0]!, bbox[1]!),
            apply(ctm, bbox[2]!, bbox[1]!),
            apply(ctm, bbox[0]!, bbox[3]!),
            apply(ctm, bbox[2]!, bbox[3]!),
          ],
          1,
        );
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (images.has(fn)) box(square(ctm), 0);
    else if (fn === OPS.constructPath) {
      const paint = args[0] as number;
      const minMax = args[2] as ArrayLike<number> | undefined;
      // A clipping path is not drawn, and a white fill is a page's background.
      if (paint === OPS.endPath || !minMax || minMax.length < 4) return;
      const filled = paint === OPS.fill || paint === OPS.eoFill;
      if (filled && fill === '#ffffff') return;
      box(
        [
          apply(ctm, minMax[0]!, minMax[1]!),
          apply(ctm, minMax[2]!, minMax[1]!),
          apply(ctm, minMax[0]!, minMax[3]!),
          apply(ctm, minMax[2]!, minMax[3]!),
        ],
        filled ? 2 : 3,
      );
    }
  });
  return out;
}

async function destination(
  pdf: { getDestination(id: string): Promise<unknown[] | null>; getPageIndex(ref: unknown): Promise<number> },
  dest: unknown,
): Promise<{ page: number; top: number | null } | null> {
  const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
  if (!Array.isArray(explicit) || !explicit.length) return null;
  const target = explicit[0];
  const page = typeof target === 'number' ? target : await pdf.getPageIndex(target);
  const kind = (explicit[1] as { name?: string } | undefined)?.name;
  const top = kind === 'XYZ' ? explicit[3] : kind === 'FitH' || kind === 'FitBH' ? explicit[2] : null;
  return { page, top: typeof top === 'number' ? top : null };
}

const { path } = workerData as { path: string };
extract(path).then(
  (text) => parentPort!.postMessage({ text }),
  (error: unknown) => parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) }),
);
