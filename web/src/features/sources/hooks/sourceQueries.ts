import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SourceInstance, SourcePlugin, SourceType } from '../../../api/sources.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';

export function useSourceTypes() {
  const { api } = useRuntime();
  return useQuery<SourceType[]>({ queryKey: ['source-types', api.baseUrl], queryFn: () => api.sourceTypes(), staleTime: 300_000 });
}

export function useSources() {
  const { api } = useRuntime();
  return useQuery<SourceInstance[]>({ queryKey: ['sources', api.baseUrl], queryFn: () => api.sources() });
}

export function usePlugins(enabled = true) {
  const { api } = useRuntime();
  return useQuery<SourcePlugin[]>({ queryKey: ['source-plugins', api.baseUrl], queryFn: () => api.plugins(), enabled });
}

export function useSourceMutations() {
  const { api } = useRuntime();
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: ['sources'] });
  const save = useMutation({ mutationFn: ({ id, input }: { id: string | null; input: Record<string, unknown> }) => api.saveSource(id, input), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => api.removeSource(id), onSuccess: invalidate });
  const credential = useMutation({ mutationFn: ({ id, key, value }: { id: string; key: string; value: string }) => api.sourceCredential(id, key, value), onSuccess: invalidate });
  const enablePlugin = useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.enablePlugin(id, enabled), onSuccess: () => client.invalidateQueries({ queryKey: ['source-plugins'] }) });
  const uninstallPlugin = useMutation({ mutationFn: (id: string) => api.uninstallPlugin(id), onSuccess: () => { void client.invalidateQueries({ queryKey: ['source-plugins'] }); void invalidate(); } });
  const installPlugin = useMutation({ mutationFn: (packageName: string) => api.installPlugin(packageName), onSuccess: () => { void client.invalidateQueries({ queryKey: ['source-plugins'] }); void invalidate(); } });
  const uploadPlugin = useMutation({ mutationFn: (file: File) => api.uploadPlugin(file), onSuccess: () => { void client.invalidateQueries({ queryKey: ['source-plugins'] }); void invalidate(); } });
  return { save, remove, credential, enablePlugin, uninstallPlugin, installPlugin, uploadPlugin };
}
