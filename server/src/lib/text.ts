export function stripNullBytes(value: string): string {
  return value.replace(/\\u0000/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

export function collapseWhitespace(value: string): string {
  return stripNullBytes(value).replace(/\s+/g, ' ').trim();
}

export function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
