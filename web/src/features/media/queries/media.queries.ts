import { queryOptions, useQuery } from '@tanstack/react-query';
import type { AppRuntime } from '../../../app/runtime.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import type { Detail, Item, MediaChannel, Part, ScanJob, AiScanJob } from '../api/media-api.ts';

export interface Activity {
  id: string; itemId: string; partId: string; assetId: string; libraryId: string;
  title: string; partTitle: string; editionLabel?: string; start: number; end: number | null;
  available: number; position?: number; updatedAt?: number; completed?: boolean;
}
function scope(runtime: AppRuntime) { return ['media', runtime.mediaApi.preferenceScope()] as const; }
export const mediaKeys = {
  root: scope,
  detail: (runtime: AppRuntime, id: string) => [...scope(runtime), 'detail', id] as const,
};
export function librariesQuery(runtime: AppRuntime) {
  return queryOptions({ queryKey: [...scope(runtime), 'libraries'], queryFn: ({ signal }) => runtime.mediaApi.libraries(signal) });
}
export function detailQuery(runtime: AppRuntime, id: string) {
  return queryOptions({ queryKey: mediaKeys.detail(runtime, id), queryFn: ({ signal }) => runtime.mediaApi.detail(id, signal) });
}
export const useMediaDetail = (id: string) => useQuery(detailQuery(useRuntime(), id));
export const useMediaLibraries = () => useQuery(librariesQuery(useRuntime()));
export function catalogQuery(runtime: AppRuntime, channel: MediaChannel, kind: string, params: URLSearchParams) {
  const library = params.get('library') ?? '', offset = Math.max(0, Number(params.get('offset')) || 0);
  const search = params.get('q') ?? '', sort = params.get('sort') ?? 'default';
  const filters = { artist: params.get('artist') ?? '', album: params.get('album') ?? '' };
  return queryOptions({
    queryKey: [...scope(runtime), 'catalog', channel, kind, library, offset, search, sort, filters],
    queryFn: ({ signal }) => library
      ? runtime.mediaApi.items(library, kind, search, offset, signal, sort, filters)
      : runtime.mediaApi.browse(channel, kind, offset, signal, sort, filters),
  });
}
export function searchQuery(runtime: AppRuntime, params: URLSearchParams) {
  const text = params.get('q') ?? '', channel = params.get('scope') ?? 'all', offset = Math.max(0, Number(params.get('offset')) || 0);
  const scopeChannel: MediaChannel | 'all' = channel === 'video' || channel === 'music' || channel === 'audiobook' ? channel : 'all';
  return queryOptions({ queryKey: [...scope(runtime), 'search', text, scopeChannel, offset], queryFn: ({ signal }) => runtime.mediaApi.search(text, scopeChannel, offset, signal), enabled: !!text });
}
export function favoritesQuery(runtime: AppRuntime, params: URLSearchParams) {
  const channel = params.get('scope') ?? 'all', offset = Math.max(0, Number(params.get('offset')) || 0);
  const query = new URLSearchParams({ offset: String(offset), limit: '60' });
  if (channel !== 'all') query.set('channel', channel);
  return queryOptions({ queryKey: [...scope(runtime), 'favorites', channel, offset], queryFn: ({ signal }) => runtime.mediaApi.request<{ items: Item[]; total: number }>('favorites?' + query, 'GET', undefined, signal) });
}
export function historyQuery(runtime: AppRuntime, channel: MediaChannel, params: URLSearchParams) {
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  return queryOptions({ queryKey: [...scope(runtime), 'history', channel, offset], queryFn: ({ signal }) => runtime.mediaApi.request<{ items: Activity[]; total: number }>(`history?channel=${channel}&offset=${offset}&limit=60`, 'GET', undefined, signal) });
}
export function queueQuery(runtime: AppRuntime) {
  return queryOptions({ queryKey: [...scope(runtime), 'queue'], queryFn: ({ signal }) => runtime.mediaApi.request<{ items: Activity[] }>('queue', 'GET', undefined, signal) });
}
export function jobsQuery(runtime: AppRuntime, libraryId = '') {
  const path = libraryId
    ? `libraries/${encodeURIComponent(libraryId)}/jobs`
    : 'scan-jobs';
  return queryOptions({
    queryKey: [...scope(runtime), 'jobs', libraryId],
    queryFn: ({ signal }) => runtime.mediaApi.request<{ items: ScanJob[] }>(path, 'GET', undefined, signal),
    refetchInterval: 5000,
  });
}
export function aiJobsQuery(runtime: AppRuntime, libraryId = '') {
  return queryOptions({
    queryKey: [...scope(runtime), 'ai-jobs', libraryId],
    queryFn: () => runtime.mediaApi.aiScanJobs(libraryId || undefined),
    refetchInterval: 5000,
  });
}
export function useMediaPlayback() {
  const { player } = useRuntime();
  return (parts: Part[], index: number, title: string, channel: MediaChannel) => player.play(parts.map(part => ({ part, title, video: channel === 'video' })), index);
}
export type { Detail, AiScanJob };
