import { ApiError } from '../api/errors.ts';
import type { ReaderApi } from '../api/client.ts';
import type { BrowseEntry, BrowseListing, ConflictPolicy, ShelfAction } from '../api/types.ts';
import { clear, el, formatBytes, formatDate } from './dom.ts';

export interface ManagerScreenOptions {
  api: ReaderApi;
  onClose(): void;
  onSignedOut(): void;
}

/** Long-press, in milliseconds, before a touch starts a selection. */
const LONG_PRESS_MS = 450;

/**
 * 书库管理 — the library as a file manager.
 *
 * ## Why this exists
 *
 * The shelf answers "what can I read". It cannot answer "where did my book go",
 * and that is the question a self-hosted library actually generates: a title
 * that does not appear after a rescan has no explanation anywhere in the app,
 * because a book's DTO never carries its path. This screen is the one place the
 * `BOOKS_DIR` is visible, and it is also the only one that writes to it.
 *
 * ## The three decisions that shape it
 *
 *  1. **Hidden entries are shown, with the reason.** `.trash`, `@eaDir` and
 *     friends are skipped by the scanner by design. Filtering them out here too
 *     would hide exactly the files a reader is looking for — the ones that are on
 *     disk but not on the shelf — so they are listed with a badge instead.
 *  2. **Selection is explicit, and destructive actions need a second tap.**
 *     Thumb-scrolling a NAS library with a delete button on every row is one
 *     mis-tap away from data loss. Rows navigate; selection is entered through
 *     the long-press or the ⋯ button, and delete always asks.
 *  3. **The write controls disappear on a read-only mount.** `:ro` is the
 *     documented deployment, so the common case is "this screen can only look",
 *     and offering buttons that answer 403 teaches the reader to distrust the UI.
 */
export class ManagerScreen {
  readonly element: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly crumbRow: HTMLDivElement;
  private readonly statusLine: HTMLDivElement;
  private readonly actionBar: HTMLDivElement;
  private readonly selectionCount: HTMLDivElement;
  private readonly mkdirButton: HTMLButtonElement;
  private readonly uploadButton: HTMLButtonElement;
  private readonly uploadInput: HTMLInputElement;
  private readonly listBody: HTMLDivElement;

  private current = '';
  private listing: BrowseListing | null = null;
  /** Paths ticked for a batch operation. Empty means "navigate" mode. */
  private readonly selected = new Set<string>();
  private loading = false;
  /** A write is in flight; every other write is refused until it settles. */
  private busy = false;
  /**
   * The message a completed write left for the next render.
   *
   * Held across the reload a write triggers, because that reload's own status
   * line is the directory summary — and the summary is not an answer to "did it
   * work".
   */
  private outcome: string | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressFired = false;

  constructor(private readonly options: ManagerScreenOptions) {
    this.crumbRow = el('div', { className: 'manager-crumbs' }) as HTMLDivElement;
    this.statusLine = el('div', { className: 'manager-status muted' }) as HTMLDivElement;
    this.list = el('div', { className: 'manager-list' }) as HTMLDivElement;
    this.selectionCount = el('div', { className: 'manager-selection', attrs: { hidden: true } }) as HTMLDivElement;
    this.actionBar = el('div', { className: 'manager-actions' }) as HTMLDivElement;
    this.mkdirButton = el('button', {
      className: 'icon-button',
      text: '＋',
      attrs: { type: 'button', 'aria-label': '新建文件夹' },
      on: { click: () => void this.promptMkdir() },
    }) as HTMLButtonElement;
    // Hidden from the DOM to `display: none`, never hidden by *moving* it: a
    // file input removed from the document loses its value in some WebViews, and
    // the second upload after a cancel would then send nothing.
    this.uploadInput = el('input', {
      className: 'manager-upload-input',
      attrs: { type: 'file', multiple: true, 'aria-hidden': 'true', tabindex: '-1' },
      on: { change: () => void this.handlePicked() },
    }) as HTMLInputElement;
    this.uploadButton = el('button', {
      className: 'icon-button',
      text: '⬆',
      attrs: { type: 'button', 'aria-label': '上传书籍' },
      on: { click: () => this.uploadInput.click() },
    }) as HTMLButtonElement;

    this.listBody = el('div', {
      className: 'manager-body',
      children: [this.list, this.statusLine],
    }) as HTMLDivElement;

    const header = el('div', {
      className: 'panel-header',
      children: [
        el('button', {
          className: 'icon-button',
          text: '←',
          attrs: { type: 'button', 'aria-label': '返回书架' },
          on: { click: () => options.onClose() },
        }),
        this.crumbRow,
        this.uploadButton,
        this.mkdirButton,
      ],
    });

    this.element = el('div', {
      className: 'manager-screen',
      children: [header, this.listBody, this.actionBar, this.selectionCount, this.uploadInput],
    }) as HTMLDivElement;

    // Clicking the empty area (not a row) clears a selection, which is the
    // gesture people already have for "never mind".
    this.listBody.addEventListener('click', (event) => {
      if (event.target === this.listBody || event.target === this.list) this.clearSelection();
    });
  }

  async open(): Promise<void> {
    await this.load('');
  }

  private async load(path: string): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    // An outcome message set by a write outlives the reload it triggers.
    // Otherwise "已更新 2 本" is replaced by the directory's file counts a tick
    // later, and the one thing the user needs to read is the one thing they
    // never see.
    if (!this.outcome) this.setStatus('载入中…');
    try {
      const listing = await this.options.api.browse(path);
      this.listing = listing;
      this.current = listing.path;
      this.clearSelection();
      this.renderCrumbs();
      this.renderEntries();
      this.applyWritable(listing.writable);
      // No `setStatus('')` here: listing a directory *succeeds with something to
      // say*, and that thing is what `renderEntries` just wrote — how many
      // entries, how big, and how many the scanner is skipping. Clearing it left
      // the screen with no answer to any of those.
      if (this.outcome) {
        const message = this.outcome;
        this.outcome = null;
        this.toast(message);
      }
    } catch (err) {
      this.handleError(err);
    } finally {
      this.loading = false;
    }
  }

  /**
   * Reflects the mount's writability into the UI, in two places for two reasons.
   *
   * The button is hidden outright: a control that can only answer 403 teaches the
   * reader to distrust every other control. The data attribute is on the *screen*
   * so the stylesheet owns the rest — the per-row ⋯ menu is a write affordance
   * and is dimmed by CSS rather than by a second branch in the render path.
   */
  private applyWritable(writable: boolean): void {
    // The upload control disappears for the same reason the ＋ does: a control
    // that can only answer 403 teaches the reader to distrust every other one.
    this.mkdirButton.hidden = !writable;
    this.uploadButton.hidden = !writable;
    this.element.dataset['writable'] = String(writable);
  }

  private renderCrumbs(): void {
    clear(this.crumbRow);
    const listing = this.listing;
    if (!listing) return;
    for (const [index, crumb] of listing.crumbs.entries()) {
      if (index > 0) this.crumbRow.append(el('span', { className: 'manager-crumb-sep', text: '/' }));
      const isLast = index === listing.crumbs.length - 1;
      this.crumbRow.append(
        el('button', {
          className: 'manager-crumb',
          text: crumb.name,
          attrs: { type: 'button', 'aria-current': String(isLast) },
          on: { click: () => void this.load(crumb.path) },
        }),
      );
    }
  }

  private renderEntries(): void {
    clear(this.list);
    const listing = this.listing;
    if (!listing) return;
    if (listing.entries.length === 0) {
      this.list.append(el('div', { className: 'empty-state', children: [el('p', { text: '这个文件夹是空的' })] }));
      this.setStatus(listing.writable ? '空文件夹 · 可以用右上角的 ＋ 新建子目录' : '空文件夹');
      return;
    }
    for (const entry of listing.entries) this.list.append(this.row(entry));

    const hidden = listing.entries.filter((entry) => entry.hidden || entry.hiddenByRule).length;
    const parts = [`${listing.dirs} 个文件夹`, `${listing.files} 个文件`, formatBytes(listing.size)];
    if (hidden > 0) parts.push(`${hidden} 个被扫描忽略`);
    this.setStatus(parts.join(' · '));
  }

  /**
   * One row.
   *
   * The row itself navigates; the checkbox that appears in selection mode is what
   * selects. That split is the whole reason a destructive tap cannot happen by
   * accident while scrolling a library of ten thousand files.
   */
  private row(entry: BrowseEntry): HTMLDivElement {
    const selectable = entry.type !== 'other';
    const checkbox = el('span', { className: 'manager-check', attrs: { 'aria-hidden': 'true' } });
    const name = el('div', {
      className: 'manager-name',
      children: [
        el('span', { className: 'manager-icon', text: entry.type === 'dir' ? '📁' : '📄' }),
        el('span', { className: 'manager-label', text: entry.name }),
      ],
    });
    const meta = el('div', {
      className: 'manager-meta muted',
      children: [
        el('span', { text: entry.type === 'dir' ? '' : formatBytes(entry.size) }),
        el('span', { text: formatDate(entry.mtime) }),
        entry.hiddenByRule
          ? el('span', { className: 'manager-badge warn', text: '扫描忽略' })
          : entry.scanned
            ? el('span', { className: 'manager-badge', text: '书籍' })
            : null,
        entry.hidden && !entry.hiddenByRule ? el('span', { className: 'manager-badge', text: '隐藏' }) : null,
      ],
    });

    const more = el('button', {
      className: 'icon-button manager-more',
      text: '⋯',
      attrs: { type: 'button', 'aria-label': `${entry.name} 的操作` },
      on: {
        click: (event) => {
          event.stopPropagation();
          void this.openEntryMenu(entry);
        },
      },
    }) as HTMLButtonElement;

    const node = el('div', {
      className: 'manager-row',
      attrs: { 'data-type': entry.type, role: 'button', tabindex: '0' },
      children: [checkbox, name, meta, more],
    }) as HTMLDivElement;
    node.dataset['path'] = entry.path;

    const activate = (): void => {
      if (!selectable) return;
      if (this.selected.size > 0) {
        this.toggle(entry);
        return;
      }
      if (entry.type === 'dir') void this.load(entry.path);
    };

    node.addEventListener('click', activate);
    node.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter' || (event as KeyboardEvent).key === ' ') {
        event.preventDefault();
        activate();
      }
    });

    // Long press enters selection mode, which is how a file manager on a phone
    // says "I mean this one, not the one I tapped".
    if (selectable && this.selected.size > 0) node.dataset['selected'] = String(this.selected.has(entry.path));
    const start = (): void => {
      this.longPressFired = false;
      if (!selectable) return;
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = null;
        this.longPressFired = true;
        this.toggle(entry);
      }, LONG_PRESS_MS);
    };
    const cancel = (): void => {
      if (this.longPressTimer !== null) clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    };
    node.addEventListener('touchstart', start, { passive: true });
    node.addEventListener('touchend', cancel);
    node.addEventListener('touchcancel', cancel);
    node.addEventListener('touchmove', cancel);
    node.addEventListener('mousedown', start);
    node.addEventListener('mouseup', cancel);
    node.addEventListener('mouseleave', cancel);
    // A long press already acted; the click that follows must not navigate.
    node.addEventListener('click', (event) => {
      if (!this.longPressFired) return;
      this.longPressFired = false;
      event.stopImmediatePropagation();
    }, true);

    return node;
  }

  private toggle(entry: BrowseEntry): void {
    if (this.selected.has(entry.path)) this.selected.delete(entry.path);
    else this.selected.add(entry.path);
    const node = this.list.querySelector<HTMLElement>(`[data-path="${cssEscape(entry.path)}"]`);
    if (node) node.dataset['selected'] = String(this.selected.has(entry.path));
    this.renderSelection();
  }

  private clearSelection(): void {
    this.selected.clear();
    for (const node of this.list.querySelectorAll<HTMLElement>('.manager-row')) {
      node.dataset['selected'] = 'false';
    }
    this.renderSelection();
  }

  /**
   * The batch action bar.
   *
   * Rendered only while something is selected: an always-present toolbar of
   * move/delete buttons on a screen whose primary gesture is tapping a folder is
   * a permanent invitation to the wrong action.
   */
  private renderSelection(): void {
    clear(this.actionBar);
    const count = this.selected.size;
    if (count === 0) {
      this.actionBar.hidden = true;
      this.selectionCount.hidden = true;
      return;
    }
    this.actionBar.hidden = false;
    this.selectionCount.hidden = false;
    this.selectionCount.textContent = `已选 ${count} 项`;
    const writable = this.listing?.writable ?? false;

    this.actionBar.append(
      el('button', {
        className: 'button',
        text: '取消',
        attrs: { type: 'button' },
        on: { click: () => this.clearSelection() },
      }),
    );
    if (writable) {
      if (count === 1) {
        const only = [...this.selected][0]!;
        const entry = this.listing?.entries.find((candidate) => candidate.path === only);
        this.actionBar.append(
          el('button', {
            className: 'button',
            text: '重命名',
            attrs: { type: 'button' },
            on: { click: () => void this.promptRename(only, entry?.name ?? '') },
          }),
        );
      }
      this.actionBar.append(
        el('button', {
          className: 'button',
          text: '改资料',
          attrs: { type: 'button' },
          on: { click: () => void this.promptBatchMetadata() },
        }),
        el('button', {
          className: 'button',
          text: '下架',
          attrs: { type: 'button' },
          on: { click: () => void this.batchShelf('remove') },
        }),
        el('button', {
          className: 'button',
          text: '移动…',
          attrs: { type: 'button' },
          on: { click: () => void this.promptMove() },
        }),
        el('button', {
          className: 'button danger',
          text: '删除',
          attrs: { type: 'button' },
          on: { click: () => void this.confirmDelete() },
        }),
      );
    } else {
      this.actionBar.append(
        el('span', { className: 'muted', text: '书库是只读挂载，无法修改' }),
      );
    }
  }

  private async openEntryMenu(entry: BrowseEntry): Promise<void> {
    if (!this.listing?.writable) {
      this.toast('书库是只读挂载，无法修改');
      return;
    }
    const action = await this.pick(`「${entry.name}」`, [
      { value: 'select', label: '选择' },
      { value: 'metadata', label: '改资料' },
      { value: 'shelve', label: '从书架拿掉' },
      { value: 'rename', label: '重命名' },
      { value: 'move', label: '移动到…' },
      { value: 'delete', label: '删除' },
    ]);
    if (action === 'select') {
      this.toggle(entry);
      return;
    }
    // Everything below acts on exactly this row, so the selection is replaced
    // rather than merged: an action started from one row's menu must not quietly
    // include a batch ticked earlier and now off screen.
    this.selectOnly(entry.path);
    if (action === 'metadata') return this.promptBatchMetadata();
    if (action === 'shelve') return this.batchShelf('remove');
    if (action === 'rename') return this.promptRename(entry.path, entry.name);
    if (action === 'move') return this.promptMove();
    if (action === 'delete') return this.confirmDelete();
  }

  private selectOnly(path: string): void {
    this.selected.clear();
    this.selected.add(path);
    for (const node of this.list.querySelectorAll<HTMLElement>('.manager-row')) {
      node.dataset['selected'] = String(node.dataset['path'] === path);
    }
    this.renderSelection();
  }

  /**
   * Uploads the picked files into the directory currently open.
   *
   * The progress line is the whole point of the display: a book is routinely
   * hundreds of megabytes on a phone over Wi-Fi, and a screen that says nothing
   * for two minutes reads as broken. It is also the only place in this client
   * where a request can outlive a screen change, so the input is cleared *before*
   * the upload rather than after — picking the same file twice in a row must
   * work.
   */
  private async handlePicked(): Promise<void> {
    const files = [...(this.uploadInput.files ?? [])];
    this.uploadInput.value = '';
    if (files.length === 0) return;

    const policy = await this.pickConflictPolicy();
    if (!policy) return;

    const total = files.reduce((sum, file) => sum + file.size, 0);
    this.setBusy(true);
    try {
      const result = await this.options.api.upload(files, this.current, policy, (fraction) => {
        this.setStatus(`上传中… ${Math.round(fraction * 100)}%（${formatBytes(total)}）`);
      });
      this.reportUpload(result);
    } catch (err) {
      this.handleError(err);
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * Asks what should happen to a name that is already taken.
   *
   * Asked before the bytes move rather than after a 409, because by then the
   * user has waited for the whole upload twice. `覆盖` is the only answer that can
   * lose a book, so it is described that way instead of being the default.
   */
  private async pickConflictPolicy(): Promise<ConflictPolicy | null> {
    const answer = await this.pick('同名文件怎么办？', [
      { value: 'rename', label: '两份都留（加 (2)）' },
      { value: 'skip', label: '跳过已有的' },
      { value: 'overwrite', label: '覆盖（会替换原文件）' },
      { value: 'fail', label: '有重名就整批不动' },
    ]);
    return answer as ConflictPolicy | null;
  }

  private reportUpload(result: Awaited<ReturnType<ReaderApi['upload']>>): void {
    const parts: string[] = [];
    if (result.uploaded.length > 0) parts.push(`已入库 ${result.uploaded.length} 个文件`);
    if (result.skipped.length > 0) parts.push(`跳过 ${result.skipped.length} 个`);
    const added = result.scan?.added ?? 0;
    parts.push(added > 0 ? `新增 ${added} 本` : '没有新书');
    // A skipped file is the one thing the user has to act on, so it is named
    // rather than counted: "跳过 1 个" without a name is a dead end.
    const first = result.skipped[0];
    if (first) parts.push(`（${first.name}：${first.reason}）`);
    this.toast(parts.join(' · '));
  }

  /**
   * Rewrites the metadata of every selected path at once.
   *
   * The fields are optional on purpose — this is a *patch*, and an empty field
   * means "leave it alone", which is the only way one dialog can serve both "fill
   * in the missing author on forty files" and "fix the series name".
   */
  private async promptBatchMetadata(): Promise<void> {
    const paths = [...this.selected];
    if (paths.length === 0) return;
    const fields = await this.batchMetadataDialog(paths.length);
    if (fields === null) return;
    if (Object.keys(fields).length === 0) {
      this.toast('没有填写任何字段');
      return;
    }
    await this.mutate(
      () => this.options.api.browseBatchMetadata(paths, fields),
      `改资料（${paths.length} 项）`,
      (result) => this.reportBatch(result),
    );
  }

  private async batchShelf(action: ShelfAction): Promise<void> {
    const paths = [...this.selected];
    if (paths.length === 0) return;
    const label = action === 'remove' ? '下架' : '上架';
    if (action === 'remove') {
      const ok = await this.confirm(
        `${label} ${paths.length} 项？`,
        '只是从你的书架上拿掉，磁盘上的文件一个都不会动，随时可以放回来。',
      );
      if (!ok) return;
    }
    await this.mutate(
      () => this.options.api.browseBatchShelf(paths, action),
      `${label}（${paths.length} 项）`,
      (result) => this.reportBatch(result),
    );
  }

  private reportBatch(result: { applied: number; failed: Array<{ path: string; reason: string }> }): string {
    if (result.applied === 0 && result.failed.length > 0) {
      return `没有可处理的书籍（${result.failed.length} 项不是书）`;
    }
    // A path that is not a book is expected — a folder of images, a `.nfo` — and
    // saying so is what stops "已更新 12 本" from looking like the other two were
    // silently dropped.
    const skipped = result.failed.length > 0 ? `，跳过 ${result.failed.length} 项` : '';
    return `已更新 ${result.applied} 本${skipped}`;
  }

  /** A form of optional fields; absent means "do not touch". */
  private batchMetadataDialog(count: number): Promise<Record<string, string> | null> {
    const FIELDS = [
      { key: 'author', label: '作者' },
      { key: 'publisher', label: '出版社' },
      { key: 'series', label: '系列' },
      { key: 'seriesIndex', label: '系列序号' },
      { key: 'language', label: '语言' },
      { key: 'tags', label: '标签（逗号分隔）' },
      { key: 'pubdate', label: '出版日期' },
    ];
    return new Promise((resolve) => {
      const inputs = new Map<string, HTMLInputElement>();
      const rows = FIELDS.map((field) => {
        const input = el('input', { attrs: { type: 'text', placeholder: '留空则不改' } }) as HTMLInputElement;
        inputs.set(field.key, input);
        return el('label', { className: 'dialog-field', children: [el('span', { text: field.label }), input] });
      });
      const close = (result: Record<string, string> | null): void => {
        overlay.remove();
        resolve(result);
      };
      const form = el('form', {
        className: 'dialog',
        on: {
          submit: (event) => {
            event.preventDefault();
            const patch: Record<string, string> = {};
            for (const [key, input] of inputs) {
              const value = input.value.trim();
              if (value !== '') patch[key] = value;
            }
            close(patch);
          },
        },
        children: [
          el('h3', { text: `改资料（${count} 项）` }),
          el('p', { className: 'muted', text: '留空的字段保持不变。目录会写成它里面每一本书的资料。' }),
          // The fields are their own scroller so the actions below them stay
          // reachable: a sheet that scrolls whole puts 保存 past the fold, and a
          // form with no visible way to commit it reads as a dead end.
          el('div', { className: 'dialog-fields', children: rows }),
          el('div', {
            className: 'dialog-actions',
            children: [
              el('button', { className: 'button', text: '取消', attrs: { type: 'button' }, on: { click: () => close(null) } }),
              el('button', { className: 'button primary', text: '保存', attrs: { type: 'submit' } }),
            ],
          }),
        ],
      });
      const overlay = el('div', {
        className: 'dialog-overlay',
        on: {
          click: (event) => {
            if (event.target === overlay) close(null);
          },
        },
        children: [form],
      }) as HTMLDivElement;
      this.element.append(overlay);
      inputs.get('author')?.focus();
    });
  }

  /**
   * Blocks a second write while one is in flight.
   *
   * Uploads are long and the bar stays on screen; a second tap would start a
   * second upload into the same directory, and the two would interleave their
   * status lines.
   */
  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.uploadButton.disabled = busy;
    this.mkdirButton.disabled = busy;
  }

  private async promptRename(path: string, currentName: string): Promise<void> {
    const name = await this.prompt('重命名', currentName);
    if (name === null || name.trim() === '' || name === currentName) return;
    await this.mutate(() => this.options.api.browseRename(path, name.trim()), `重命名 ${currentName}`);
  }

  private async promptMkdir(): Promise<void> {
    const name = await this.prompt('新建文件夹', '');
    if (name === null || name.trim() === '') return;
    await this.mutate(() => this.options.api.browseMkdir(this.current, name.trim()), `新建 ${name.trim()}`);
  }

  /**
   * Moving a batch asks for a path rather than offering a folder picker.
   *
   * A picker would be a second navigation UI inside the first, and the one place
   * a reader is most likely to land in the wrong folder is precisely where the
   * files go. A typed, library-relative path is unambiguous — and the server
   * resolves it through the same containment check as everything else.
   */
  private async promptMove(): Promise<void> {
    const target = await this.prompt('移动到（书库内的路径，留空为根目录）', this.current);
    if (target === null) return;
    const paths = [...this.selected];
    await this.mutate(() => this.options.api.browseMove(paths, target.trim()), `移动 ${paths.length} 项`);
  }

  private async confirmDelete(): Promise<void> {
    const count = this.selected.size;
    const ok = await this.confirm(
      `删除 ${count} 项？`,
      '文件会从磁盘上直接删除，不进回收站。删除后需要重新扫描书库，书架才会更新。',
    );
    if (!ok) return;
    const paths = [...this.selected];
    await this.mutate(() => this.options.api.browseDelete(paths), `删除 ${paths.length} 项`);
  }

  /**
   * Runs a mutating call, reports its outcome, and reloads only on success.
   *
   * The order matters and is the reason this is not two calls at the call sites:
   * reloading after a *failed* write would replace the error message with a fresh
   * directory listing, so the screen would look like the rename simply did not
   * happen — the worst possible answer to "why did nothing change".
   */
  private async mutate(
    action: () => Promise<unknown>,
    label: string,
    describe?: (result: never) => string,
  ): Promise<void> {
    if (this.busy) return;
    this.toast(`${label}…`);
    let result: unknown;
    try {
      result = await action();
    } catch (err) {
      this.handleError(err);
      return;
    }
    // The server's own counts beat a generic "完成": a batch that touched two
    // books out of five selected is a different outcome from one that touched
    // five, and only the response knows which happened.
    this.outcome = describe ? describe(result as never) : `${label} 完成`;
    await this.load(this.current);
  }

  private setStatus(text: string): void {
    this.statusLine.textContent = text;
  }

  private toast(text: string): void {
    this.setStatus(text);
  }

  private handleError(err: unknown): void {
    if (err instanceof ApiError) {
      if (err.isAuthFailure) {
        this.options.onSignedOut();
        return;
      }
      this.setStatus(err.message);
      return;
    }
    this.setStatus(err instanceof Error ? err.message : '出错了');
  }

  // ---- dialogs ----
  //
  // Built on the spot rather than kept as members: each one is a single question
  // with one answer, and a dialog that outlives its question is how a stale
  // "delete?" prompt ends up attached to a different file.

  private prompt(title: string, value: string): Promise<string | null> {
    return new Promise((resolve) => {
      const input = el('input', { attrs: { type: 'text', value } }) as HTMLInputElement;
      const close = (result: string | null): void => {
        overlay.remove();
        resolve(result);
      };
      const form = el('form', {
        className: 'dialog',
        on: {
          submit: (event) => {
            event.preventDefault();
            close(input.value);
          },
        },
        children: [
          el('h3', { text: title }),
          input,
          el('div', {
            className: 'dialog-actions',
            children: [
              el('button', { className: 'button', text: '取消', attrs: { type: 'button' }, on: { click: () => close(null) } }),
              el('button', { className: 'button primary', text: '确定', attrs: { type: 'submit' } }),
            ],
          }),
        ],
      });
      const overlay = el('div', {
        className: 'dialog-overlay',
        on: {
          click: (event) => {
            if (event.target === overlay) close(null);
          },
        },
        children: [form],
      }) as HTMLDivElement;
      this.element.append(overlay);
      input.focus();
      input.select();
    });
  }

  private confirm(title: string, body: string): Promise<boolean> {
    return new Promise((resolve) => {
      const close = (result: boolean): void => {
        overlay.remove();
        resolve(result);
      };
      const overlay = el('div', {
        className: 'dialog-overlay',
        on: {
          click: (event) => {
            if (event.target === overlay) close(false);
          },
        },
        children: [
          el('div', {
            className: 'dialog',
            children: [
              el('h3', { text: title }),
              el('p', { className: 'muted', text: body }),
              el('div', {
                className: 'dialog-actions',
                children: [
                  el('button', { className: 'button', text: '取消', attrs: { type: 'button' }, on: { click: () => close(false) } }),
                  el('button', { className: 'button danger', text: '删除', attrs: { type: 'button' }, on: { click: () => close(true) } }),
                ],
              }),
            ],
          }),
        ],
      }) as HTMLDivElement;
      this.element.append(overlay);
    });
  }

  private async pick(title: string, options: Array<{ value: string; label: string }>): Promise<string | null> {
    // De-duplicated by value: two rows that resolve to the same action are one
    // action, and showing it twice reads as two different things.
    const seen = new Set<string>();
    const unique = options.filter((option) => {
      if (seen.has(option.value)) return false;
      seen.add(option.value);
      return true;
    });
    return new Promise((resolve) => {
      const close = (result: string | null): void => {
        overlay.remove();
        resolve(result);
      };
      const overlay = el('div', {
        className: 'dialog-overlay',
        on: {
          click: (event) => {
            if (event.target === overlay) close(null);
          },
        },
        children: [
          el('div', {
            className: 'dialog sheet',
            children: [
              el('h3', { text: title }),
              el('div', {
                className: 'dialog-list',
                children: unique.map((option) =>
                  el('button', {
                    className: 'button',
                    text: option.label,
                    attrs: { type: 'button' },
                    on: { click: () => close(option.value) },
                  }),
                ),
              }),
              el('div', {
                className: 'dialog-actions',
                children: [el('button', { className: 'button', text: '取消', attrs: { type: 'button' }, on: { click: () => close(null) } })],
              }),
            ],
          }),
        ],
      }) as HTMLDivElement;
      this.element.append(overlay);
    });
  }

  dispose(): void {
    if (this.longPressTimer !== null) clearTimeout(this.longPressTimer);
  }
}

/**
 * CSS.escape with a fallback.
 *
 * `querySelector` with a raw path breaks on a folder named `第01卷 [前篇]` or one
 * containing a quote — both entirely ordinary in a Chinese comic library — and
 * `CSS.escape` is not present in every WebView the Android shell runs on.
 */
function cssEscape(value: string): string {
  const globalCss = (globalThis as { CSS?: { escape?: (text: string) => string } }).CSS;
  if (globalCss?.escape) return globalCss.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}
