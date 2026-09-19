/**
 * The questions a screen asks, and the one shape each answer has.
 *
 * ## Why this is a module rather than a sheet inside the file manager
 *
 * The library screen is two pages now, and both of them ask the same three
 * questions: a one-line text prompt (rename, mkdir, move), a destructive
 * confirmation (delete, take off the shelf) and a list of choices (what to do
 * about a name that is already taken). Two copies of "a confirm dialog" is how the
 * same dialog ends up saying two different words on the same button — which is not
 * hypothetical, it is what the comment this file replaces already documented.
 *
 * ## The type is a union, and the union is the honesty
 *
 * Three of the four dialogs answer with a string, one with a boolean, one with a
 * record, and the *shape* of the answer is known from `dialog.kind` at the moment it
 * is resolved. The single guarded cast in `DialogView` is what keeps that knowledge
 * in one place instead of at every call site.
 *
 * ## Why the dialog is state and not an appended DOM node
 *
 * This used to build an overlay, append it to the screen's element, and remove it by
 * hand on every exit path. One dialog outlives its question (a stale "delete?"
 * prompt attached to a different file) and every path that forgot to remove it was a
 * path nobody tested. Held in state, "there is one dialog and it is the current
 * question" is not a rule anybody has to keep.
 */

import { Button } from './toolkit.tsx';
import { type JSX, useEffect, useRef } from './vendor/preact.ts';

/** One question with one answer. Held by the screen, rendered by the tree. */
export type Dialog =
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

/** The answer to a dialog, before `kind` is known to have picked its shape. */
export type DialogAnswer = string | boolean | Record<string, string> | null;

/**
 * The dialog currently open, as markup.
 *
 * Presentational on purpose: it reports an answer through `onClose` and the screen
 * is what clears its own state and resolves the promise. Resolving from inside the
 * view leaves the state set, so the dialog stays on screen after it was answered —
 * exactly the bug the old "remove the overlay by hand" code had, with fewer exit
 * paths to miss.
 */
export function DialogView({
  dialog,
  onClose,
  destructive,
}: {
  dialog: Dialog;
  onClose(answer: DialogAnswer): void;
  /**
   * The word on the confirm button for a `confirm` dialog.
   *
   * A parameter because the same question is asked about two different things —
   * deleting files and taking books off a shelf — and the *button* is the same word
   * for "yes, do the thing I picked" in both cases. It used to be threaded through
   * from each call site, which is how one dialog ended up saying two different
   * things about the same control.
   */
  destructive: string;
}): JSX.Element {
  return (
    <div
      className="dialog-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose(dialog.kind === 'confirm' ? false : null);
      }}
    >
      {dialog.kind === 'prompt' ? (
        <PromptDialog title={dialog.title} value={dialog.value} onClose={(value) => onClose(value)} />
      ) : null}
      {dialog.kind === 'confirm' ? (
        <div className="dialog">
          <h3>{dialog.title}</h3>
          <p className="muted">{dialog.body}</p>
          <div className="dialog-actions">
            <Button onClick={() => onClose(false)}>取消</Button>
            <Button className="danger" onClick={() => onClose(true)}>
              {destructive}
            </Button>
          </div>
        </div>
      ) : null}
      {dialog.kind === 'pick' ? (
        <div className="dialog sheet">
          <h3>{dialog.title}</h3>
          <div className="dialog-list">
            {dialog.options.map((option) => (
              <Button key={option.value} onClick={() => onClose(option.value)}>
                {option.label}
              </Button>
            ))}
          </div>
          <div className="dialog-actions">
            <Button onClick={() => onClose(null)}>取消</Button>
          </div>
        </div>
      ) : null}
      {dialog.kind === 'form' ? <MetadataDialog dialog={dialog} onClose={(fields) => onClose(fields)} /> : null}
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

/**
 * The batch metadata fields.
 *
 * Shared between the two library pages for the same reason the dialog is: the
 * preview page can change a book's author and the manager can change a folder's,
 * and they are one operation on the server.
 */
export const METADATA_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'author', label: '作者' },
  { key: 'publisher', label: '出版社' },
  { key: 'series', label: '系列' },
  { key: 'seriesIndex', label: '系列序号' },
  { key: 'language', label: '语言' },
  { key: 'tags', label: '标签（逗号分隔）' },
  { key: 'pubdate', label: '出版日期' },
];
