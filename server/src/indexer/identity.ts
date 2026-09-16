import { createHash } from 'node:crypto';

/**
 * Book identity (product design §6, "主键设计").
 *
 * The key MUST survive the user renaming or moving files, and MUST collapse
 * duplicate copies of the same book into one shelf entry. Therefore:
 *
 *   id = H(identifier ?? '') + ':' + contentHash
 *
 * When the book carries a stable identifier (EPUB dc:identifier, ISBN) it
 * anchors the identity; the content hash still participates so that a re-encoded
 * file (different bytes) is treated as a distinct copy rather than silently
 * aliasing an existing row.
 *
 * Never use a file path as the key.
 */
export function computeBookId(identifier: string | null, contentHash: string): string {
  const anchor = (identifier ?? '').trim().toLowerCase();
  return createHash('sha256').update(`${anchor}\u0000${contentHash}`).digest('hex');
}

/**
 * Identity anchor for a source that has no embedded identifier.
 *
 * Formats without embedded metadata — txt, comics, image folders — have nothing
 * to anchor on, so with the rule above every edit would produce a brand-new id.
 * Appending a chapter to a txt novel would mint a second book and silently drop
 * the reader's progress on the first one, and re-saving an EPUB without a
 * dc:identifier would do the same.
 *
 * The fix is to keep the identity of a source that is *replaced in place*: the
 * scanner passes the id the same path resolved to last time, and it is reused
 * unless the new file claims a different identifier (a genuine replacement, not
 * an edit).
 *
 * This deliberately does NOT key on the path — the path is only consulted to
 * find the previous id, and only when the content still has no identifier of
 * its own. A move therefore lands on the content-hash rule, which keeps progress
 * (see the rename test) because both sides hash to the same value.
 */
export function resolveBookId(input: {
  identifier: string | null;
  contentHash: string;
  /** Id this path resolved to on the previous scan, if it had a file. */
  previousId?: string | undefined;
  /** Identifier that previousId was derived from, for change detection. */
  previousIdentifier?: string | null | undefined;
}): string {
  const identifier = (input.identifier ?? '').trim().toLowerCase();
  const previousIdentifier = (input.previousIdentifier ?? '').trim().toLowerCase();

  // Editing a file in place keeps its identifier (usually both are empty), so
  // the previous identity carries over instead of a new book being created.
  if (input.previousId && identifier === previousIdentifier) {
    return input.previousId;
  }

  return computeBookId(input.identifier, input.contentHash);
}

/** Stable id for a file record; path based on purpose, since it tracks a file. */
export function computeFileId(relPath: string): string {
  return createHash('sha256').update(relPath).digest('hex');
}
