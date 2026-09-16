import { relative, resolve, sep } from 'node:path';
import { forbidden } from './errors.ts';

/**
 * Resolve a library-relative path against the read-only books root.
 *
 * Every filesystem access in the server must go through this helper: it is the
 * single choke point that prevents path traversal (`../../etc/passwd`) from
 * ever reaching the disk.
 */
export function resolveInside(root: string, relPath: string): string {
  const abs = resolve(root, relPath);
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  if (abs !== root && !abs.startsWith(rootWithSep)) {
    throw forbidden('path escapes the library root', 'PATH_TRAVERSAL');
  }
  return abs;
}

export function toRelative(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/');
}

/** Normalises a client supplied relative path to forward slashes. */
export function normalizeRel(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

export function assertSafeRel(relPath: string): string {
  const normalized = normalizeRel(relPath);
  if (!normalized || normalized.split('/').some((part) => part === '..' || part === '.')) {
    throw forbidden('invalid path', 'PATH_TRAVERSAL');
  }
  return normalized;
}
