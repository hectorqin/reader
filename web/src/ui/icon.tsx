/**
 * The icon primitive.
 *
 * ## Why a font, and not inline SVG
 *
 * The UI needs roughly thirty glyphs, in two colours, at four sizes, in one bundle
 * that has to work from `file://` in a WebView. Inline SVG would mean thirty small
 * components, each carrying its own `viewBox`, `stroke-width` and `fill` — which is
 * exactly how an icon set becomes visually inconsistent, because every one of those
 * three is a place where an individual glyph can drift. A font makes the glyph a
 * *character*: it inherits `font-size` and `color` from wherever it sits, scales
 * with the layout, and cannot carry divergent stroke geometry because there is no
 * per-glyph geometry in the UI layer at all.
 *
 * The set is generated (see `tools/icons/`) from one stroke width on one 24-unit
 * grid, which is what the optical consistency actually rests on.
 *
 * ## Why the accessible name is required
 *
 * An icon button with no text is a button whose name screen readers cannot read, so
 * `label` is not optional in `IconButtonProps` and it is not optional here either.
 * The glyph itself is always `aria-hidden` — it is punctuation, not content — and the
 * label is what carries the meaning. Where the label would repeat adjacent visible
 * text the caller passes `label={null}`, which is the explicit way to say "this glyph
 * is decorative", rather than omitting the attribute and leaving it ambiguous.
 */

import { ICON_CODEPOINTS, type IconName } from './icon-names.ts';
import { type JSX } from './vendor/preact.ts';

export type { IconName };

export interface IconProps {
  name: IconName;
  /**
   * Accessible name. `null` marks the glyph decorative; the surrounding control is
   * then responsible for being reachable by name.
   */
  label?: string | null;
  /** Extra classes, for sizing or colour. */
  class?: string;
}

/**
 * Renders one glyph from the icon font.
 *
 * The element is a `<span>` rather than an `<svg>` or an `<i>`: `i` is italic text
 * and inherits font-style, and `svg` would promise geometry that is not there.
 */
export function Icon({ name, label, class: className }: IconProps): JSX.Element {
  return (
    <span
      className={className ? `icon ${className}` : 'icon'}
      aria-hidden={label ? undefined : 'true'}
      role={label ? 'img' : undefined}
      aria-label={label ?? undefined}
    >
      {ICON_CODEPOINTS[name]}
    </span>
  );
}
