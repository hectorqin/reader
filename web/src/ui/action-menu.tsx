/**
 * The "⋯" menu.
 *
 * One trigger, one list of actions, dropped down from the trigger — on a phone as
 * on a desktop. A function menu is a short list the hand reaches for and leaves:
 * it hangs off the button, has no title bar or backdrop, and closes on a pick, on
 * Escape, on Tab and on any press outside it.
 *
 * It is a `popover` when the platform has one, so it sits in the top layer and no
 * `overflow: hidden` ancestor can clip it; it is still rendered in place, so it
 * inherits the theme of the screen that opened it (the media aliases, the reader's
 * paper) like a Sheet does.
 *
 * Actions are data rather than children: the menu closes before the action runs,
 * so an action that opens a sheet or navigates away is never left under a menu
 * that is still open.
 *
 * `ActionSheet` is the same list as a compact Sheet, for a choice that is a
 * question rather than a menu (the shelf's pick dialog).
 */
import { type JSX, type KeyboardEvent, type ReactNode, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Sheet } from './sheet.tsx';
import { Icon, type IconName } from './toolkit.tsx';
import '../styles/action-menu.css';

export interface MenuAction {
  label: string;
  onSelect(): void;
  /** A leading glyph, drawn at the row's text size. */
  icon?: ReactNode;
  disabled?: boolean;
  /** Destructive: drawn in the danger colour. */
  danger?: boolean;
  /** A choice in a single-select menu (a filter, a sort order): marked when current. */
  checked?: boolean;
}

/** `false`, `null` and `undefined` entries are skipped, so callers can write `admin && {…}`. */
export type MenuItems = Array<MenuAction | false | null | undefined>;

const GAP = 4, MARGIN = 8;

export function ActionMenu({ label, items, icon = 'more', className, title, text }: {
  /** The trigger's accessible name; also the menu's name unless `title` is given. */
  label: string;
  items: MenuItems;
  icon?: IconName;
  className?: string;
  /** The menu's accessible name, when it differs from the trigger's (e.g. the row it acts on). */
  title?: string;
  /** A visible word beside the glyph (e.g. 筛选); without it the trigger is an icon button. */
  text?: string;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const actions = items.filter((item): item is MenuAction => !!item);
  if (!actions.length) return null;
  const classes = className ? `action-menu-trigger ${className}` : 'action-menu-trigger';
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) anchor.current?.focus({ preventScroll: true });
  };
  const toggle = () => setOpen((value) => !value);
  const expanded = { 'aria-haspopup': 'menu' as const, 'aria-expanded': open, 'aria-controls': open ? menuId : undefined };
  // No wrapper: the trigger stays the direct child its screen's layout expects.
  return <>
    {text
      ? <button type="button" ref={anchor} className={`button icon-text-button ${classes}`} aria-label={label} {...expanded} onClick={toggle}><Icon name={icon} /><span>{text}</span></button>
      : <button type="button" ref={anchor} className={`icon-button ${classes}`} aria-label={label} {...expanded} onClick={toggle}><Icon name={icon} /></button>}
    {open && <ActionDropdown id={menuId} label={title ?? label} anchor={anchor} actions={actions}
      onClose={close}
      onPick={(action) => { close(true); action.onSelect(); }} />}
  </>;
}

function ActionDropdown({ id, label, anchor, actions, onClose, onPick }: {
  id: string;
  label: string;
  anchor: RefObject<HTMLButtonElement | null>;
  actions: MenuAction[];
  onClose(refocus: boolean): void;
  onPick(action: MenuAction): void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const state = useRef({ onClose });
  state.current = { onClose };

  useLayoutEffect(() => {
    const menu = ref.current!;
    const popover = typeof menu.showPopover === 'function';
    if (popover) { try { menu.showPopover(); } catch { /* already shown */ } }
    const place = () => {
      const box = anchor.current?.getBoundingClientRect();
      if (!box) return;
      const { width, height } = menu.getBoundingClientRect();
      // Hang from the trigger's trailing edge when it is on the right half (a header's
      // ⋯), from its leading edge otherwise; flip above when there is no room below.
      const rightHalf = box.left + box.width / 2 > innerWidth / 2;
      const left = Math.min(Math.max(MARGIN, rightHalf ? box.right - width : box.left), innerWidth - width - MARGIN);
      const below = box.bottom + GAP, above = box.top - GAP - height;
      const top = below + height <= innerHeight - MARGIN || above < MARGIN ? Math.min(below, Math.max(MARGIN, innerHeight - height - MARGIN)) : above;
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
    };
    place();
    menu.querySelector<HTMLElement>('[role^=menuitem]:not(:disabled)')?.focus({ preventScroll: true });
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
    return () => {
      removeEventListener('resize', place);
      removeEventListener('scroll', place, true);
      if (popover) { try { menu.hidePopover(); } catch { /* already hidden */ } }
    };
  }, []);

  useEffect(() => {
    // A press anywhere outside the menu and its trigger closes it; the trigger toggles itself.
    const press = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (ref.current?.contains(target) || anchor.current?.contains(target))) return;
      state.current.onClose(false);
    };
    const blur = () => state.current.onClose(false);
    document.addEventListener('pointerdown', press, true);
    addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerdown', press, true);
      removeEventListener('blur', blur);
    };
  }, []);

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); return; }
    if (event.key === 'Tab') { onClose(false); return; }
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[role^=menuitem]:not(:disabled)')];
    if (!rows.length) return;
    const index = rows.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % rows.length
      : event.key === 'ArrowUp' ? (index - 1 + rows.length) % rows.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? rows.length - 1
            : -1;
    if (next < 0) return;
    event.preventDefault();
    rows[next]!.focus();
  };

  return (
    <div ref={ref} id={id} className="action-menu" role="menu" aria-label={label} popover="manual" onKeyDown={move}>
      {actions.map((action) => <MenuRow key={action.label} action={action} base="action-menu" onPick={() => onPick(action)} />)}
    </div>
  );
}

/** One row; `base` names its classes (`sheet-list-item`, `sheet-list-label`, …). */
function MenuRow({ action, base, onPick }: { action: MenuAction; base: 'action-menu' | 'sheet-list'; onPick(): void }): JSX.Element {
  const className = `${base}-item`;
  return (
    <button type="button"
      role={action.checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={action.checked}
      className={action.danger ? `${className} is-danger` : className}
      disabled={action.disabled ?? false}
      onClick={onPick}>
      {action.icon ? <span className={`${base}-icon`} aria-hidden="true">{action.icon}</span> : null}
      <span className={`${base}-label`}>{action.label}</span>
      {action.checked ? <Icon name="check" className={`${base}-check`} /> : null}
    </button>
  );
}

/**
 * The list as a compact Sheet, for a screen that already owns the open state.
 *
 * Exactly one of the two callbacks runs: `onSelect` of the action picked (the owner
 * closes the sheet there) or `onDismiss` when it is closed without a pick.
 */
export function ActionSheet({ title, items, onDismiss }: { title: string; items: MenuItems; onDismiss(): void }): JSX.Element {
  const actions = items.filter((item): item is MenuAction => !!item);
  return (
    <Sheet title={title} size="compact" onClose={onDismiss}>
      <div className="sheet-list" role="menu" aria-label={title}>
        {actions.map((action) => <MenuRow key={action.label} action={action} base="sheet-list" onPick={() => action.onSelect()} />)}
      </div>
    </Sheet>
  );
}
