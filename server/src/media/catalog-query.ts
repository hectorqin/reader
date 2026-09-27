import type { MediaCatalog } from './catalog.ts';
import type { MediaActor } from './libraries.ts';
import type { MediaFolders } from './folders.ts';
import type { MediaUserState } from './user-state.ts';

export type CatalogQuery =
  | { method: 'librarySummaries'; args: Parameters<MediaCatalog['librarySummaries']> }
  | { method: 'list'; args: Parameters<MediaCatalog['list']> }
  | { method: 'browse'; args: Parameters<MediaCatalog['browse']> }
  | { method: 'search'; args: Parameters<MediaCatalog['search']> }
  | { method: 'detail'; args: Parameters<MediaCatalog['detail']> }
  | { method: 'folders'; args: Parameters<MediaFolders['list']> }
  | { method: 'file'; args: Parameters<MediaFolders['file']> }
  | { method: 'favorites'; args: Parameters<MediaUserState['favorites']> }
  | { method: 'history'; args: Parameters<MediaUserState['history']> };
type Results = {
  librarySummaries: ReturnType<MediaCatalog['librarySummaries']>;
  list: ReturnType<MediaCatalog['list']>;
  browse: ReturnType<MediaCatalog['browse']>;
  search: ReturnType<MediaCatalog['search']>;
  detail: ReturnType<MediaCatalog['detail']>;
  folders: ReturnType<MediaFolders['list']>;
  file: ReturnType<MediaFolders['file']>;
  favorites: ReturnType<MediaUserState['favorites']>;
  history: ReturnType<MediaUserState['history']>;
};
export type CatalogResult<Q extends CatalogQuery = CatalogQuery> = Results[Q['method']];
export interface CatalogReply<Q extends CatalogQuery = CatalogQuery> {
  id: number;
  result?: CatalogResult<Q>;
  /** All visible libraries, including those contributing only to the total. */
  access?: { actor: MediaActor; libraryIds: string[] };
  error?: { statusCode: number; code: string; message: string };
}

/** One dispatch table for workers, in-memory fixtures and benchmark controls. */
export function executeCatalogQuery(catalog: MediaCatalog, folders: MediaFolders, state: MediaUserState, query: CatalogQuery): CatalogResult {
  switch (query.method) {
    case 'librarySummaries': return catalog.librarySummaries(...query.args);
    case 'list': return catalog.list(...query.args);
    case 'browse': return catalog.browse(...query.args);
    case 'search': return catalog.search(...query.args);
    case 'detail': return catalog.detail(...query.args);
    case 'folders': return folders.list(...query.args);
    case 'file': return folders.file(...query.args);
    case 'favorites': return state.favorites(...query.args);
    case 'history': return state.history(...query.args);
  }
}
