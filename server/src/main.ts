import { loadConfig } from './config/index.ts';
import { openDatabase } from './db/index.ts';
import { Scanner } from './indexer/scanner.ts';
import { UserService } from './services/users.ts';
import { ShelfService } from './services/shelf.ts';
import { SyncService } from './services/sync.ts';
import { TtsService } from './services/tts.ts';
import { buildApp } from './http/app.ts';
import { setLogger } from './lib/log.ts';
import type { AppContext } from './http/context.ts';

interface Schedulers {
  scanTimer: NodeJS.Timeout | undefined;
  watchTimer: NodeJS.Timeout | undefined;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config);

  // Two-phase wiring: services log through the app logger, so the app is
  // created first with a placeholder context and completed immediately after.
  const ctx = {
    config,
    db,
    scanner: undefined,
    users: undefined,
    shelf: undefined,
    sync: undefined,
    log: undefined,
  } as unknown as AppContext;

  const app = buildApp(ctx);
  ctx.log = app.log;
  // Code that runs outside a request (the scanner, the format parsers) has no
  // request to borrow a logger from, so it gets the app's.
  setLogger({
    warn: (context, message) => app.log.warn(context, message),
    info: (context, message) => app.log.info(context, message),
    error: (context, message) => app.log.error(context, message),
  });
  ctx.scanner = new Scanner(db, config, {
    info: (o, m) => app.log.info(o as object, m),
    warn: (o, m) => app.log.warn(o as object, m),
  });
  ctx.users = new UserService(db, config);
  ctx.shelf = new ShelfService(db);
  ctx.sync = new SyncService(db);
  ctx.tts = new TtsService(config);

  app.log.info({ booksDir: config.booksDir, dataDir: config.dataDir }, 'starting reader server');

  const scheduler = startSchedulers(ctx, app.log);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    if (scheduler.scanTimer) clearInterval(scheduler.scanTimer);
    if (scheduler.watchTimer) clearInterval(scheduler.watchTimer);
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });

  if (ctx.users.count() === 0) {
    app.log.warn('no accounts exist yet; the first registration becomes the admin');
  }
}

function startSchedulers(ctx: AppContext, log: AppContext['log']): Schedulers {
  const runScan = async (): Promise<void> => {
    try {
      await ctx.scanner.scan();
    } catch (err) {
      log.error({ err }, 'scheduled scan failed');
    }
  };

  // A scan at boot makes the library available immediately after a restart.
  void runScan();

  // The watch poller is the same code path as the interval scan; the mtime+size
  // fast path makes it cheap enough to run every minute (see Scanner.indexFile).
  const scanTimer = ctx.config.scanInterval > 0
    ? setInterval(() => void runScan(), ctx.config.scanInterval * 1000)
    : undefined;
  scanTimer?.unref();

  const watchTimer = ctx.config.watchInterval > 0
    ? setInterval(() => void runScan(), ctx.config.watchInterval * 1000)
    : undefined;
  watchTimer?.unref();

  return { scanTimer, watchTimer };
}

main().catch((err: unknown) => {
  console.error('fatal:', err);
  process.exit(1);
});
