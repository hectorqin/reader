/**
 * The page control under a list of books or files.
 *
 * ## Why it is one component now, when it was deliberately two
 *
 * The shelf and the file manager each had their own copy, and the note beside the
 * second one argued for that: the two page *different* things and the only shared
 * code is the loop that decides which numbers to draw. The argument was sound and
 * the conclusion stopped being, when the library screen grew a *browsing* half —
 * because that half pages the same thing the shelf does, with the same grid, and
 * two pagers under two grids that are 2px apart is exactly the drift the
 * stylesheet's `.shelf-pager, .manager-pager` rule exists to prevent.
 *
 * So it is one component with one extra knob: `className`. The two callers keep
 * their own class names, because the stylesheet already keys `.shelf-pager` and
 * `.manager-pager` to the same declarations and the *names* are what the UI review
 * scenes select on.
 *
 * ## Why numbered pages rather than a "load more" button
 *
 * The shelf used to append a chunk whenever the reader reached the bottom, which
 * means the list had no length the reader could see and no position they could
 * return to: closing the app and opening it again started from the top, and the
 * only record of "I was on the third screenful" was a scroll offset that does not
 * survive a repaint. A library of two thousand books is a *place*, and a place needs
 * a position.
 *
 * ## Why the window rather than every page
 *
 * Two thousand books is 34 pages, and 34 buttons on a phone is a control the reader
 * has to read instead of press. The window is `1 … n-1 n n+1 … N`, so the two ends
 * are always one press away and the middle is one press away from wherever they
 * are — which is every page a reader actually asks for.
 *
 * ## Why the arrows stay in the layout when they are disabled
 *
 * `disabled` rather than `hidden`: the buttons are in fixed positions, so a control
 * that disappears at page one moves the page numbers sideways under the reader's
 * thumb on the way to page two.
 */

import { Icon } from './toolkit.tsx';
import type { JSX } from './vendor/preact.ts';

export interface PagerProps {
  page: number;
  pageCount: number;
  /** True while a page is in flight, so two page turns cannot race. */
  busy: boolean;
  onGo(page: number): void;
  /** Which list this pages. `shelf` and `manager` are the two the stylesheet knows. */
  className: 'shelf-pager' | 'manager-pager';
  /** Accessible name, e.g. 翻页. */
  label?: string;
}

export function Pager({ page, pageCount, busy, onGo, className, label }: PagerProps): JSX.Element {
  const numbers: Array<number | 'gap'> = [];
  const push = (value: number | 'gap'): void => {
    if (numbers.at(-1) !== value) numbers.push(value);
  };
  for (let n = 1; n <= pageCount; n += 1) {
    // First, last, and the pages around the reader: everything else collapses into
    // one ellipsis per run, so the control is the same width at 3 pages and at 300.
    if (n === 1 || n === pageCount || Math.abs(n - page) <= 1) push(n);
    else push('gap');
  }
  return (
    <nav className={className} aria-label={label ?? '翻页'}>
      <button
        type="button"
        className="pager-step"
        aria-label="上一页"
        disabled={busy || page <= 1}
        onClick={() => onGo(page - 1)}
      >
        <Icon name="chevron-left" />
      </button>
      {numbers.map((value, index) =>
        value === 'gap' ? (
          <span className="pager-gap" key={`gap-${index}`} aria-hidden="true">
            …
          </span>
        ) : (
          <button
            type="button"
            key={value}
            className="pager-page"
            aria-label={`第 ${value} 页`}
            aria-current={value === page ? 'page' : undefined}
            disabled={busy}
            onClick={() => onGo(value)}
          >
            {value}
          </button>
        ),
      )}
      <button
        type="button"
        className="pager-step"
        aria-label="下一页"
        disabled={busy || page >= pageCount}
        onClick={() => onGo(page + 1)}
      >
        <Icon name="chevron-right" />
      </button>
    </nav>
  );
}
