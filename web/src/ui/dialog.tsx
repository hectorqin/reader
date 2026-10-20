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
 *
 * Every kind is drawn as a `Sheet` (ui/sheet.tsx), like every other overlay.
 */

import { Button } from './toolkit.tsx';
import { ConfirmSheet, Sheet } from './sheet.tsx';
import { type JSX, useLayoutEffect, useRef } from 'react';

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
  if (dialog.kind === 'confirm') {
    return <ConfirmSheet title={dialog.title} text={dialog.body} confirmText={destructive} danger
      onConfirm={() => onClose(true)} onCancel={() => onClose(false)} />;
  }
  if (dialog.kind === 'prompt') return <PromptDialog title={dialog.title} value={dialog.value} onClose={onClose} />;
  if (dialog.kind === 'form') return <MetadataDialog dialog={dialog} onClose={onClose} />;
  return (
    <Sheet title={dialog.title} size="compact" onClose={() => onClose(null)}>
      <div className="sheet-list">
        {dialog.options.map((option) => (
          <Button key={option.value} onClick={() => onClose(option.value)}>
            {option.label}
          </Button>
        ))}
      </div>
    </Sheet>
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
  // Runs after the sheet has opened and focused the field, so the selection sticks.
  useLayoutEffect(() => { input.current?.select(); }, []);
  const submit = () => onClose(input.current?.value ?? '');
  return (
    <Sheet title={title} size="compact" onClose={() => onClose(null)} initialFocus=".sheet-prompt-input"
      footer={<>
        <Button onClick={() => onClose(null)}>取消</Button>
        <Button className="primary" onClick={submit}>确定</Button>
      </>}>
      <form className="sheet-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <label className="sheet-field">
          <input
            ref={input}
            aria-label={title}
            className="sheet-prompt-input"
            type="text"
            defaultValue={value}
          />
        </label>
      </form>
    </Sheet>
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
  const submit = () => {
    const patch: Record<string, string> = {};
    for (const [key, input] of inputs.current) {
      const value = input.value.trim();
      if (value !== '') patch[key] = value;
    }
    onClose(patch);
  };
  // The fields scroll inside the sheet body and 保存 sits in the pinned footer, so a
  // form with seven fields never puts its only way to commit below the fold.
  return (
    <Sheet title={dialog.title} onClose={() => onClose(null)} initialFocus="input[name=author]"
      footer={<>
        <Button onClick={() => onClose(null)}>取消</Button>
        <Button className="primary" onClick={submit}>保存</Button>
      </>}>
      <form className="sheet-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <p className="sheet-text">留空的字段保持不变。目录会写成它里面每一本书的资料</p>
        {dialog.fields.map((field) => (
          <label className="sheet-field" key={field.key}>
            <span>{field.label}</span>
            <input
              type="text"
              name={field.key}
              placeholder="留空则不改"
              ref={(node) => {
                if (node) inputs.current.set(field.key, node);
                else inputs.current.delete(field.key);
              }}
            />
          </label>
        ))}
      </form>
    </Sheet>
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
