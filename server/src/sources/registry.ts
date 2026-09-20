import type {
  PluginManifest,
  SourceCapability,
  SourceDescriptor,
  SourceProvider,
  SourceRegistration,
} from './types.ts';

export class SourceRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceRegistryError';
  }
}

const ID_RE = /^[a-z][a-z0-9._-]{0,127}$/;
const CAPABILITIES = new Set<SourceCapability>([
  'browse', 'search', 'detail', 'acquire.file', 'acquire.chapters',
  'content.manifest', 'content.resource', 'content.update',
]);

function assertDescriptor(descriptor: SourceDescriptor): void {
  if (!ID_RE.test(descriptor.id)) throw new SourceRegistryError(`invalid source id: ${descriptor.id}`);
  if (!descriptor.label.trim()) throw new SourceRegistryError(`source ${descriptor.id} has an empty label`);
  if (!descriptor.version.trim()) throw new SourceRegistryError(`source ${descriptor.id} has no version`);
  const capabilities = new Set(descriptor.capabilities);
  for (const capability of capabilities) {
    if (!CAPABILITIES.has(capability)) throw new SourceRegistryError(`unsupported capability: ${capability}`);
  }
  if (capabilities.size !== descriptor.capabilities.length) {
    throw new SourceRegistryError(`source ${descriptor.id} declares duplicate capabilities`);
  }
}

function assertProvider(provider: SourceProvider): void {
  assertDescriptor(provider.descriptor);
  if (typeof provider.detail !== 'function') {
    throw new SourceRegistryError(`source ${provider.descriptor.id} must implement detail()`);
  }
  if (typeof provider.acquire !== 'function') {
    throw new SourceRegistryError(`source ${provider.descriptor.id} must implement acquire()`);
  }
  const caps = new Set(provider.descriptor.capabilities);
  const requireMethod = (capability: SourceCapability, method: keyof SourceProvider): void => {
    if (caps.has(capability) && typeof provider[method] !== 'function') {
      throw new SourceRegistryError(
        `source ${provider.descriptor.id} declares ${capability} but does not implement ${String(method)}()`,
      );
    }
  };
  requireMethod('browse', 'browse');
  requireMethod('search', 'search');
  requireMethod('content.manifest', 'getManifest');
  requireMethod('content.resource', 'readResource');
  requireMethod('content.update', 'getManifest');
  if (caps.has('acquire.chapters')) {
    if (typeof provider.getManifest !== 'function' || typeof provider.readResource !== 'function') {
      throw new SourceRegistryError(`source ${provider.descriptor.id} must implement chapter manifest and resources`);
    }
  }
  if (caps.has('acquire.file') && typeof provider.openFile !== 'function') {
    throw new SourceRegistryError(
      `source ${provider.descriptor.id} declares acquire.file but does not implement openFile()`,
    );
  }
}

/** Registry for built-in and installed source providers. */
export class SourceRegistry {
  private readonly registrations = new Map<string, SourceRegistration>();

  register(registration: SourceRegistration): SourceRegistration {
    assertProvider(registration.provider);
    if (!ID_RE.test(registration.pluginId)) {
      throw new SourceRegistryError(`invalid plugin id: ${registration.pluginId}`);
    }
    const key = this.key(registration.pluginId, registration.provider.descriptor.id);
    if (this.registrations.has(key)) {
      throw new SourceRegistryError(`source already registered: ${key}`);
    }
    this.registrations.set(key, registration);
    return registration;
  }

  registerBuiltin(pluginId: string, provider: SourceProvider): SourceRegistration {
    return this.register({ pluginId, provider, builtin: true });
  }

  unregister(pluginId: string, sourceType: string): boolean {
    return this.registrations.delete(this.key(pluginId, sourceType));
  }

  get(pluginId: string, sourceType: string): SourceRegistration | undefined {
    return this.registrations.get(this.key(pluginId, sourceType));
  }

  require(pluginId: string, sourceType: string): SourceRegistration {
    const registration = this.get(pluginId, sourceType);
    if (!registration) throw new SourceRegistryError(`source not found: ${pluginId}/${sourceType}`);
    return registration;
  }

  list(): readonly SourceRegistration[] {
    return [...this.registrations.values()];
  }

  listDescriptors(): readonly SourceDescriptor[] {
    return this.list().map(({ provider }) => provider.descriptor);
  }

  registerPluginManifest(manifest: PluginManifest, provider: SourceProvider): SourceRegistration {
    validatePluginManifest(manifest);
    const sourceType = manifest.sourceTypes.find((type) => type.id === provider.descriptor.id);
    if (!sourceType) {
      throw new SourceRegistryError(
        `plugin ${manifest.id} does not declare source type ${provider.descriptor.id}`,
      );
    }
    if (sourceType.capabilities.length !== provider.descriptor.capabilities.length ||
        sourceType.capabilities.some((capability) => !provider.descriptor.capabilities.includes(capability))) {
      throw new SourceRegistryError(`provider capabilities do not match plugin manifest: ${provider.descriptor.id}`);
    }
    return this.register({ pluginId: manifest.id, provider });
  }

  private key(pluginId: string, sourceType: string): string {
    return `${pluginId}/${sourceType}`;
  }
}

export function validatePluginManifest(input: unknown): PluginManifest {
  if (!input || typeof input !== 'object') throw new SourceRegistryError('plugin manifest must be an object');
  const value = input as Record<string, unknown>;
  const requiredString = (name: string): string => {
    const v = value[name];
    if (typeof v !== 'string' || !v.trim()) throw new SourceRegistryError(`plugin manifest ${name} is required`);
    return v;
  };
  const id = requiredString('id');
  if (!ID_RE.test(id)) throw new SourceRegistryError(`invalid plugin id: ${id}`);
  const manifest: PluginManifest = {
    id,
    name: requiredString('name'),
    version: requiredString('version'),
    apiVersion: value.apiVersion as number,
    runtime: value.runtime as 'node',
    entry: requiredString('entry'),
    sourceTypes: Array.isArray(value.sourceTypes) ? (value.sourceTypes as PluginManifest['sourceTypes']) : [],
    permissions: value.permissions as PluginManifest['permissions'],
  };
  if (manifest.apiVersion !== 1) {
    throw new SourceRegistryError('unsupported plugin API version; expected apiVersion: 1');
  }
  if (manifest.runtime !== 'node') throw new SourceRegistryError(`unsupported plugin runtime: ${manifest.runtime}`);
  if (manifest.sourceTypes.length === 0) throw new SourceRegistryError('plugin manifest must declare sourceTypes');
  const ids = new Set<string>();
  for (const type of manifest.sourceTypes) {
    if (!type || typeof type.id !== 'string' || !ID_RE.test(type.id)) {
      throw new SourceRegistryError('plugin source type has an invalid id');
    }
    if (ids.has(type.id)) throw new SourceRegistryError(`duplicate plugin source type: ${type.id}`);
    ids.add(type.id);
    if (typeof type.label !== 'string' || !type.label.trim() || !Array.isArray(type.capabilities)) {
      throw new SourceRegistryError(`invalid plugin source type: ${type.id}`);
    }
    assertDescriptor({ ...type, version: manifest.version });
    if (type.capabilities.includes('acquire.chapters') &&
        (!type.capabilities.includes('content.manifest') || !type.capabilities.includes('content.resource'))) {
      throw new SourceRegistryError(`chapter source ${type.id} must declare manifest and resource capabilities`);
    }
  }
  return manifest;
}

/** Descriptors reserved for the two providers shipped by the host. */
export const BUILTIN_SOURCE_TYPES = {
  local: {
    id: 'local',
    label: 'Local library',
    version: '1',
    capabilities: ['browse', 'search', 'detail'],
  } as const satisfies SourceDescriptor,
  opds: {
    id: 'opds',
    label: 'OPDS catalog',
    version: '1',
    capabilities: ['browse', 'search', 'detail', 'acquire.file'],
  } as const satisfies SourceDescriptor,
};
