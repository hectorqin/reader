import { parentPort, workerData } from 'node:worker_threads';
import { MediaReadDatabase } from './read-database.ts';
import { MediaLibraries } from './libraries.ts';
import { MediaCatalog } from './catalog.ts';
import { MediaFolders } from './folders.ts';
import { MediaUserState } from './user-state.ts';
import { executeCatalogQuery } from './catalog-query.ts';
import { AppError } from '../lib/errors.ts';
import type { CatalogQuery, CatalogReply } from './catalog-query.ts';

const db = new MediaReadDatabase(workerData.path);
const libraries = new MediaLibraries(db, false);
const catalog = new MediaCatalog(db, libraries, false);
const folders = new MediaFolders(db, libraries, catalog);
const state = new MediaUserState(db, libraries, catalog, false);
parentPort!.on('message', ({ id, query }: { id: number; query: CatalogQuery }) => {
  let reply: CatalogReply;
  try {
    // Rows, effective metadata, total and access evidence share one WAL snapshot.
    reply = db.transaction(() => {
      const actor = query.args[0];
      const libraryIds = libraries.list(actor).map(library => library.id).sort();
      const result = executeCatalogQuery(catalog, folders, state, query);
      return { id, result, access: { actor, libraryIds } };
    });
  } catch (error) {
    reply = { id, error: error instanceof AppError
      ? { statusCode: error.statusCode, code: error.code, message: error.message }
      : { statusCode: 503, code: 'MEDIA_QUERY_FAILED', message: '影音目录查询暂不可用' } };
  }
  parentPort!.postMessage(reply);
});
