import { ApiError } from '../api/errors.ts';
import type { ReaderApi } from '../api/client.ts';
import type { Book, BrowseEntry, BrowseListing, ConflictPolicy, ShelfAction } from '../api/types.ts';
import { formatBytes, formatDate } from './dom.ts';
import { mountUI } from './mount.ts';
import { Button, Icon, IconButton } from './toolkit.tsx';
import { type ComponentChildren, type JSX, useEffect, useRef, useState } from './vendor/preact.ts';

export interface ManagerScreenOptions {
  api: ReaderApi;
  onClose(): void;
  /**
   * Ask to be shown a directory and page, without doing it.
   *
   * The screen does not navigate itself: a path is a *route*
   * (`#/library/<path>`), and folders are exactly the thing a reader wants to
   * send to someone else. So the screen reports the intent, the router writes the
   * URL, and the router hands the path back through `open(path, page)` below. The
   * round trip is what makes Back leave the library instead of retracing every
   * folder the reader walked into — and it is what makes a *page* survivable,
   * which it was not while the position lived in this class.
   *
   * `replace: false` distinguishes the two things this call means: walking into a
   * folder *replaces* the entry (one screen changing its own argument, so Back
   * leaves the screen rather than retracing the walk), while switching to the shelf
   * *pushes* (a different screen, which Back returns from).
   */
  onOpenLibrary(path: string, page: number, replace: boolean): void;
  /** Switches to the shelf, carrying the folder this screen was showing. */
  onOpenShelf(page: number): void;
  /** Opens a book: an entry that is a book, tapped. */
  onOpenBook(book: Book): void;
  /** Reports the page the reader turned to, so the URL can follow it. */
  onPageChange(page: number): void;
  onSignedOut(): void;
}

/** Long-press, in milliseconds, before a touch starts a selection. */
const LONG_PRESS_MS = 450;

/** One question with one answer. Held by the screen, rendered by the tree. */
type Dialog =
  | { kind: 'prompt'; title: string; value: string; resolve(value: string | null): void }
  | { kind: 'confirm'; title: string; body: string; resolve(ok: boolean): void }
  | {
      kind: 'pick';
      title: string;
      options: Array<{ value: string; label: string }>;
      resolve(value: string | null): void;
    }
  | {
      kind: 'form';
      title: string;
      count: number;
      fields: Array<{ key: string; label: string }>;
      resolve(fields: Record<string, string> | null): void;
    };

/**
 * Entries per page of the library listing.
 *
 * A mirror of the server's own default, declared here because the client computes
 * the page *count* and the server computes the page — and if the two numbers
 * disagree the pager offers pages that do not exist. It is the one place that
 * number appears on this side.
 */
const PAGE_SIZE = 200;

interface ManagerState {
  path: string;
  /**
   * Which page of the directory is shown.
   *
   * Owned by the route, like the path: a page that lives only in this class is a
   * page that Back, Forward and a reload all throw away.
   */
  page: number;
  listing: BrowseListing | null;
  /** Paths ticked for a batch operation. Empty means "navigate" mode. */
  selected: ReadonlySet<string>;
  loading: boolean;
  /** A write is in flight; every other write is refused until it settles. */
  busy: boolean;
  status: string;
  dialog: Dialog | null;
}

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
 *
 * ## What the framework changed here
 *
 * This screen was previously a class that held a reference to every node it would
 * later mutate, plus five separate render methods that had to agree with each
 * other, plus dialog builders that appended an overlay to `this.element` and
 * removed it by hand on every exit path. The state below is the same set of
 * facts, but the tree is a *function* of it, so "the selection bar is stale after
 * a rename" and "the ⋯ menu is still up after the screen reloaded" are no longer
 * expressible. The long-press and the gesture bookkeeping stay imperative,
 * because they are a timer, not markup.
 */
export class ManagerScreen {
  readonly element: HTMLDivElement;
  private readonly state: ManagerState = {
    path: '',
    page: 1,
    listing: null,
    selected: new Set<string>(),
    loading: false,
    busy: false,
    status: '',
    dialog: null,
  };
  private readonly ui: ReturnType<typeof mountUI>;
  private readonly uploadInput = document.createElement('input');
  /** Re-renders the tree from the current state. The whole update path. */
  private readonly draw: () => void;
  /**
   * The message a completed write left for the next render.
   *
   * Held across the reload a write triggers, because that reload's own status
   * line is the directory summary — and the summary is not an answer to "did it
   * work".
   */
  private outcome: string | null = null;

  constructor(private readonly options: ManagerScreenOptions) {
    this.element = document.createElement('div');
    this.element.className = 'manager-screen';
    // A file input lives outside the tree on purpose: it is never re-created, so
    // its `files` list and its focus survive every re-render. On some WebViews a
    // file input removed from the document loses its value, and the second upload
    // after a cancel would then send nothing.
    this.uploadInput.type = 'file';
    this.uploadInput.multiple = true;
    this.uploadInput.className = 'manager-upload-input';
    this.uploadInput.setAttribute('aria-hidden', 'true');
    this.uploadInput.tabIndex = -1;
    this.uploadInput.addEventListener('change', () => void this.handlePicked());

    const host = document.createElement('div');
    // `display: contents`, added in the stylesheet as `.manager-ui`, so the host
    // adds no layout box: the screen stays the flex column, and the header, the
    // scroller and the action bar stay its children as far as CSS is concerned.
    // Without that, the screen would have one child that is not `min-height: 0`
    // and the list would push the action bar off the bottom of a phone.
    host.className = 'manager-ui';
    this.element.append(host, this.uploadInput);

    this.draw = (): void => this.ui.update(this.state);
    this.ui = mountUI(host, (state) => this.view(state as ManagerState), this.state);
  }

  /** The mount's writability, read by CSS rather than branched on in the tree. */
  private applyWritable(writable: boolean): void {
    // On the *screen*, not on a wrapper: the stylesheet dims the per-row ⋯ menu
    // through this attribute, and that affordance is drawn by the row.
    this.element.dataset['writable'] = String(writable);
  }

  /**
   * Shows a directory, at a page.
   *
   * The path *and the page* come from the URL rather than from this screen's own
   * history, so a deep link, a Back, and a forward walk all arrive here the same
   * way: the route is the request, and this method is only the executor. The page is
   * part of that, and it used to be component state — which meant Back, Forward and
   * a reload all silently reset a folder to its first sixty entries.
   */
  async open(path = '', page = 1): Promise<void> {
    this.state.page = page > 0 ? page : 1;
    await this.load(path);
  }

  /** Turns to a page. Reported to the shell, which writes it into the URL. */
  private goToPage(page: number): void {
    const count = this.pageCount();
    const target = Math.min(Math.max(1, page), count);
    if (target === this.state.page) return;
    this.state.page = target;
    this.draw();
    this.options.onPageChange(target);
  }

  private pageCount(): number {
    const total = this.state.listing?.total ?? 0;
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }

  private async load(path: string): Promise<void> {
    if (this.state.loading) return;
    this.state.loading = true;
    if (!this.state.status) this.setStatus('载入中…');
    this.draw();
    try {
      const listing = await this.options.api.browse(path, this.state.page);
      this.state.listing = listing;
      this.state.path = listing.path;
      this.applyWritable(listing.writable);
      // The status line describes what was just done, when something was. A
      // plain directory listing has nothing to report but the summary the tree
      // computes, so the load message is dropped — and an *outcome* set by a
      // completed write is re-applied after it, because it is the one message the
      // reader is looking for and the summary is not an answer to it.
      this.state.status = this.outcome ?? '';
      // A reload invalidates any selection: the paths it held may no longer be on
      // screen, and a batch action that includes an invisible row is the one way
      // this screen can delete something the reader did not tick.
      this.state.selected = new Set<string>();
      // The status line says what a directory listing *is* — how many entries, how
      // big, how many the scanner is skipping — so the load message is dropped
      // here and the tree renders the summary instead. A message set by a
      // completed write is kept, because that is an answer the reader asked for
      // and the summary is not.
    } catch (err) {
      this.handleError(err);
    } finally {
      this.state.loading = false;
      this.draw();
    }
  }

  private setStatus(text: string): void {
    this.state.status = text;
  }

  private toast(text: string): void {
    this.state.status = text;
    this.draw();
  }

  private select(paths: Iterable<string>): void {
    this.state.selected = new Set(paths);
    this.draw();
  }

  private toggle(entry: BrowseEntry): void {
    const selected = new Set(this.state.selected);
    if (selected.has(entry.path)) selected.delete(entry.path);
    else selected.add(entry.path);
    this.state.selected = selected;
    this.draw();
  }

  /** True when a delete was confirmed and the paths it covered. */
  private selectedList(): string[] {
    return [...this.state.selected];
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

  // ---- the tree ----

  private view(state: ManagerState): ComponentChildren {
    const listing = state.listing;
    const writable = listing?.writable ?? false;
    return (
      <>
        <div className="panel-header">
          <IconButton label="返回" icon="arrow-left" onClick={() => this.options.onClose()} />
          {/* The two lists are siblings, and this is the arrow between them. It is
              a *place* (the shelf) rather than a filter, so it sits beside the
              breadcrumb with the rest of the places; the filter-shaped controls are
              the two write buttons on the other side. */}
          <IconButton
            label="书架"
            icon="table-columns"
            class="manager-switch"
            onClick={() => this.options.onOpenShelf(1)}
          />
          <div className="manager-crumbs">
            {(listing?.crumbs ?? []).map((crumb, index) => (
              <>
                {index > 0 ? <span className="manager-crumb-sep">/</span> : null}
                <button
                  type="button"
                  key={`${crumb.path}#${index}`}
                  className="manager-crumb"
                  aria-current={index === (listing?.crumbs.length ?? 0) - 1}
                  onClick={() => this.options.onOpenLibrary(crumb.path, 1, true)}
                >
                  {crumb.name}
                </button>
              </>
            ))}
          </div>
          {/* Hidden rather than omitted, with `hidden` as the state: a control
              that can only answer 403 teaches the reader to distrust every other
              control, and *which* controls are missing is what this attribute
              says. */}
          <IconButton
            label="上传书籍"
            icon="file-arrow-up"
            hidden={!writable}
            disabled={state.busy}
            onClick={() => this.uploadInput.click()}
          />
          <IconButton
            label="新建文件夹"
            icon="plus"
            hidden={!writable}
            disabled={state.busy}
            onClick={() => void this.promptMkdir()}
          />
        </div>
        <div
          className="manager-body"
          onClick={(event) => {
            // Clicking the empty area clears a selection, which is the gesture
            // people already have for "never mind". The check is on the target so
            // a click inside a row (which bubbles) does not.
            if (event.target === event.currentTarget) this.select([]);
          }}
        >
          <div className="manager-list">
            {listing && listing.total === 0 ? (
              <div className="empty-state">
                <p>这个文件夹是空的</p>
              </div>
            ) : null}
            {(listing?.entries ?? []).map((entry) => (
              <Row
                key={entry.path}
                entry={entry}
                selecting={state.selected.size > 0}
                selected={state.selected.has(entry.path)}
                onActivate={() => this.activate(entry)}
                onToggle={() => this.toggle(entry)}
                onMenu={() => void this.openEntryMenu(entry)}
              />
            ))}
          </div>
          {/* The pager is drawn from the *directory's* total, not from the rows on
              screen: a folder of four hundred files has two pages, and a pager that
              counted what it could see would offer one. It is hidden entirely when
              there is one page, because a control that can only be pressed to no
              effect is a control the reader learns to distrust. */}
          {this.pageCount() > 1 ? (
            <Pager
              page={state.page}
              pageCount={this.pageCount()}
              busy={state.loading}
              onGo={(page) => this.goToPage(page)}
            />
          ) : null}
          <div className="manager-status muted">{state.status || this.summary(listing)}</div>
        </div>
        <SelectionBar
          count={state.selected.size}
          writable={writable}
          only={[...state.selected][0]}
          entries={listing?.entries ?? []}
          onClear={() => this.select([])}
          onRename={(path, name) => void this.promptRename(path, name)}
          onMetadata={() => void this.promptBatchMetadata()}
          onShelve={() => void this.batchShelf('remove')}
          onMove={() => void this.promptMove()}
          onDelete={() => void this.confirmDelete()}
        />
        {state.selected.size > 0 ? <div className="manager-selection">已选 {state.selected.size} 项</div> : null}
        {state.dialog ? (
          <DialogView dialog={state.dialog} onClose={(answer) => this.closeDialog(answer)} />
        ) : null}
      </>
    );
  }

  /**
   * The directory summary, shown until something has something better to say.
   *
   * Kept as a function of the listing rather than written into the status line at
   * load time, because the two used to fight: a report set by a completed write
   * was overwritten by the summary of the reload that write triggered, so the one
   * message the reader had to read was the one message they never saw.
   */
  private summary(listing: BrowseListing | null): string {
    if (listing === null) return '';
    if (listing.total === 0) {
      return listing.writable ? '空文件夹 · 可以用右上角的新建按钮添加子目录' : '空文件夹';
    }
    /*
     * The counts are the directory's, and the page is named when there is more
     * than one.
     *
     * "400 个文件" under a screen showing 200 of them is a correct sentence and a
     * confusing one; saying which page it is makes the number and the rows agree.
     * The hidden count is taken from what the scanner would skip across the whole
     * directory rather than from this page, because "3 个被扫描忽略" that changes
     * as the reader turns pages is a fact about the page, not about the folder.
     */
    const hidden = listing.entries.filter((entry) => entry.hidden || entry.hiddenByRule).length;
    const parts = [`${listing.dirs} 个文件夹`, `${listing.files} 个文件`, formatBytes(listing.size)];
    if (hidden > 0) parts.push(`${hidden} 个被扫描忽略`);
    if (this.pageCount() > 1) parts.push(`第 ${this.state.page} / ${this.pageCount()} 页`);
    return parts.join(' · ');
  }

  /**
   * One tap on a row.
   *
   * The row navigates; the checkbox that appears in selection mode is what
   * selects. That split is the whole reason a destructive tap cannot happen while
   * scrolling a library of ten thousand files.
   */
  private activate(entry: BrowseEntry): void {
    if (entry.type === 'other') return;
    if (this.state.selected.size > 0) {
      this.toggle(entry);
      return;
    }
    // A folder is announced to the outside, which turns it into a URL — always at
    // page one, because page three of the folder the reader just left is not a
    // place it makes sense to arrive in.
    if (entry.type === 'dir') this.options.onOpenLibrary(entry.path, 1, true);
  }

  // ---- selection actions ----

  private async openEntryMenu(entry: BrowseEntry): Promise<void> {
    if (!this.state.listing?.writable) {
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
    this.select([entry.path]);
    if (action === 'metadata') return this.promptBatchMetadata();
    if (action === 'shelve') return this.batchShelf('remove');
    if (action === 'rename') return this.promptRename(entry.path, entry.name);
    if (action === 'move') return this.promptMove();
    if (action === 'delete') return this.confirmDelete();
  }

  private async promptRename(path: string, currentName: string): Promise<void> {
    const name = await this.prompt('重命名', currentName);
    if (name === null || name.trim() === '' || name === currentName) return;
    await this.mutate(() => this.options.api.browseRename(path, name.trim()), `重命名 ${currentName}`);
  }

  private async promptMkdir(): Promise<void> {
    const name = await this.prompt('新建文件夹', '');
    if (name === null || name.trim() === '') return;
    await this.mutate(() => this.options.api.browseMkdir(this.state.path, name.trim()), `新建 ${name.trim()}`);
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
    const target = await this.prompt('移动到（书库内的路径，留空为根目录）', this.state.path);
    if (target === null) return;
    const paths = this.selectedList();
    await this.mutate(() => this.options.api.browseMove(paths, target.trim()), `移动 ${paths.length} 项`);
  }

  private async confirmDelete(): Promise<void> {
    const count = this.state.selected.size;
    const ok = await this.confirm(
      `删除 ${count} 项？`,
      '文件会从磁盘上直接删除，不进回收站。删除后需要重新扫描书库，书架才会更新。',
    );
    if (!ok) return;
    const paths = this.selectedList();
    await this.mutate(() => this.options.api.browseDelete(paths), `删除 ${paths.length} 项`);
  }

  /**
   * Rewrites the metadata of every selected path at once.
   *
   * The fields are optional on purpose — this is a *patch*, and an empty field
   * means "leave it alone", which is the only way one dialog can serve both "fill
   * in the missing author on forty files" and "fix the series name".
   */
  private async promptBatchMetadata(): Promise<void> {
    const paths = this.selectedList();
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
    const paths = this.selectedList();
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

  /**
   * Uploads the picked files into the directory currently open.
   *
   * The progress line is the whole point of the display: a book is routinely
   * hundreds of megabytes on a phone over Wi-Fi, and a screen that says nothing
   * for two minutes reads as broken. The input is cleared *before* the upload
   * rather than after, so picking the same file twice in a row works.
   */
  private async handlePicked(): Promise<void> {
    const files = [...(this.uploadInput.files ?? [])];
    this.uploadInput.value = '';
    if (files.length === 0) return;

    const policy = await this.pickConflictPolicy();
    if (!policy) return;

    const total = files.reduce((sum, file) => sum + file.size, 0);
    this.state.busy = true;
    this.draw();
    try {
      const result = await this.options.api.upload(files, this.state.path, policy, (fraction) => {
        this.toast(`上传中… ${Math.round(fraction * 100)}%（${formatBytes(total)}）`);
      });
      /*
       * The directory is re-read before the report, and both are in this `try`.
       *
       * This is the bug the issue reports: "上传成功没有刷新目录文件". The report was
       * written to the status line and nothing else happened, so the row for the file
       * that had just landed was simply absent from the list — and a list that does
       * not contain the thing you just did reads as a failed upload, whatever the
       * message above it says. Reloading is what makes the report *true*.
       *
       * It goes through `load` rather than appending the uploaded paths by hand: the
       * server's upload answers with the paths it *wrote*, and the directory also
       * gained whatever the scan indexed from them and lost whatever an
       * `overwrite` replaced. One re-read is both shorter and more correct than
       * patching three of those four facts.
       */
      this.outcome = this.describeUpload(result);
      await this.load(this.state.path);
      this.outcome = null;
      this.toast(this.describeUpload(result));
    } catch (err) {
      this.handleError(err);
    } finally {
      this.state.busy = false;
      this.draw();
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

  /**
   * What an upload did, as a sentence.
   *
   * A function rather than a `toast` call because the message now has to survive the
   * reload the upload triggers: the reload's own status line is the directory
   * summary, and the summary is not an answer to "did it work". So the sentence is
   * built once, written into `outcome` for the reload to re-apply, and shown again
   * by the toast — one wording, two readers of it.
   */
  private describeUpload(result: Awaited<ReturnType<ReaderApi['upload']>>): string {
    const parts: string[] = [];
    if (result.uploaded.length > 0) parts.push(`已入库 ${result.uploaded.length} 个文件`);
    if (result.skipped.length > 0) parts.push(`跳过 ${result.skipped.length} 个`);
    const added = result.scan?.added ?? 0;
    parts.push(added > 0 ? `新增 ${added} 本` : '没有新书');
    // A skipped file is the one thing the user has to act on, so it is named
    // rather than counted: "跳过 1 个" without a name is a dead end.
    const first = result.skipped[0];
    if (first) parts.push(`（${first.name}：${first.reason}）`);
    return parts.join(' · ');
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
    if (this.state.busy) return;
    this.toast(`${label}…`);
    let result: unknown;
    try {
      result = await action();
    } catch (err) {
      this.handleError(err);
      this.draw();
      return;
    }
    // The server's own counts beat a generic "完成": a batch that touched two
    // books out of five selected is a different outcome from one that touched
    // five, and only the response knows which happened. It outlives the reload
    // that `load` triggers, because `load` no longer overwrites the status line.
    this.outcome = describe ? describe(result as never) : `${label} 完成`;
    this.setStatus(this.outcome);
    await this.load(this.state.path);
    this.outcome = null;
  }

  // ---- dialogs ----
  //
  // One dialog at a time, held in state rather than appended to the DOM. Each is
  // a question with a single answer, and a dialog that outlives its question is
  // how a stale "delete?" prompt ends up attached to a different file.

  private batchMetadataDialog(count: number): Promise<Record<string, string> | null> {
    return new Promise((resolve) => {
      this.state.dialog = {
        kind: 'form',
        title: `改资料（${count} 项）`,
        count,
        fields: [
          { key: 'author', label: '作者' },
          { key: 'publisher', label: '出版社' },
          { key: 'series', label: '系列' },
          { key: 'seriesIndex', label: '系列序号' },
          { key: 'language', label: '语言' },
          { key: 'tags', label: '标签（逗号分隔）' },
          { key: 'pubdate', label: '出版日期' },
        ],
        resolve,
      };
      this.draw();
    });
  }

  private prompt(title: string, value: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.state.dialog = { kind: 'prompt', title, value, resolve };
      this.draw();
    });
  }

  /**
   * A destructive confirmation.
   *
   * The confirm button is labelled 删除 in both places this is used — deleting
   * files and taking books off the shelf — because it is the same word for "yes,
   * do the thing I picked"; the body is what says which thing. The old version
   * passed a label through from each call site, which is how the same dialog
   * ended up saying two different things about the same button.
   */
  private confirm(title: string, body: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.state.dialog = { kind: 'confirm', title, body, resolve };
      this.draw();
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
      this.state.dialog = { kind: 'pick', title, options: unique, resolve };
      this.draw();
    });
  }

  /**
   * Closes the open dialog with an answer, exactly once.
   *
   * The union is the honest type here: three of the four dialogs answer with a
   * string, one with a boolean, one with a record, and the *shape* of the answer
   * is known from `dialog.kind` at the moment it is resolved. The single guarded
   * cast below is what keeps that knowledge in one place instead of at every call
   * site.
   */
  private closeDialog(answer: string | boolean | Record<string, string> | null): void {
    const dialog = this.state.dialog;
    this.state.dialog = null;
    this.draw();
    if (!dialog) return;
    if (dialog.kind === 'prompt') dialog.resolve(answer as string | null);
    else if (dialog.kind === 'confirm') dialog.resolve(answer as boolean);
    else if (dialog.kind === 'pick') dialog.resolve(answer as string | null);
    else dialog.resolve(answer as Record<string, string> | null);
  }

  dispose(): void {
    this.closeDialog(null);
    this.ui.unmount();
  }
}

/**
 * The page control under a directory listing.
 *
 * The same shape as the shelf's pager, and deliberately not shared with it: the two
 * page *different* things — one a folder's entries, one the shelf's books — and the
 * only code they would share is the loop that decides which numbers to draw. A
 * shared component would take six props to serve two call sites and would need a
 * third the day either list wants a different window.
 *
 * A reader scrolling a two-thousand-file folder is the case this exists for: the
 * list is not a feed, it is a *place*, and a place needs a position that can be
 * returned to, linked to, and turned from.
 */
function Pager({
  page,
  pageCount,
  busy,
  onGo,
}: {
  page: number;
  pageCount: number;
  busy: boolean;
  onGo(page: number): void;
}): JSX.Element {
  const numbers: Array<number | 'gap'> = [];
  const push = (value: number | 'gap'): void => {
    if (numbers.at(-1) !== value) numbers.push(value);
  };
  for (let n = 1; n <= pageCount; n += 1) {
    // First, last and the pages around the reader, with the runs between them
    // collapsed: the same width at three pages and at three hundred.
    if (n === 1 || n === pageCount || Math.abs(n - page) <= 1) push(n);
    else push('gap');
  }
  return (
    <nav className="manager-pager" aria-label="翻页">
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

/**
 * One row.
 *
 * Kept a component so the long-press timer lives in the row that owns it: a
 * timer held by the screen and pointing at "the last row touched" is how a long
 * press turns into a selection of the row the finger has since left.
 */
interface RowProps {
  entry: BrowseEntry;
  selecting: boolean;
  selected: boolean;
  onActivate(): void;
  onToggle(): void;
  onMenu(): void;
}

function Row({ entry, selecting, selected, onActivate, onToggle, onMenu }: RowProps): JSX.Element {
  const selectable = entry.type !== 'other';
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const [down, setDown] = useState(false);

  const cancel = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  // A row can be unmounted mid-press (a reload, a navigation), and a timer that
  // outlives its row would select a path that is no longer on screen.
  useEffect(() => cancel, []);

  const start = (): void => {
    fired.current = false;
    if (!selectable) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      fired.current = true;
      onToggle();
    }, LONG_PRESS_MS);
  };

  const meta: ComponentChildren[] = [
    <span>{entry.type === 'dir' ? '' : formatBytes(entry.size)}</span>,
    <span>{formatDate(entry.mtime)}</span>,
  ];
  if (entry.hiddenByRule) meta.push(<span className="manager-badge warn">扫描忽略</span>);
  else if (entry.scanned) meta.push(<span className="manager-badge">书籍</span>);
  if (entry.hidden && !entry.hiddenByRule) meta.push(<span className="manager-badge">隐藏</span>);

  return (
    <div
      className="manager-row"
      data-type={entry.type}
      data-selected={String(selected)}
      data-down={String(down)}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        // A long press already acted; the click that follows must not navigate.
        if (fired.current) {
          fired.current = false;
          event.stopPropagation();
          return;
        }
        onActivate();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate();
        }
      }}
      onTouchStart={start}
      onTouchEnd={cancel}
      onTouchCancel={cancel}
      onTouchMove={cancel}
      onMouseDown={() => {
        setDown(true);
        start();
      }}
      onMouseUp={() => {
        setDown(false);
        cancel();
      }}
      onMouseLeave={() => {
        setDown(false);
        cancel();
      }}
    >
      <span className="manager-check" aria-hidden="true" />
      <div className="manager-name">
        <Icon name={entry.type === 'dir' ? 'folder' : 'file-lines'} class="manager-icon" />
        <span className="manager-label">{entry.name}</span>
      </div>
      <div className="manager-meta muted">{meta}</div>
      {selectable || selecting ? (
        <IconButton
          label={`${entry.name} 的操作`}
          icon="ellipsis"
          class="manager-more"
          onClick={() => {
            cancel();
            onMenu();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The batch action bar.
 *
 * Rendered only while something is selected: an always-present toolbar of
 * move/delete buttons on a screen whose primary gesture is tapping a folder is a
 * permanent invitation to the wrong action.
 */
interface SelectionBarProps {
  count: number;
  writable: boolean;
  only: string | undefined;
  entries: BrowseEntry[];
  onClear(): void;
  onRename(path: string, name: string): void;
  onMetadata(): void;
  onShelve(): void;
  onMove(): void;
  onDelete(): void;
}

function SelectionBar(props: SelectionBarProps): JSX.Element {
  if (props.count === 0) return <div className="manager-actions" hidden />;
  const name = props.entries.find((entry) => entry.path === props.only)?.name ?? '';
  return (
    <div className="manager-actions">
      <Button onClick={props.onClear}>取消</Button>
      {props.writable ? (
        <>
          {props.count === 1 && props.only !== undefined ? (
            <Button onClick={() => props.onRename(props.only!, name)}>重命名</Button>
          ) : null}
          <Button onClick={props.onMetadata}>改资料</Button>
          <Button onClick={props.onShelve}>下架</Button>
          <Button onClick={props.onMove}>移动…</Button>
          <Button className="danger" onClick={props.onDelete}>
            删除
          </Button>
        </>
      ) : (
        <span className="muted">书库是只读挂载，无法修改</span>
      )}
    </div>
  );
}

/**
 * The dialog currently open, as markup.
 *
 * Presentational on purpose: it reports an answer through `onClose` and the
 * screen is what clears its own state and resolves the promise. Resolving from
 * inside the view (which is what a `dialog.resolve` call here would be) leaves
 * the state set, so the dialog stays on screen after it was answered — exactly
 * the bug the old "remove the overlay by hand on every exit path" code had, with
 * fewer exit paths to miss.
 */
function DialogView({
  dialog,
  onClose,
}: {
  dialog: Dialog;
  onClose(answer: string | boolean | Record<string, string> | null): void;
}): JSX.Element {
  const close = (answer: string | boolean | Record<string, string> | null): void => onClose(answer);
  return (
    <div
      className="dialog-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) close(dialog.kind === 'confirm' ? false : null);
      }}
    >
      {dialog.kind === 'prompt' ? (
        <PromptDialog
          title={dialog.title}
          value={dialog.value}
          onClose={(value) => close(value)}
        />
      ) : null}
      {dialog.kind === 'confirm' ? (
        <div className="dialog">
          <h3>{dialog.title}</h3>
          <p className="muted">{dialog.body}</p>
          <div className="dialog-actions">
            <Button onClick={() => close(false)}>取消</Button>
            <Button className="danger" onClick={() => close(true)}>
              删除
            </Button>
          </div>
        </div>
      ) : null}
      {dialog.kind === 'pick' ? (
        <div className="dialog sheet">
          <h3>{dialog.title}</h3>
          <div className="dialog-list">
            {dialog.options.map((option) => (
              <Button key={option.value} onClick={() => close(option.value)}>
                {option.label}
              </Button>
            ))}
          </div>
          <div className="dialog-actions">
            <Button onClick={() => close(null)}>取消</Button>
          </div>
        </div>
      ) : null}
      {dialog.kind === 'form' ? <MetadataDialog dialog={dialog} onClose={(fields) => close(fields)} /> : null}
    </div>
  );
}

function PromptDialog({
  title,
  value,
  onClose,
}: {
  title: string;
  value: string;
  onClose(value: string | null): void;
}): JSX.Element {
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <form
      className="dialog"
      onSubmit={(event) => {
        event.preventDefault();
        onClose(input.current?.value ?? '');
      }}
    >
      <h3>{title}</h3>
      <input ref={input} type="text" defaultValue={value} />
      <div className="dialog-actions">
        <Button onClick={() => onClose(null)}>取消</Button>
        <Button type="submit" className="primary">
          确定
        </Button>
      </div>
    </form>
  );
}

function MetadataDialog({
  dialog,
  onClose,
}: {
  dialog: Extract<Dialog, { kind: 'form' }>;
  onClose(fields: Record<string, string> | null): void;
}): JSX.Element {
  const inputs = useRef(new Map<string, HTMLInputElement>());
  return (
    <form
      className="dialog"
      onSubmit={(event) => {
        event.preventDefault();
        const patch: Record<string, string> = {};
        for (const [key, input] of inputs.current) {
          const value = input.value.trim();
          if (value !== '') patch[key] = value;
        }
        onClose(patch);
      }}
    >
      <h3>{dialog.title}</h3>
      <p className="muted">留空的字段保持不变。目录会写成它里面每一本书的资料。</p>
      {/* The fields are their own scroller so the actions below them stay
          reachable: a sheet that scrolls whole puts 保存 past the fold, and a form
          with no visible way to commit it reads as a dead end. */}
      <div className="dialog-fields">
        {dialog.fields.map((field) => (
          <label className="dialog-field" key={field.key}>
            <span>{field.label}</span>
            <input
              type="text"
              placeholder="留空则不改"
              ref={(node) => {
                if (node) {
                  inputs.current.set(field.key, node);
                  if (field.key === 'author') node.focus();
                } else {
                  inputs.current.delete(field.key);
                }
              }}
            />
          </label>
        ))}
      </div>
      <div className="dialog-actions">
        <Button onClick={() => onClose(null)}>取消</Button>
        <Button type="submit" className="primary">
          保存
        </Button>
      </div>
    </form>
  );
}

export type { ManagerState };
