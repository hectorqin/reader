import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDF_TEXT_VERSION, type PdfText } from './pdf-text.ts';

/**
 * Runs the text extraction for a PDF and keeps the result.
 *
 * - **One at a time.** Extraction is all CPU; two big books at once would only
 *   make both slower and starve the requests that are just turning pages.
 * - **Shared.** A second request for the same book while it is being read waits
 *   for the same work instead of starting it again.
 * - **Kept.** The result is written to DATA_DIR (`derived/pdf-text/`), keyed by
 *   the file's path, size and modification time and by the extractor version, so
 *   a restart does not redo it and a changed file or a smarter extractor does.
 * - **Bounded.** A pathological file is stopped after `TIME_LIMIT_MS`.
 */
const TIME_LIMIT_MS = 5 * 60 * 1000;
const MEMORY_SIZE = 4;

const inFlight = new Map<string, Promise<PdfText>>();
const memory = new Map<string, PdfText>();
let queue: Promise<unknown> = Promise.resolve();

export async function pdfTextFor(absPath: string, cacheDir?: string): Promise<{ key: string; text: PdfText }> {
  const info = await stat(absPath);
  const key = createHash('sha1')
    .update(`${PDF_TEXT_VERSION}\0${absPath}\0${info.size}\0${info.mtimeMs}`)
    .digest('hex')
    .slice(0, 24);
  const kept = memory.get(key);
  if (kept) return { key, text: kept };
  let pending = inFlight.get(key);
  if (!pending) {
    pending = load(absPath, key, cacheDir).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  const text = await pending;
  memory.set(key, text);
  while (memory.size > MEMORY_SIZE) memory.delete(memory.keys().next().value!);
  return { key, text };
}

async function load(absPath: string, key: string, cacheDir?: string): Promise<PdfText> {
  const file = cacheDir ? join(cacheDir, 'pdf-text', `${key}.json`) : null;
  if (file) {
    try {
      const cached = JSON.parse(await readFile(file, 'utf8')) as PdfText;
      if (cached.version === PDF_TEXT_VERSION) return cached;
    } catch {
      /* not cached yet */
    }
  }
  const run = queue.then(() => extractInWorker(absPath));
  queue = run.catch(() => undefined);
  const text = await run;
  if (file) {
    await mkdir(join(cacheDir!, 'pdf-text'), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(text));
    await rename(temporary, file);
  }
  return text;
}

function extractInWorker(path: string): Promise<PdfText> {
  const source = import.meta.url.endsWith('.ts');
  const url = new URL(source ? './pdf-text-worker.ts' : './pdf-text-worker.js', import.meta.url);
  const worker = source
    ? new Worker(
        `import(${JSON.stringify(import.meta.resolve('tsx/esm/api'))}).then(({tsImport}) => tsImport(${JSON.stringify(url.href)}, ${JSON.stringify(import.meta.url)}))`,
        { eval: true, workerData: { path } },
      )
    : new Worker(url, { workerData: { path } });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error('PDF 文字提取超时'));
    }, TIME_LIMIT_MS);
    worker.once('message', (message: { text?: PdfText; error?: string }) => {
      clearTimeout(timer);
      void worker.terminate();
      if (message.text) resolve(message.text);
      else reject(new Error(message.error ?? 'PDF 文字提取失败'));
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`PDF 文字提取中断（${code}）`));
    });
  });
}
