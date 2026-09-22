import { relative, resolve, sep } from 'node:path';
import { forbidden } from './errors.ts';

/**
 * Resolve a library-relative path against the configured books root.
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

/**
 * Normalise a client supplied, library-relative path.
 *
 * Backslashes and leading/trailing slashes are stripped, and `.`/`..` segments
 * are *resolved* rather than refused.
 *
 *
 * Resolving rather than refusing matters because a client may legitimately pass
 * back a path the API gave it, joined onto something else. The caller still has
 * to check containment: `a/../../secret` becomes `../secret`, which is not inside
 * anything, and `assertSafeRel` rejects it.
 */
export function normalizeRel(relPath: string): string {
  const parts: string[] = [];
  for (const part of relPath.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      // Popping past the root keeps the `..`, so an escape attempt stays visible
      // to `assertSafeRel` instead of silently collapsing to an inside path.
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop();
      else parts.push('..');
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

export function assertSafeRel(relPath: string): string {
  const normalized = normalizeRel(relPath);
  if (!normalized || normalized.split('/').some((part) => part === '..' || part === '.')) {
    throw forbidden('invalid path', 'PATH_TRAVERSAL');
  }
  return normalized;
}
