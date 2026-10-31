import type { Detail, Item, MediaApi } from '../api/media-api.ts';

export const hasCover = (item: Item) => !!(item.metadata.coverRef || item.metadata.tmdbPosterPath || item.metadata.embeddedCoverAssetId || item.metadata.musicBrainzCoverGroupId);

/**
 * History rows point at the played item, which for a series is an episode titled "第 1 集".
 * Walk up to the work (series / album) and the nearest item that carries artwork.
 */
export async function resolveWork(api: MediaApi, itemId: string, signal?: AbortSignal): Promise<{ work: Detail; artwork: Detail | null }> {
  let detail = await api.detail(itemId, signal);
  let artwork: Detail | null = hasCover(detail) ? detail : null;
  for (let depth = 0; detail.parentId && depth < 3 && ['episode', 'season', 'track'].includes(detail.kind); depth++) {
    detail = await api.detail(detail.parentId, signal);
    if (!artwork && hasCover(detail)) artwork = detail;
  }
  return { work: detail, artwork };
}
