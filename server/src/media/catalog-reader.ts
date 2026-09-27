import { Worker } from 'node:worker_threads';
import { AppError } from '../lib/errors.ts';
import type { CatalogQuery, CatalogReply } from './catalog-query.ts';

/** One bounded read worker per server; never silently falls back to blocking SQL. */
export class MediaCatalogReader {
  private worker?: Worker;
  private nextId = 0;
  private closed = false;
  private readonly pending = new Map<number, {
    resolve: (reply: CatalogReply) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(private readonly path: string) {}

  query<Q extends CatalogQuery>(query: Q): Promise<CatalogReply<Q>>;
  query(query: CatalogQuery): Promise<CatalogReply> {
    if (this.closed) return Promise.reject(this.unavailable());
    if (this.pending.size >= 16) return Promise.reject(new AppError(503, 'MEDIA_QUERY_BUSY', '影音目录繁忙，请稍后重试'));
    const worker = this.worker ?? this.start();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(worker), 30000);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, query });
    });
  }

  private start(): Worker {
    const source = import.meta.url.endsWith('.ts');
    const url = new URL(source ? './catalog-worker.ts' : './catalog-worker.js', import.meta.url);
    const worker = source
      ? new Worker(`import(${JSON.stringify(import.meta.resolve('tsx/esm/api'))}).then(({tsImport}) => tsImport(${JSON.stringify(url.href)}, ${JSON.stringify(import.meta.url)}))`, { eval: true, workerData: { path: this.path } })
      : new Worker(url, { workerData: { path: this.path } });
    this.worker = worker;
    worker.on('message', (reply: CatalogReply) => {
      const request = this.pending.get(reply.id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(reply.id);
      if (reply.error) request.reject(new AppError(reply.error.statusCode, reply.error.code, reply.error.message));
      else request.resolve(reply);
    });
    worker.on('error', () => this.fail(worker));
    worker.on('exit', () => this.fail(worker));
    return worker;
  }

  private unavailable(): AppError { return new AppError(503, 'MEDIA_QUERY_FAILED', '影音目录查询暂不可用'); }

  private fail(worker: Worker): void {
    if (this.worker !== worker) return;
    this.worker = undefined;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(this.unavailable());
    }
    this.pending.clear();
    void worker.terminate();
  }

  async close(): Promise<void> {
    this.closed = true;
    const worker = this.worker;
    if (worker) {
      this.fail(worker);
      await worker.terminate();
    }
  }
}
