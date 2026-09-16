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
 */

import type { AppSettings } from '../store/settings.ts';
import { el } from './dom.ts';

export const DENSITY_LABELS: Record<AppSettings['shelfDensity'], string> = {
  compact: '紧凑',
  cozy: '适中',
  comfortable: '宽松',
};

export interface ShelfSettingsOptions {
  settings: AppSettings;
  onPatch(patch: Partial<AppSettings>): void;
  onClose(): void;
}

/**
 * Builds the sheet.
 *
 * Returns the panel element, hidden. Rows are built once and mutate the settings
 * object in place: this is a form over a handful of values, and rebuilding it on
 * every toggle would fight the reader's own tap (the button they just pressed
 * would be replaced under their finger).
 */
export function buildShelfSettingsPanel(options: ShelfSettingsOptions): HTMLDivElement {
  const body = el('div', { className: 'panel-body' });

  body.append(
    el('div', {
      className: 'section-title',
      text: '封面大小',
    }),
  );
  body.append(
    segmented(
      (['compact', 'cozy', 'comfortable'] as const).map((value) => ({
        value,
        label: DENSITY_LABELS[value],
      })),
      options.settings.shelfDensity,
      (value) => options.onPatch({ shelfDensity: value as AppSettings['shelfDensity'] }),
    ),
  );

  body.append(el('div', { className: 'section-title', text: '显示' }));
  body.append(
    toggleRow('显示作者', '关闭后每本书只显示书名，封面可以更小', options.settings.shelfShowAuthor, (value) =>
      options.onPatch({ shelfShowAuthor: value }),
    ),
  );
  body.append(
    toggleRow('显示阅读进度', '在封面底部画一条进度条', options.settings.shelfShowProgress, (value) =>
      options.onPatch({ shelfShowProgress: value }),
    ),
  );

  body.append(el('div', { className: 'section-title', text: '默认排序' }));
  body.append(
    el('div', {
      className: 'notice',
      text: '书架上的排序按钮会记住最后一次选择，这里设置的是首次打开时的默认值。',
    }),
  );
  body.append(
    segmented(
      [
        { value: 'updated', label: '最近更新' },
        { value: 'added', label: '最近入库' },
        { value: 'title', label: '书名' },
        { value: 'author', label: '作者' },
      ],
      options.settings.shelfSort,
      (value) => options.onPatch({ shelfSort: value as AppSettings['shelfSort'] }),
    ),
  );

  return el('div', {
    className: 'panel shelf-settings',
    attrs: { hidden: true },
    children: [
      el('div', {
        className: 'panel-header',
        children: [
          el('h2', { text: '书架设置' }),
          el('button', {
            className: 'icon-button',
            text: '✕',
            attrs: { type: 'button', 'aria-label': '关闭' },
            on: { click: options.onClose },
          }),
        ],
      }),
      body,
    ],
  }) as HTMLDivElement;
}

function segmented(
  values: Array<{ value: string; label: string }>,
  current: string,
  onChange: (value: string) => void,
): HTMLDivElement {
  const buttons = values.map((entry) =>
    el('button', {
      text: entry.label,
      attrs: { type: 'button', 'aria-pressed': String(entry.value === current) },
      on: {
        click: (event) => {
          const group = (event.currentTarget as HTMLElement).parentElement;
          for (const sibling of group?.children ?? []) {
            sibling.setAttribute('aria-pressed', String(sibling === event.currentTarget));
          }
          onChange(entry.value);
        },
      },
    }),
  );
  return el('div', { className: 'segmented', children: buttons }) as HTMLDivElement;
}

/**
 * A switch.
 *
 * `aria-pressed` rather than a checkbox: the row is the hit target (44px), and a
 * checkbox would put the target on a 16px square next to a label that does
 * nothing when tapped.
 */
function toggleRow(label: string, hint: string, value: boolean, onChange: (value: boolean) => void): HTMLDivElement {
  const button = el('button', {
    className: 'switch',
    attrs: { type: 'button', 'aria-pressed': String(value) },
    on: {
      click: (event) => {
        const next = (event.currentTarget as HTMLElement).getAttribute('aria-pressed') !== 'true';
        (event.currentTarget as HTMLElement).setAttribute('aria-pressed', String(next));
        onChange(next);
      },
    },
  });
  const text = el('div', { className: 'switch-text', children: [el('div', { text: label }), el('div', { className: 'muted', text: hint })] });
  return el('div', {
    className: 'field switch-field',
    children: [text, button],
  }) as HTMLDivElement;
}
