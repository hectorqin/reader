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

import { type ComponentChildren, type JSX } from './vendor/preact.ts';

/** The panel headings and controls the stylesheet already styles. */
export function SectionTitle({ children }: { children: ComponentChildren }): JSX.Element {
  return <div className="section-title">{children}</div>;
}

export function Notice({ children }: { children: ComponentChildren }): JSX.Element {
  return <div className="notice">{children}</div>;
}

export interface IconButtonProps {
  label: string;
  /** Glyph. Kept as a child so a caller can pass an element instead. */
  children: ComponentChildren;
  onClick?: (event: MouseEvent) => void;
  disabled?: boolean;
  /** Kept in the DOM so the header's layout does not depend on the mount. */
  hidden?: boolean;
}

export function IconButton({ label, children, onClick, disabled, hidden }: IconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      disabled={disabled ?? false}
      hidden={hidden ?? false}
      onClick={onClick}
    >
      {children}
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
