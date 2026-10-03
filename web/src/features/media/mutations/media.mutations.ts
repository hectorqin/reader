import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { mediaKeys } from '../queries/media.queries.ts';
import type { Detail } from '../api/media-api.ts';

export function useMediaRequest() {
  const runtime = useRuntime(), queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, method = 'POST', body }: { path: string; method?: string; body?: unknown }) => runtime.mediaApi.request(path, method, body),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: mediaKeys.root(runtime) }); },
  });
}
export function useMediaDetailUpdate() {
  const runtime = useRuntime(), queryClient = useQueryClient();
  return (detail: Detail) => {
    queryClient.setQueryData(mediaKeys.detail(runtime, detail.id), detail);
    void queryClient.invalidateQueries({ queryKey: mediaKeys.root(runtime) });
  };
}
