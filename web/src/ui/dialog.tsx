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
 * Two of the three dialogs answer with a string and one with a boolean, and the
 * *shape* of the answer is known from `dialog.kind` at the moment it is resolved. The single guarded cast in `DialogView` is what keeps that knowledge
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
import { ActionSheet } from './action-menu.tsx';
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
    };

/** The answer to a dialog, before `kind` is known to have picked its shape. */
export type DialogAnswer = string | boolean | null;

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
  // A pick is a menu whose answer is the option picked.
  return (
    <ActionSheet title={dialog.title}
      items={dialog.options.map((option) => ({ label: option.label, onSelect: () => onClose(option.value) }))}
      onDismiss={() => onClose(null)} />
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
