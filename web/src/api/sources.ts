export interface SourceType {
  id: string; pluginId: string; label: string; version: string; builtin: boolean; capabilities: string[];
  configSchema?: { properties?: Record<string, { type?: string; title?: string; default?: unknown }>; required?: string[] };
  credentialKeys?: Array<{ key: string; label: string }>;
}
export interface SourceInstance {
  id: string; pluginId: string; sourceType: string; name: string; enabled: boolean;
  config?: Record<string, unknown>; descriptor: SourceType | null;
}
export interface SourceEntry {
  ref: string; title: string; authors?: string[]; description?: string;
  options?: Array<{ id: string; label: string; available?: boolean }>;
}
export interface SourcePage {
  items: SourceEntry[]; navigation?: Array<{ ref: string; title: string }>; nextCursor?: string; title?: string;
}
export interface SourceAcquisition {
  kind: 'ready' | 'action-required'; publicationId?: string;
  action?: { label: string; url?: string };
}
export interface SourcePlugin {
  extensions?: { pages?: Array<{ id: string; title: string }> };
  pluginId: string; builtin: boolean; name?: string; version?: string; folder?: string; enabled: boolean;
  runtime?: { state: string } | null; error?: { code: string; message: string };
}
export interface ChapterSubscription {
  bookId: string; title: string; enabled: boolean; intervalMinutes: number;
  nextCheckAt: number; lastCheckAt: number | null; lastSuccessAt: number | null;
  lastError: string | null; newChapters: number;
}

export interface ExtensionField {
  key: string; label: string; type: 'text' | 'textarea' | 'number' | 'boolean' | 'select'; required?: boolean;
  value?: string | number | boolean; options?: Array<{ value: string; label: string }>;
}
export interface ExtensionForm { id: string; title: string; submit: string; fields: ExtensionField[]; values?: Record<string, string | number | boolean> }
export interface ExtensionPage {
  title: string; description?: string; forms: ExtensionForm[];
  sections?: Array<{ title: string; items: Array<{ title: string; description?: string; forms?: ExtensionForm[] }> }>;
}
