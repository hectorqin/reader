/**
 * 「这本书在不在我的书架上」，以及两个方向的写入。
 *
 * Extracted from the two screens because both ask the same question and both got a
 * different answer, and the difference was invisible until a reader took a book off
 * their shelf:
 *
 *  - the *browse* page drew a control only for `shelfState === 'off'`, so a book that
 *    was already shelved had no control at all — correct, but it also had no way to
 *    show that the book was on the shelf;
 *  - the *file* page's row menu drew one direction per `shelfState`, which is the
 *    right rule but was written twice;
 *  - and neither could say what to do about a book whose *file* is on this page while
 *    the *book* is not, because that is a join, not a flag.
 *
 * The rule this module exists to hold is that the two are one question asked from two
 * ends, so they get one implementation of the join and one vocabulary for the result.
 */

import type { Book, BrowseEntry, ShelfAction } from '../api/types.ts';

/**
 * The filename without its extension.
 *
 * The join between a *book* and the *file* it lives in, and the only one available:
 * `BookDto` carries a title and a `source` (the embedded metadata's own idea of where
 * it came from) but never a path, while the browse listing carries paths and filenames.
 * Stripping the extension is what makes `第1卷` and `第1卷.epub` the same thing.
 *
 * Defensive about the input because both sides are user data: a `source` may be empty
 * (a book with no embedded metadata) and a title may be empty (a renamed file). An
 * empty stem simply matches nothing, which is the correct answer.
 */
export function stem(name: string | undefined | null): string {
  if (!name) return '';
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

/**
 * The file a card is about.
 *
 * `BookDto` carries a title and a `source` but never a path, and `BrowseEntry` carries
 * a path and a filename but no title, so the two are joined on the *name* — all three
 * of the names the scanner could have matched the book by, because a book whose
 * metadata was edited by hand no longer matches its filename.
 *
 * An empty stem matches nothing, which is the correct answer for a book with no title
 * or a file with no name.
 */
export function findEntry(byName: ReadonlyMap<string, BrowseEntry>, book: Book): BrowseEntry | undefined {
  return byName.get(stem(book.title)) ?? byName.get(stem(book.source)) ?? byName.get(stem(book.id));
}

/** A lookup from filename stem to listing entry, for one page of a folder. */
export function entriesByName(entries: readonly BrowseEntry[]): Map<string, BrowseEntry> {
  const byName = new Map<string, BrowseEntry>();
  for (const entry of entries) {
    // Folders are skipped: the shelf endpoint takes a file path, and a directory's own
    // row is not a book. `batchShelf` fans a *selected folder* out to the books under
    // it, but that is the reader choosing a folder, not a card that happens to match
    // one's name.
    if (entry.type !== 'file') continue;
    byName.set(stem(entry.name), entry);
  }
  return byName;
}

/**
 * The two directions, as the reader's words.
 *
 * The aliases `hide`/`unhide` are the *same* two writes under two names (the server
 * folds them in one place), so the labels are the same words rather than a second
 * verb — and they are here rather than in a screen so the browse page, the file page's
 * row menu and its batch bar cannot call one action two things.
 */
export const SHELF_ACTION_LABELS: Record<ShelfAction, string> = {
  add: '加入书架',
  remove: '下架',
  hide: '下架',
  unhide: '加入书架',
};

/**
 * What a shelve write did, as a sentence.
 *
 * An *action-specific* function, because `已更新 3 本` is not an answer to what the
 * reader just did: they pressed 加入书架 or 下架, and the one thing they want to know is
 * whether the book moved. It also has to be a sentence the reader can act on when
 * nothing moved — `0 本` next to a button that looks live is how "the button is
 * broken" gets reported, so the count of what was *not* a book is named.
 */
export function describeShelfAction(
  action: ShelfAction,
  result: { applied?: number; failed?: Array<{ path: string; reason: string }> },
): string {
  const label = SHELF_ACTION_LABELS[action];
  const applied = result.applied ?? 0;
  const failed = result.failed ?? [];
  if (applied === 0 && failed.length > 0) {
    return `${label}失败：${failed.length} 项不是书库里的书`;
  }
  const skipped = failed.length > 0 ? `，跳过 ${failed.length} 项` : '';
  return `${label} ${applied} 本${skipped}`;
}
