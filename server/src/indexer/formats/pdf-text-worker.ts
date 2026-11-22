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
}

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
      const content = await page.getTextContent();
      pages.push({ w: view.width, h: view.height, lines: lines(content.items as TextItem[]) });
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
function lines(items: TextItem[]): PdfLine[] {
  const out: PdfLine[] = [];
  let line: PdfLine | null = null;
  // A line's size is the one most of its characters are set in: a word in a code
  // font or a footnote mark on the line must not make it look like a heading.
  let sizes = new Map<number, number>();
  const finish = () => {
    if (!line) return;
    let best = line.s,
      most = -1;
    for (const [size, count] of sizes) if (count > most) [best, most] = [size, count];
    line.s = best;
    out.push(line);
    line = null;
    sizes = new Map();
  };
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const [a = 1, b = 0, c = 0, d = 1, x = 0, y = 0] = item.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b) || item.height || 10;
    if (item.str) {
      if (line && (Math.abs(y - line.y) > size * 0.5 || x < line.x - size)) finish();
      if (!line) line = { t: item.str, x, y, r: x + item.width, s: size };
      else {
        const gap = x - line.r;
        const latin = /[\x21-\x7e]$/.test(line.t) && /^[\x21-\x7e]/.test(item.str);
        line.t += (gap > size * 0.25 && latin ? ' ' : '') + item.str;
        line.r = Math.max(line.r, x + item.width);
      }
      const rounded = Math.round(size * 10) / 10;
      sizes.set(rounded, (sizes.get(rounded) ?? 0) + item.str.length);
    }
    if (item.hasEOL && line) finish();
  }
  finish();
  return out.filter((entry) => entry.t.trim());
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
