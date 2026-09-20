/**
 * 「这本书在不在我的书架上」，以及两个方向的写入 —— as one vocabulary.
 *
 * This module used to also own the *join* between a book and the file it lives in:
 * the endpoint took library paths, a card held a `Book`, and the two were connected
 * by matching the book's title against the filenames in a directory listing.
 *
 * That join is gone, and it is worth recording why, because it looked reasonable:
 *
 *  - it only lands when a book's title happens to be its own filename. Anything the
 *    scanner read a title out of — which is the normal case — has a title like
 *    「半小时漫画宇宙大爆炸（半小时读完138亿年宇宙史，一口气搞懂大爆炸、奇点、黑洞…）」,
 *    and no file on disk is called that, so the lookup found nothing and the reader
 *    was told 「找不到「xxx」在磁盘上的路径」 for a book on their own shelf;
 *  - the listing it searched is *paged*, so a book whose file was not on the page the
 *    lookup read could not be named either;
 *  - and the guess could not be checked: it either produced a path or it did not.
 *
 * The mapping the guess was reconstructing already exists on the server
 * (`book_files.book_id` → `rel_path`), so the write now carries the **book id** and
 * there is nothing to match. What is left here is the part that was never about the
 * join: the two directions' words, and the sentence a batch reports them in.
 */

import type { ShelfAction } from '../api/types.ts';

/**
 * The two directions, as the reader's words.
 *
 * The aliases `hide`/`unhide` are the *same* two writes under two names (the server
 * folds them in one place), so the labels are the same words rather than a second
 * verb — and they are here rather than in a screen so the browsing page and the
 * shelf's card menu cannot call one action two things.
 */
export const SHELF_ACTION_LABELS: Record<ShelfAction, string> = {
  add: '加入书架',
  remove: '从书架拿掉',
  hide: '从书架拿掉',
  unhide: '加入书架',
};

/**
 * What a shelve write did, as a sentence.
 *
 * An *action-specific* function, because `已更新 3 本` is not an answer to what the
 * reader just did: they pressed 加入书架 or 从书架拿掉, and the one thing they want to
 * know is whether the book moved. It also has to be a sentence the reader can act on
 * when nothing moved — `0 本` next to a button that looks live is how "the button is
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
