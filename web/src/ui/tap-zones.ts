/**
 * 点击区域: what a tap does, per cell of a 3×3 grid over the page.
 *
 * The grid is stored row-major, nine actions, and describes a left-to-right book.
 * A right-to-left book (a manga set to 右→左, an Arabic EPUB) reads it mirrored, so
 * the side the reader set as 下一页 stays the side the story moves toward — the same
 * rule the old two-way 左退右进 / 左进右退 switch followed.
 *
 * At least one cell is always 菜单: with none, the bars could only come back by a
 * long press nobody knows about, and a reader who mis-set the grid would be locked
 * out of the very panel that undoes it.
 */
import type { IconName } from './icon.tsx';
import type { TapZone } from './reader-view.ts';

export type TapAction = 'previous' | 'next' | 'menu' | 'previous-chapter' | 'next-chapter' | 'none';
export type TapZoneGrid = TapAction[];

export const TAP_ACTIONS: ReadonlyArray<{ value: TapAction; label: string; icon: IconName }> = [
  { value: 'previous', label: '上一页', icon: 'chevron-left' },
  { value: 'next', label: '下一页', icon: 'chevron-right' },
  { value: 'menu', label: '菜单', icon: 'menu' },
  { value: 'previous-chapter', label: '上一章', icon: 'step-backward' },
  { value: 'next-chapter', label: '下一章', icon: 'step-forward' },
  { value: 'none', label: '无操作', icon: 'close' },
];

const VALID = new Set<string>(TAP_ACTIONS.map(action => action.value));
export const TAP_CELLS = 9;
const CENTER = 4;

/** The grid the old two-way switch meant: one action per column, every row alike. */
export function tapZonePreset(layout: TapZone): TapZoneGrid {
  const row: TapAction[] = layout === 'reversed' ? ['next', 'menu', 'previous'] : ['previous', 'menu', 'next'];
  return [...row, ...row, ...row];
}

/**
 * A stored grid made safe to use: nine known actions and at least one 菜单.
 *
 * Without a stored grid — a device that last ran a build with only the two-way
 * switch — the switch's choice becomes the grid, so a left-handed reader keeps
 * their layout across the upgrade.
 */
export function normalizeTapZones(value: unknown, legacy: TapZone = 'standard'): TapZoneGrid {
  if (!Array.isArray(value) || value.length !== TAP_CELLS || !value.every(item => VALID.has(item as string))) {
    return tapZonePreset(legacy === 'reversed' ? 'reversed' : 'standard');
  }
  const grid = [...value] as TapZoneGrid;
  if (!grid.includes('menu')) grid[CENTER] = 'menu';
  return grid;
}

/** The action for a tap in `column`/`row` (each 0–2), mirrored for a right-to-left book. */
export function tapActionAt(grid: TapZoneGrid, column: number, row: number, rtl: boolean): TapAction {
  const col = rtl ? 2 - column : column;
  return grid[row * 3 + col] ?? 'none';
}

/** Whether `index` is the grid's last 菜单, which must not be changed to anything else. */
export function isLastMenuCell(grid: TapZoneGrid, index: number): boolean {
  return grid[index] === 'menu' && grid.filter(action => action === 'menu').length === 1;
}

export function tapActionLabel(action: TapAction): string {
  return TAP_ACTIONS.find(item => item.value === action)?.label ?? '无操作';
}
