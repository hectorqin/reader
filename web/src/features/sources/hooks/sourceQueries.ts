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
  // A saved credential also changes that source's credential status (configured, and the
  // access state the server resets), so 书源登录 must not reopen on the cached one.
  const credential = useMutation({ mutationFn: ({ id, key, value }: { id: string; key: string; value: string }) => api.sourceCredential(id, key, value), onSuccess: (_result, { id }) => Promise.all([invalidate(), client.invalidateQueries({ queryKey: ['source-credentials', api.baseUrl, id] })]) });
  // A plugin brings its source types with it: installing, upgrading, enabling or removing
  // one changes what 添加书源 can offer, so the (long-lived) type list is refetched too.
  const pluginsChanged = () => Promise.all([
    client.invalidateQueries({ queryKey: ['source-plugins'] }),
    client.invalidateQueries({ queryKey: ['source-types'] }),
    invalidate(),
  ]);
  const enablePlugin = useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.enablePlugin(id, enabled), onSuccess: pluginsChanged });
  const uninstallPlugin = useMutation({ mutationFn: (id: string) => api.uninstallPlugin(id), onSuccess: () => { void pluginsChanged(); } });
  const installPlugin = useMutation({ mutationFn: (packageName: string) => api.installPlugin(packageName), onSuccess: () => { void pluginsChanged(); } });
  const uploadPlugin = useMutation({ mutationFn: (file: File) => api.uploadPlugin(file), onSuccess: () => { void pluginsChanged(); } });
  return { save, remove, credential, enablePlugin, uninstallPlugin, installPlugin, uploadPlugin };
}
