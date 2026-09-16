import { createHash } from 'node:crypto';

/**
 * Book identity (product design §6, "主键设计").
 *
 * The key MUST survive the user renaming or moving files, and MUST collapse
 * duplicate copies of the same book into one shelf entry. Therefore:
 *
 *   id = H(identifier ?? '') + ':' + contentHash
 *
 * When the EPUB carries a dc:identifier it anchors the identity; the content
 * hash still participates so that a re-encoded file (different bytes) is
 * treated as a distinct copy rather than silently aliasing an existing row.
 *
 * Never use a file path as the key.
 */
export function computeBookId(identifier: string | null, contentHash: string): string {
  const anchor = (identifier ?? '').trim().toLowerCase();
  return createHash('sha256').update(`${anchor}\u0000${contentHash}`).digest('hex');
}

/** Stable id for a file record; path based on purpose, since it tracks a file. */
export function computeFileId(relPath: string): string {
  return createHash('sha256').update(relPath).digest('hex');
}
