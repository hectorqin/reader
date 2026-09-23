/**
 * The primitives every screen was re-writing by hand.
 *
 * This file is the answer to "what does a framework actually buy us here". The
 * old UI built each control inline — `el('button', { className: 'icon-button',
 * attrs: { type: 'button', 'aria-label': '关闭' }, … })` — and the parts that
 * were *not* inline were the parts that were wrong: a dialog had no focus trap,
 * a sheet had no Escape handling, the segmented control and the switch each had
 * their own hand-rolled `aria-pressed` bookkeeping that could disagree with the
 * value it was drawn from.
 *
 * Each component here owns those details once, and takes the settings value and
 * a callback as props, so the rendered state cannot drift from the stored state.
 */

import { Icon, type IconName } from './icon.tsx';
import { type ComponentChildren, type JSX } from './vendor/preact.ts';

export { Icon, type IconName } from './icon.tsx';

/** The panel headings and controls the stylesheet already styles. */
export function SectionTitle({ children }: { children: ComponentChildren }): JSX.Element {
  return <div className="section-title">{children}</div>;
}

export interface IconButtonProps {
  /** Accessible name. Required: an icon button has no text to fall back on. */
  label: string;
  /**
   * The glyph, by name.
   *
   * A name rather than a child node, so every icon button in the product draws from
   * the same set at the same weight. The previous version took arbitrary children,
   * and that is exactly how the UI ended up mixing a Unicode hamburger, a Unicode
   * gear, an emoji folder and a `+` — four glyphs from four families, at four
   * optical weights, in one toolbar.
   */
  icon: IconName;
  onClick?: (event: MouseEvent) => void;
  disabled?: boolean;
  /** Kept in the DOM so the header's layout does not depend on the mount. */
  hidden?: boolean;
  class?: string;
}

/**
 * A square control holding one glyph.
 *
 * `hidden` rather than a conditional: the attribute is what the stylesheet hides on,
 * so a control that is not available disappears *and* keeps its place in the markup,
 * and no caller has to decide which of the two it wants.
 *
 * The glyph is passed as a *name*, so it is always `.icon` — which is what makes the
 * control's own alignment guaranteed rather than inherited from a caller's layout.
 */
export function IconButton({ label, icon, onClick, disabled, hidden, class: className }: IconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={className ? `icon-button ${className}` : 'icon-button'}
      aria-label={label}
      disabled={disabled ?? false}
      hidden={hidden ?? false}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

export interface IconTextButtonProps {
  label: string;
  icon: IconName;
  onClick?: (event: MouseEvent) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * A glyph and a label inside one control.
 *
 * The reason this exists as a component instead of as two children at each call
 * site: an icon beside text is exactly the arrangement that goes wrong, and it goes
 * wrong the same way every time — the glyph ends up on the text's baseline, half a
 * glyph high or low, and nobody notices until a screenshot. Here the glyph is always
 * `.icon`, the box centres its contents, and the pair cannot drift apart.
 */
export function IconTextButton({ label, icon, onClick, disabled, className }: IconTextButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={className ? `button icon-text-button ${className}` : 'button icon-text-button'}
      disabled={disabled ?? false}
      onClick={onClick}
    >
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}

export interface PrimaryButtonProps {
  children: ComponentChildren;
  onClick?: (event: MouseEvent) => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}

export function Button({ children, onClick, disabled, type, className }: PrimaryButtonProps): JSX.Element {
  return (
    <button
      type={type ?? 'button'}
      className={className ? `button ${className}` : 'button'}
      disabled={disabled ?? false}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export interface SegmentedProps<T extends string> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange(value: T): void;
  /** Accessible name for the group, e.g. "封面大小". */
  label?: string;
}

/**
 * A segmented control.
 *
 * `aria-pressed` is derived from `value` on every render, which is the fix for
 * the old version's real bug: it toggled the attribute on the sibling nodes by
 * hand, so any path that changed the setting without going through the click
 * handler left the buttons showing the wrong selection.
 */
export function Segmented<T extends string>({ options, value, onChange, label }: SegmentedProps<T>): JSX.Element {
  return (
    <div className="segmented" role="group" aria-label={label ?? ''}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export interface SwitchRowProps {
  label: string;
  hint: string;
  checked: boolean;
  onChange(checked: boolean): void;
}

/**
 * A labelled switch.
 *
 * A button rather than a checkbox, for the reason the old file documented: the
 * row is the 44px hit target, and a checkbox puts the target on a 16px square
 * that a thumb misses. The `aria-pressed` state now comes from `checked`
 * instead of from the DOM the click just modified.
 */
export function SwitchRow({ label, hint, checked, onChange }: SwitchRowProps): JSX.Element {
  return (
    <div className="field switch-field">
      <div className="switch-text">
        <div>{label}</div>
        <div className="muted">{hint}</div>
      </div>
      <button
        type="button"
        className="switch"
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

export interface ScrimProps {
  onDismiss?(): void;
  children: ComponentChildren;
  className?: string;
}

/**
 * The element panels and dialogs sit on.
 *
 * Clicking outside a panel to dismiss it is the one interaction a reader expects
 * from a sheet, and re-implementing it per screen is how a screen ends up
 * dismissing the panel when the reader tapped *inside* it (a click that lands on
 * the panel's own padding still bubbles). The check is on the target, once.
 */
export function Scrim({ onDismiss, children, className }: ScrimProps): JSX.Element {
  return (
    <div
      className={className ?? 'panel-host'}
      onClick={(event) => {
        if (onDismiss && event.target === event.currentTarget) onDismiss();
      }}
    >
      {children}
    </div>
  );
}
