/**
 * 编辑信息: a book's title, author and the rest, set by hand.
 *
 * What is saved is a manual value on the server, shared by every reader and kept
 * above whatever a rescan reads from the file (docs/architecture.md, metadata
 * precedence). A field that holds a manual value can be put back to the file's own
 * with 恢复, which is a separate request: an empty field is a value too (a blank
 * series is a choice), so clearing the input is not the same as undoing the edit.
 *
 * A local book is edited only by an administrator (the server refuses anyone else
 * with ADMIN_REQUIRED); a book from a book source by the reader who has it.
 *
 * Opened from the shelf's ⋯ and from a book's detail in 书库; both pass only the
 * book id, and the sheet reads the book itself so it always starts from the
 * server's values rather than a list row that may be older.
 */
import { type JSX, useEffect, useState } from 'react';
import type { Book, BookMetadataField } from '../api/types.ts';
import { describeError } from '../api/errors.ts';
import { useRuntime } from '../app/providers/runtime-context.tsx';
import { notify } from './notifications.ts';
import { Sheet } from './sheet.tsx';
import { Button, Callout } from './toolkit.tsx';

const FIELDS: Array<{ key: BookMetadataField; label: string; wide?: boolean; hint?: string; numeric?: boolean }> = [
  { key: 'title', label: '书名' },
  { key: 'author', label: '作者' },
  { key: 'series', label: '系列' },
  { key: 'seriesIndex', label: '系列序号', numeric: true },
  { key: 'publisher', label: '出版社' },
  { key: 'pubdate', label: '出版日期', hint: '例如 2008-01 或 2008' },
  { key: 'isbn', label: 'ISBN' },
  { key: 'language', label: '语言', hint: '例如 zh、en' },
  { key: 'tags', label: '标签', hint: '用逗号分隔' },
  { key: 'description', label: '简介', wide: true },
];

/** The book's current value of a field, as the text its input shows. */
export function fieldText(book: Book, key: BookMetadataField): string {
  if (key === 'tags') return book.tags.join(', ');
  if (key === 'seriesIndex') return book.seriesIndex === null ? '' : String(book.seriesIndex);
  return book[key] ?? '';
}

/** Only what changed is sent, so saving one field does not pin every other one as manual. */
export function metadataPatch(book: Book, values: Partial<Record<BookMetadataField, string>>): Partial<Record<BookMetadataField, string | string[]>> {
  const patch: Partial<Record<BookMetadataField, string | string[]>> = {};
  for (const [key, raw] of Object.entries(values) as Array<[BookMetadataField, string]>) {
    const value = raw.trim();
    if (value === fieldText(book, key).trim()) continue;
    patch[key] = key === 'tags' ? value.split(/[,，、]/).map(tag => tag.trim()).filter(Boolean) : value;
  }
  return patch;
}

export function BookMetadataSheet({ bookId, onClose, onSaved }: { bookId: string; onClose(): void; onSaved?(book: Book): void }): JSX.Element {
  const { api } = useRuntime();
  const [book, setBook] = useState<Book | null>(null);
  const [values, setValues] = useState<Partial<Record<BookMetadataField, string>>>({});
  const [loadError, setLoadError] = useState<unknown>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api.getBook(bookId, { signal: controller.signal })
      .then(({ book }) => { setBook(book); setValues({}); })
      .catch(reason => { if (!controller.signal.aborted) setLoadError(reason); });
    return () => controller.abort();
  }, [api, bookId]);

  const patch = book ? metadataPatch(book, values) : {};
  const dirty = Object.keys(patch).length > 0;
  const titleBlank = !!book && (values.title ?? book.title).trim() === '';
  const indexInvalid = !!book && !!values.seriesIndex?.trim() && !Number.isFinite(Number(values.seriesIndex.trim()));
  const applied = (next: Book, message: string) => { setBook(next); setValues({}); onSaved?.(next); notify(message, { kind: 'success' }); };

  const save = async () => {
    if (!book || !dirty || titleBlank || indexInvalid) return;
    setBusy(true); setError('');
    try {
      applied(await api.updateBookMetadata(book.id, patch), '书籍信息已保存');
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试'); }
    finally { setBusy(false); }
  };
  const restore = async (key: BookMetadataField, label: string) => {
    if (!book) return;
    setBusy(true); setError('');
    try {
      const next = await api.clearBookMetadata(book.id, key);
      // The input follows the restored value; other unsaved edits stay as typed.
      setValues(current => { const rest = { ...current }; delete rest[key]; return rest; });
      setBook(next); onSaved?.(next); notify(`已恢复${label}为文件中的值`, { kind: 'success' });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '恢复失败，请重试'); }
    finally { setBusy(false); }
  };

  return <Sheet title="编辑信息" subtitle={book ? `《${book.title}》` : undefined} busy={busy} onClose={onClose}
    footer={<><Button onClick={onClose} disabled={busy}>取消</Button><Button className="primary" type="submit" form="book-metadata-form" disabled={!dirty || busy || titleBlank || indexInvalid}>{busy ? '正在保存…' : '保存'}</Button></>}>
    {!book && !loadError && <p className="muted" role="status">正在读取书籍信息…</p>}
    {loadError != null && <Callout tone="error">{describeError(loadError)}</Callout>}
    {book && <form id="book-metadata-form" className="sheet-form book-metadata-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <p className="muted">{book.format === 'chapters' ? '保存为手动值，之后的更新不会覆盖。' : '保存后对所有读者生效，重新扫描不会覆盖。'}</p>
      {FIELDS.map(({ key, label, wide, hint, numeric }) => {
        const manual = book.manualFields.includes(key);
        const value = values[key] ?? fieldText(book, key);
        const set = (next: string) => setValues(current => ({ ...current, [key]: next }));
        return <label className={'sheet-field' + (wide ? ' is-wide' : '')} key={key}>
          <span className="book-metadata-label">{label}{manual && <>
            <span className="manager-badge">已手动修改</span>
            <button type="button" className="book-metadata-restore" disabled={busy} onClick={event => { event.preventDefault(); void restore(key, label); }}>恢复</button>
          </>}</span>
          {wide
            ? <textarea rows={5} value={value} disabled={busy} maxLength={32000} onChange={event => set(event.currentTarget.value)} />
            : <input type="text" value={value} disabled={busy} maxLength={key === 'title' ? 500 : 2000} inputMode={numeric ? 'decimal' : undefined}
              aria-invalid={(key === 'title' && titleBlank) || (key === 'seriesIndex' && indexInvalid) || undefined} onChange={event => set(event.currentTarget.value)} />}
          {key === 'title' && titleBlank ? <small role="alert">书名不能为空</small>
            : key === 'seriesIndex' && indexInvalid ? <small role="alert">请输入数字，例如 1 或 2.5</small>
            : hint && <small>{hint}</small>}
        </label>;
      })}
      {error && <Callout tone="error">{error}</Callout>}
    </form>}
  </Sheet>;
}
