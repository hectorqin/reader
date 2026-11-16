import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { MediaPageFrame } from '../../media/components/MediaPageFrame.tsx';
import { Button, IconButton, Segmented } from '../../../ui/toolkit.tsx';
import { Icon } from '../../../ui/icon.tsx';
import { Select } from '../../../ui/select.tsx';
import { Pager } from '../../../ui/pager.tsx';
import { ConfirmSheet, Sheet } from '../../../ui/sheet.tsx';
import { notify } from '../../../ui/notifications.ts';
import type { LibraryNote, NotesExport, NotesFilter } from '../../../api/client.ts';
import type { NoteType } from '../../../api/types.ts';
import '../styles/notes.css';

type TypeChoice = 'all' | NoteType;
const TYPES: Array<{ value: TypeChoice; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'highlight', label: '高亮' },
  { value: 'note', label: '批注' },
  { value: 'bookmark', label: '书签' },
];
const KIND: Record<NoteType, string> = { highlight: '高亮', note: '批注', bookmark: '书签' };

/**
 * 读书笔记: every highlight, annotation and bookmark of this account, across books
 * (docs/notes-library.zh-CN.md).
 *
 * The words searched for, the type, the book and the page all live in the URL, so
 * coming back from a book returns to the same view. The server filters and pages;
 * this screen never holds more than the page it shows. Notes are not written here —
 * they come from the text, in the reader — except that one can be deleted.
 */
export function NotesPage() {
  const runtime = useRuntime();
  const [params, setParams] = useSearchParams();
  const q = params.get('q')?.trim() ?? '';
  const type = (TYPES.some(item => item.value === params.get('type')) ? params.get('type') : 'all') as TypeChoice;
  const book = params.get('book') ?? '';
  const page = Math.max(1, Math.floor(Number(params.get('page'))) || 1);
  const set = (patch: Record<string, string>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key); }
    setParams(next, { replace });
  };
  const [input, setInput] = useState(q);
  useEffect(() => setInput(q), [q]);

  const kind: NoteType | '' = type === 'all' ? '' : type;
  const filter: NotesFilter = { q, type: kind, bookId: book };
  const list = useQuery({ queryKey: ['notes', 'library', filter, page], queryFn: ({ signal }) => runtime.api.notesLibrary({ ...filter, page }, { signal }) });
  const books = useQuery({ queryKey: ['notes', 'books', q, kind], queryFn: ({ signal }) => runtime.api.notesLibraryBooks({ q, type: kind }, { signal }) });
  const total = list.data?.total ?? 0;
  const pages = list.data ? Math.max(1, Math.ceil(total / list.data.pageSize)) : 1;
  // Only the response knows how many pages there are: a page past the end is clamped
  // after it, and the address is rewritten so Back does not return to the empty page.
  useEffect(() => { if (list.data && page > pages) set({ page: pages > 1 ? String(pages) : '' }, true); }, [list.data, page, pages]);

  const [removing, setRemoving] = useState<LibraryNote | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const filtered = !!(q || kind || book);

  async function remove(note: LibraryNote) {
    setBusy(true);
    try {
      // The reader's own path: the offline queue, then the server. Report what the server says afterwards.
      await runtime.offline.deleteNote(note.id);
      await runtime.sync.flush();
      const [fresh] = await Promise.all([list.refetch(), books.refetch()]);
      if (fresh.error) notify('已在本机删除，暂时无法连接服务器，联网后会同步', { kind: 'error' });
      else if (fresh.data?.items.some(item => item.id === note.id)) notify('已在本机删除，尚未同步到服务器，联网后会自动完成', { kind: 'error' });
      else notify('已删除');
    } catch (error) {
      notify(error instanceof Error ? error.message : '删除失败，请重试', { kind: 'error' });
    } finally { setBusy(false); setRemoving(null); }
  }

  const submit = (event: FormEvent) => { event.preventDefault(); set({ q: input.trim(), page: '' }); };
  const returnTo = `/me/notes${params.size ? `?${params.toString()}` : ''}`;

  return <MediaPageFrame className="media-secondary-page notes-page" title="读书笔记" backTo="/me" backLabel="返回我的"
    actions={<Button className="notes-export-button" disabled={!total} onClick={() => setExporting(true)}><Icon name="download" size={16} />导出</Button>}>
    <div className="notes-controls">
      <form className="notes-search" role="search" onSubmit={submit}>
        <input type="search" aria-label="搜索笔记" placeholder="搜索原文或批注" maxLength={200} value={input} onInput={event => setInput(event.currentTarget.value)} />
        {q && <IconButton icon="close" label="清除搜索" onClick={() => set({ q: '', page: '' })} />}
      </form>
      <div className="notes-filters">
        <Segmented label="笔记类型" options={TYPES} value={type} onChange={value => set({ type: value === 'all' ? '' : value, page: '' })} />
        <Select aria-label="书籍" value={book} onChange={event => set({ book: event.currentTarget.value, page: '' })}>
          <option value="">全部书籍</option>
          {/* A book picked earlier stays choosable when the other filters no longer match it. */}
          {book && books.data && !books.data.some(item => item.bookId === book) && <option value={book}>当前书籍（无匹配）</option>}
          {(books.data ?? []).map(item => <option key={item.bookId} value={item.bookId}>{item.title}（{item.count}）</option>)}
        </Select>
      </div>
    </div>

    {list.error
      ? <p className="notes-state" role="alert">笔记读取失败。<button type="button" className="button" onClick={() => void list.refetch()}>重试</button></p>
      : list.isPending
        ? <p className="notes-state" role="status">正在读取…</p>
        : total === 0
          ? <div className="notes-state" role="status">
            <strong>{filtered ? '没有符合条件的笔记' : '还没有笔记'}</strong>
            <p>{filtered ? '换个关键词，或放宽筛选。' : '阅读时选中文字可添加高亮或批注，在「工具 → 笔记」里可加书签。'}</p>
            {filtered && <button type="button" className="button" onClick={() => setParams(new URLSearchParams())}>清除筛选</button>}
          </div>
          : <>
            <p className="notes-count" aria-live="polite">共 {total} 条</p>
            <ol className="notes-list">{list.data.items.map(note => <li key={note.id} className="notes-item" data-type={note.type} style={note.color ? { '--note-color': note.color } as CSSProperties : undefined}>
              <Link className="notes-open" to={`/book/${encodeURIComponent(note.bookId)}`} state={{ openAt: note.locator, returnTo }}>
                <span className="notes-kind">
                  {note.type === 'bookmark' ? <Icon name="bookmark" size={14} /> : <i className="notes-swatch" aria-hidden="true" />}
                  {KIND[note.type]}
                </span>
                {note.text && <span className="notes-quote">{note.text}</span>}
                {note.comment && <span className="notes-comment">{note.comment}</span>}
                <span className="notes-meta">{note.bookTitle}{note.bookAuthor ? ` · ${note.bookAuthor}` : ''} · {new Date(note.updatedAt).toLocaleDateString('zh-CN')}</span>
              </Link>
              <IconButton icon="trash" label={`删除这条${KIND[note.type]}`} disabled={busy} onClick={() => setRemoving(note)} />
            </li>)}</ol>
            {pages > 1 && <Pager className="shelf-pager" page={Math.min(page, pages)} pageCount={pages} busy={list.isFetching} onGo={next => set({ page: next > 1 ? String(next) : '' })} />}
          </>}

    {removing && <ConfirmSheet danger busy={busy} title={`删除${KIND[removing.type]}`} confirmText="确认删除"
      text={removing.text ? `确定删除「${excerpt(removing.text)}」？删除后所有设备上都不再显示。` : '确定删除这个书签？删除后所有设备上都不再显示。'}
      onCancel={() => setRemoving(null)} onConfirm={() => void remove(removing)} />}
    {exporting && <ExportSheet filter={filter} filtered={filtered} total={total} onClose={() => setExporting(false)} />}
  </MediaPageFrame>;
}

/**
 * Export follows the filter on screen. The document arrives as text: a browser saves
 * it as a file, and the Android shell — whose WebView has no downloads — copies it.
 */
function ExportSheet({ filter, filtered, total, onClose }: { filter: NotesFilter; filtered: boolean; total: number; onClose(): void }) {
  const runtime = useRuntime();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const canSave = typeof window.ReaderAndroid === 'undefined';
  async function run(format: 'markdown' | 'json', deliver: (doc: NotesExport) => Promise<string> | string) {
    setBusy(true); setMessage('');
    try {
      const doc = await runtime.api.notesExport(filter, format, -new Date().getTimezoneOffset());
      setMessage(doc.count ? await deliver(doc) : '没有可导出的内容：Markdown 不包含书签。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导出失败，请重试');
    } finally { setBusy(false); }
  }
  const save = (doc: NotesExport) => { saveText(doc); return `已导出 ${doc.count} 条到 ${doc.filename}`; };
  const copy = async (doc: NotesExport) => {
    if (!navigator.clipboard) throw new Error('当前环境不支持剪贴板');
    await navigator.clipboard.writeText(doc.content);
    return `已复制 ${doc.count} 条`;
  };
  return <Sheet title="导出笔记" size="compact" busy={busy} onClose={onClose}>
    <p className="notes-export-hint">{filtered ? `导出当前筛选出的 ${total} 条。` : `导出全部 ${total} 条。`}Markdown 按书分组，不含书签，适合放进笔记软件；JSON 包含书签与位置，适合备份。</p>
    <div className="notes-export-actions">
      {canSave && <Button disabled={busy} onClick={() => void run('markdown', save)}>下载 Markdown</Button>}
      <Button disabled={busy} onClick={() => void run('markdown', copy)}>复制 Markdown</Button>
      {canSave ? <Button disabled={busy} onClick={() => void run('json', save)}>下载 JSON</Button>
        : <Button disabled={busy} onClick={() => void run('json', copy)}>复制 JSON</Button>}
    </div>
    <p className="notes-export-status" role="status">{busy ? '正在导出…' : message}</p>
  </Sheet>;
}

function saveText(doc: NotesExport): void {
  const url = URL.createObjectURL(new Blob([doc.content], { type: `${doc.mime};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url; link.download = doc.filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function excerpt(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}
