/**
 * The shelf's own settings.
 *
 * A sheet rather than a route, and a separate file rather than more rows in the
 * reader's panel — because the two answer different questions. The reader panel
 * is about the *page*: type size, line height, the engine that reads it aloud.
 * This one is about the *grid*: how many covers fit, what each cover shows, and
 * what order they are in.
 *
 * Keeping them apart is not tidiness. A reader who wants bigger covers should not
 * have to open a panel full of typography settings to find it, and the reader's
 * panel is already four sections long.
 *
 * The panel is a component now, drawn from the settings object it is handed. The
 * previous version built it once in the constructor and then mutated it in place
 * (it had to, to avoid replacing the button under the reader's finger) — which
 * meant the control that was *not* pressed never learned that its value had
 * changed somewhere else. Here every control is rendered from `settings`, so a
 * patch from anywhere redraws all of them, and pressing a button no longer
 * replaces it under the finger because Preact diffs the text of the node that is
 * already there.
 */

import type { AppSettings } from '../store/settings.ts';
import { IconButton, SectionTitle, Segmented, SwitchRow } from './toolkit.tsx';
import type { JSX } from './vendor/preact.ts';

export const DENSITY_LABELS: Record<AppSettings['shelfDensity'], string> = {
  compact: '紧凑',
  cozy: '适中',
  comfortable: '宽松',
};

/**
 * The sort choices, shared with the shelf's own toolbar.
 *
 * Exported rather than duplicated because the two *are* one list: the sheet picks
 * the default and the chips pick this session's, and a value that exists in one
 * and not the other is a setting the reader can store but never select. The order
 * is the shelf's, so the two controls read the same way round.
 */
export const SHELF_SORTS: Array<{ value: AppSettings['shelfSort']; label: string }> = [
  { value: 'recent', label: '最近阅读' },
  { value: 'added', label: '最近入库' },
  { value: 'title', label: '书名' },
  { value: 'author', label: '作者' },
];

export interface ShelfSettingsOptions {
  settings: AppSettings;
  onPatch(patch: Partial<AppSettings>): void;
  onClose(): void;
}

export function ShelfSettingsPanel({
  open,
  settings,
  onPatch,
  onClose,
}: ShelfSettingsOptions & { open: boolean }): JSX.Element {
  return (
    <div className="panel shelf-settings" hidden={!open}>
      <div className="panel-header">
        <h2>书架设置</h2>
        <IconButton label="关闭" icon="xmark" onClick={onClose} />
      </div>
      <div className="panel-body">
        <SectionTitle>封面大小</SectionTitle>
        <Segmented
          label="封面大小"
          options={[
            { value: 'compact', label: DENSITY_LABELS.compact },
            { value: 'cozy', label: DENSITY_LABELS.cozy },
            { value: 'comfortable', label: DENSITY_LABELS.comfortable },
          ]}
          value={settings.shelfDensity}
          onChange={(value) => onPatch({ shelfDensity: value })}
        />

        <SectionTitle>显示</SectionTitle>
        <SwitchRow
          label="显示作者"
          hint="关闭后每本书只显示书名，封面可以更小"
          checked={settings.shelfShowAuthor}
          onChange={(checked) => onPatch({ shelfShowAuthor: checked })}
        />
        <SwitchRow
          label="显示阅读进度"
          hint="在封面底部画一条进度条"
          checked={settings.shelfShowProgress}
          onChange={(checked) => onPatch({ shelfShowProgress: checked })}
        />

        <SectionTitle>默认排序</SectionTitle>
        <div className="notice">书架上的排序按钮会记住最后一次选择，这里设置的是首次打开时的默认值。</div>
        <Segmented
          label="默认排序"
          options={SHELF_SORTS}
          value={settings.shelfSort}
          onChange={(value) => onPatch({ shelfSort: value })}
        />
      </div>
    </div>
  );
}
