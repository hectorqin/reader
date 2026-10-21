/**
 * The "⋯" menu.
 *
 * One trigger, one list of actions, drawn in the app's one overlay: a compact
 * Sheet, which opens beside the trigger on a wide window and as a bottom sheet on a
 * phone. It replaces three menus that each worked differently — a Mantine dropdown
 * in the file manager, a pick dialog on the shelf and a `<details>` popover on every
 * media page, the last of which stayed open when focus or the pointer moved away.
 *
 * Actions are data rather than children: the menu closes before the action runs,
 * so an action that opens its own sheet or navigates away is never left under a
 * menu that is still open.
 */

import { type JSX, type ReactNode, useState } from 'react';
import { Sheet } from './sheet.tsx';
import { Icon, IconButton, type IconName } from './toolkit.tsx';

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

export function ActionMenu({ label, items, icon = 'more', className, title, text }: {
  /** The trigger's accessible name; also the menu's heading unless `title` is given. */
  label: string;
  items: MenuItems;
  icon?: IconName;
  className?: string;
  title?: string;
  /** A visible word beside the glyph (e.g. 筛选); without it the trigger is an icon button. */
  text?: string;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const actions = items.filter((item): item is MenuAction => !!item);
  if (!actions.length) return null;
  const classes = className ? `action-menu-trigger ${className}` : 'action-menu-trigger';
  return <>
    {text
      ? <button type="button" className={`button icon-text-button ${classes}`} aria-label={label} aria-haspopup="menu" onClick={() => setOpen(true)}><Icon name={icon} /><span>{text}</span></button>
      : <IconButton className={classes} icon={icon} label={label} onClick={() => setOpen(true)} />}
    {open && <ActionSheet title={title ?? label} onDismiss={() => setOpen(false)}
      items={actions.map((action) => ({ ...action, onSelect: () => { setOpen(false); action.onSelect(); } }))} />}
  </>;
}

/**
 * The menu without its trigger, for a screen that already owns the open state.
 *
 * Exactly one of the two callbacks runs: `onSelect` of the action picked (the owner
 * closes the menu there) or `onDismiss` when the menu is closed without a pick.
 */
export function ActionSheet({ title, items, onDismiss }: { title: string; items: MenuItems; onDismiss(): void }): JSX.Element {
  const actions = items.filter((item): item is MenuAction => !!item);
  return (
    <Sheet title={title} size="compact" onClose={onDismiss}>
      <div className="sheet-list" role="menu" aria-label={title}>
        {actions.map((action) => (
          <button key={action.label} type="button"
            role={action.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={action.checked}
            className={action.danger ? 'sheet-list-item is-danger' : 'sheet-list-item'}
            disabled={action.disabled ?? false}
            onClick={() => action.onSelect()}>
            {action.icon ? <span className="sheet-list-icon" aria-hidden="true">{action.icon}</span> : null}
            <span className="sheet-list-label">{action.label}</span>
            {action.checked ? <Icon name="check" className="sheet-list-check" /> : null}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
