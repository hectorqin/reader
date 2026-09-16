import { nullProvider, type MetadataProvider } from './types.ts';

/**
 * Provider registry.
 *
 * Registering a fallback chain here is the whole extension point: the indexer
 * asks the registry for a patch and never learns which source produced it.
 */
class ProviderRegistry {
  private readonly providers = new Map<string, MetadataProvider>();

  register(provider: MetadataProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): MetadataProvider | undefined {
    return this.providers.get(id);
  }

  active(): MetadataProvider[] {
    return [...this.providers.values()].filter((p) => p.enabled());
  }

  list(): Array<{ id: string; displayName: string; enabled: boolean }> {
    return [...this.providers.values()].map((p) => ({
      id: p.id,
      displayName: p.displayName,
      enabled: p.enabled(),
    }));
  }

  /** First provider in the chain that yields a patch wins. */
  async lookupFirst(query: Parameters<MetadataProvider['lookup']>[0]) {
    for (const provider of this.active()) {
      if (provider.id === 'none') continue;
      const result = await provider.lookup(query);
      if (result) return { provider: provider.id, result };
    }
    return null;
  }
}

export const providers = new ProviderRegistry();

providers.register(nullProvider);
