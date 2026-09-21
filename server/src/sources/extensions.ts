import { badRequest } from '../lib/errors.ts';

export interface ExtensionField {
  key: string; label: string; type: 'text' | 'textarea' | 'number' | 'boolean' | 'select';
  required?: boolean; value?: string | number | boolean;
  options?: Array<{ value: string; label: string }>;
}
export interface ExtensionForm {
  id: string; title: string; submit: string; fields: ExtensionField[];
  values?: Record<string, string | number | boolean>;
}
export interface ExtensionPage {
  title: string; description?: string; forms: ExtensionForm[];
  sections?: Array<{ title: string; items: Array<{ title: string; description?: string; forms?: ExtensionForm[] }> }>;
}
export interface PluginExtensions {
  pages?: Array<{ id: string; title: string }>;
  tasks?: Array<{ id: string; intervalMinutes: number }>;
}
const identifier = /^[a-z][a-z0-9._-]{0,63}$/;
function check(ok: unknown): asserts ok { if (!ok) throw badRequest('Invalid plugin extension payload', 'INVALID_EXTENSION'); }
function record(value: unknown): asserts value is Record<string, unknown> { check(value && typeof value === 'object' && !Array.isArray(value)); }
function label(value: unknown): asserts value is string { check(typeof value === 'string' && value.length <= 8192); }
export function extensionValues(input: unknown): Record<string, string | number | boolean> {
  record(input); check(Object.keys(input).length <= 32);
  for (const [key, value] of Object.entries(input)) {
    check(identifier.test(key)); check(typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 512_000);
  }
  return input as Record<string, string | number | boolean>;
}
export function extensionDeclarations(input: unknown): PluginExtensions | undefined {
  if (input === undefined) return undefined;
  record(input);
  for (const key of ['pages', 'tasks']) {
    const entries = input[key]; if (entries === undefined) continue;
    check(Array.isArray(entries) && entries.length <= 16);
    const ids = new Set();
    for (const entry of entries) {
      record(entry); check(typeof entry.id === 'string' && identifier.test(entry.id) && !ids.has(entry.id)); ids.add(entry.id);
      if (key === 'pages') label(entry.title);
      else check(Number.isInteger(entry.intervalMinutes) && Number(entry.intervalMinutes) >= 1 && Number(entry.intervalMinutes) <= 10080);
    }
  }
  return input as PluginExtensions;
}
export function extensionFields(input: unknown): ExtensionField[] {
  check(Array.isArray(input) && input.length <= 32);
  const keys = new Set();
  for (const field of input) {
    record(field); check(typeof field.key === 'string' && identifier.test(field.key) && !keys.has(field.key)); keys.add(field.key);
    label(field.label); check(['text', 'textarea', 'number', 'boolean', 'select'].includes(String(field.type)));
    if (field.value !== undefined) extensionValues({ value: field.value });
    if (field.required !== undefined) check(typeof field.required === 'boolean');
    if (field.type === 'select') {
      check(Array.isArray(field.options) && field.options.length <= 10001);
      for (const option of field.options) { record(option); label(option.value); label(option.label); }
    }
  }
  return input as ExtensionField[];
}
export function searchFilterFields(input: unknown): ExtensionField[] {
  const fields = extensionFields(input);
  check(fields.every(field => field.type === 'select'));
  return fields;
}
export function extensionPage(input: unknown): ExtensionPage {
  record(input); label(input.title); if (input.description !== undefined) label(input.description);
  const forms = (value: unknown) => {
    check(Array.isArray(value) && value.length <= 32);
    for (const form of value) {
      record(form); check(typeof form.id === 'string' && identifier.test(form.id)); label(form.title); label(form.submit);
      extensionFields(form.fields); if (form.values !== undefined) extensionValues(form.values);
    }
  };
  forms(input.forms);
  if (input.sections !== undefined) {
    check(Array.isArray(input.sections) && input.sections.length <= 16);
    for (const section of input.sections) {
      record(section); label(section.title); check(Array.isArray(section.items) && section.items.length <= 200);
      for (const item of section.items) { record(item); label(item.title); if (item.description !== undefined) label(item.description); if (item.forms !== undefined) forms(item.forms); }
    }
  }
  return input as unknown as ExtensionPage;
}
