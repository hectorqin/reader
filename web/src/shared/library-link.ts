/**
 * 书库 is the local library inside 发现 (docs/ui.md §3.4.1): one place to browse
 * every source, the server's own books included. `local` names the built-in source.
 */
export const LIBRARY_PATH = '/sources?tab=explore&source=local';

/** 搜书 over the local library, already searching for `query`. */
export const librarySearchPath = (query: string) => `/sources?source=local&q=${encodeURIComponent(query)}`;
