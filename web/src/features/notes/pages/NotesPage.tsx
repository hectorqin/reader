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
import type { BookReview, LibraryNote, NotesExport, NotesFilter, NotesTag } from '../../../api/client.ts';
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
 * this screen never holds more than the page it shows. A note's words are not
 * written here — they come from the text, in the reader. What this screen does is
 * organise: tag a note, or delete it. With one book picked, it also holds that
 * book's 书评, which is not a note and is saved online.
 */
export function NotesPage() {
  const runtime = useRuntime();
  const [params, setParams] = useSearchParams();
  const q = params.get('q')?.trim() ?? '';
  const type = (TYPES.some(item => item.value === params.get('type')) ? params.get('type') : 'all') as TypeChoice;
  const book = params.get('book') ?? '';
  const tag = params.get('tag') ?? '';
  const page = Math.max(1, Math.floor(Number(params.get('page'))) || 1);
  const set = (patch: Record<string, string>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key); }
    setParams(next, { replace });
  };
  const [input, setInput] = useState(q);
  useEffect(() => setInput(q), [q]);

  const kind: NoteType | '' = type === 'all' ? '' : type;
  const filter: NotesFilter = { q, type: kind, bookId: book, tag };
  const list = useQuery({ queryKey: ['notes', 'library', filter, page], queryFn: ({ signal }) => runtime.api.notesLibrary({ ...filter, page }, { signal }) });
  const books = useQuery({ queryKey: ['notes', 'books', q, kind, tag], queryFn: ({ signal }) => runtime.api.notesLibraryBooks({ q, type: kind, tag }, { signal }) });
  const tags = useQuery({ queryKey: ['notes', 'tags'], queryFn: ({ signal }) => runtime.api.notesLibraryTags({ signal }) });
  const review = useQuery({ queryKey: ['notes', 'review', book], queryFn: ({ signal }) => runtime.api.bookReview(book, { signal }), enabled: !!book });
  const [writing, setWriting] = useState(false);
  const total = list.data?.total ?? 0;
  const pages = list.data ? Math.max(1, Math.ceil(total / list.data.pageSize)) : 1;
  // Only the response knows how many pages there are: a page past the end is clamped
  // after it, and the address is rewritten so Back does not return to the empty page.
  useEffect(() => { if (list.data && page > pages) set({ page: pages > 1 ? String(pages) : '' }, true); }, [list.data, page, pages]);

  const [removing, setRemoving] = useState<LibraryNote | null>(null);
  const [tagging, setTagging] = useState<LibraryNote | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const filtered = !!(q || kind || book || tag);

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

  async function saveTags(note: LibraryNote, next: string[]) {
    setBusy(true);
    try {
      // The same path as any note edit: the offline queue, then the server, then what the server says.
      const { bookTitle: _title, bookAuthor: _author, ...record } = note;
      await runtime.offline.upsertNotes([{ ...record, tags: next, updatedAt: Date.now() }]);
      await runtime.sync.flush();
      const [fresh] = await Promise.all([list.refetch(), tags.refetch(), books.refetch()]);
      const saved = fresh.data?.items.find(item => item.id === note.id);
      if (fresh.error || (saved && saved.tags.join('\n') !== next.join('\n'))) notify('标签已保存在本机，尚未同步到服务器，联网后会自动完成', { kind: 'error' });
      else notify('标签已保存');
      setTagging(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : '标签保存失败，请重试', { kind: 'error' });
    } finally { setBusy(false); }
  }

  async function saveReview(body: string) {
    setBusy(true);
    try {
      await runtime.api.saveBookReview(book, body);
      // Re-read, then report: the card shows what the server now holds.
      await Promise.all([review.refetch(), books.refetch()]);
      notify(body.trim() ? '书评已保存' : '书评已删除');
      setWriting(false);
    } catch (error) {
      notify(error instanceof Error ? error.message : '书评保存失败，请重试', { kind: 'error' });
    } finally { setBusy(false); }
  }

  const submit = (event: FormEvent) => { event.preventDefault(); set({ q: input.trim(), page: '' }); };
  const returnTo = `/me/notes${params.size ? `?${params.toString()}` : ''}`;

  return <MediaPageFrame className="media-secondary-page notes-page" title="读书笔记" backTo="/me" backLabel="返回我的"
    actions={<Button className="notes-export-button" disabled={!total && !books.data?.some(item => item.reviewed)} onClick={() => setExporting(true)}><Icon name="download" size={16} />导出</Button>}>
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
          {(books.data ?? []).map(item => <option key={item.bookId} value={item.bookId}>{item.title}（{item.count ? `${item.count} 条` : ''}{item.count && item.reviewed ? ' · ' : ''}{item.reviewed ? '书评' : ''}）</option>)}
        </Select>
        {(tag || !!tags.data?.length) && <Select aria-label="标签" value={tag} onChange={event => set({ tag: event.currentTarget.value, page: '' })}>
          <option value="">全部标签</option>
          {tag && tags.data && !tags.data.some(item => item.tag === tag) && <option value={tag}>{tag}</option>}
          {(tags.data ?? []).map(item => <option key={item.tag} value={item.tag}>{item.tag}（{item.count}）</option>)}
        </Select>}
      </div>
    </div>

    {book && <ReviewCard review={review.data} pending={review.isPending} failed={!!review.error} busy={busy}
      onRetry={() => void review.refetch()} onEdit={() => setWriting(true)} />}

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
              <div className="notes-body">
                <Link className="notes-open" to={`/book/${encodeURIComponent(note.bookId)}`} state={{ openAt: note.locator, returnTo }}>
                  <span className="notes-kind">
                    {note.type === 'bookmark' ? <Icon name="bookmark" size={14} /> : <i className="notes-swatch" aria-hidden="true" />}
                    {KIND[note.type]}
                  </span>
                  {/* A bookmark's text is only its book's title, which the line below already says. */}
                  {note.type !== 'bookmark' && note.text && <span className="notes-quote">{note.text}</span>}
                  {note.comment && <span className="notes-comment">{note.comment}</span>}
                  <span className="notes-meta">{[note.bookTitle, note.chapterTitle, note.bookAuthor, new Date(note.updatedAt).toLocaleDateString('zh-CN')].filter(Boolean).join(' · ')}</span>
                </Link>
                {note.tags.length > 0 && <ul className="notes-tags" aria-label="标签">{note.tags.map(item => <li key={item}>
                  <button type="button" className="notes-tag" aria-pressed={item === tag} aria-label={`只看标签 ${item}`} onClick={() => set({ tag: item === tag ? '' : item, page: '' })}>#{item}</button>
                </li>)}</ul>}
              </div>
              <div className="notes-actions">
                <IconButton icon="tag" label={`编辑这条${KIND[note.type]}的标签`} disabled={busy} onClick={() => setTagging(note)} />
                <IconButton icon="trash" label={`删除这条${KIND[note.type]}`} disabled={busy} onClick={() => setRemoving(note)} />
              </div>
            </li>)}</ol>
            {pages > 1 && <Pager className="shelf-pager" page={Math.min(page, pages)} pageCount={pages} busy={list.isFetching} onGo={next => set({ page: next > 1 ? String(next) : '' })} />}
          </>}

    {removing && <ConfirmSheet danger busy={busy} title={`删除${KIND[removing.type]}`} confirmText="确认删除"
      text={removing.text ? `确定删除「${excerpt(removing.text)}」？删除后所有设备上都不再显示。` : '确定删除这个书签？删除后所有设备上都不再显示。'}
      onCancel={() => setRemoving(null)} onConfirm={() => void remove(removing)} />}
    {writing && <ReviewSheet initial={review.data?.body ?? ''} busy={busy} onClose={() => setWriting(false)} onSave={body => void saveReview(body)} />}
    {tagging && <TagSheet note={tagging} known={tags.data ?? []} busy={busy} onClose={() => setTagging(null)} onSave={next => void saveTags(tagging, next)} />}
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
      setMessage(doc.count || doc.reviews ? await deliver(doc) : '没有可导出的内容：Markdown 不包含书签。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导出失败，请重试');
    } finally { setBusy(false); }
  }
  const save = (doc: NotesExport) => { saveText(doc); return `已导出${amount(doc)}到 ${doc.filename}`; };
  const copy = async (doc: NotesExport) => {
    if (!navigator.clipboard) throw new Error('当前环境不支持剪贴板');
    await navigator.clipboard.writeText(doc.content);
    return `已复制${amount(doc).trimEnd()}`;
  };
  return <Sheet title="导出笔记" size="compact" busy={busy} onClose={onClose}>
    <p className="notes-export-hint">{filtered ? `导出当前筛选出的 ${total} 条。` : `导出全部 ${total} 条。`}书评随所在的书一起导出。Markdown 按书分组，不含书签，适合放进笔记软件；JSON 包含书签与位置，适合备份。</p>
    <div className="notes-export-actions">
      {canSave && <Button disabled={busy} onClick={() => void run('markdown', save)}>下载 Markdown</Button>}
      <Button disabled={busy} onClick={() => void run('markdown', copy)}>复制 Markdown</Button>
      {canSave ? <Button disabled={busy} onClick={() => void run('json', save)}>下载 JSON</Button>
        : <Button disabled={busy} onClick={() => void run('json', copy)}>复制 JSON</Button>}
    </div>
    <p className="notes-export-status" role="status">{busy ? '正在导出…' : message}</p>
  </Sheet>;
}

function amount(doc: NotesExport): string {
  return ` ${[doc.count ? `${doc.count} 条笔记` : '', doc.reviews ? `${doc.reviews} 篇书评` : ''].filter(Boolean).join('、')} `;
}

const REVIEW_MAX_LENGTH = 20000;

/** The picked book's 书评: what the reader wrote about the whole book, above its notes. */
function ReviewCard({ review, pending, failed, busy, onRetry, onEdit }: {
  review: BookReview | null | undefined; pending: boolean; failed: boolean; busy: boolean; onRetry(): void; onEdit(): void;
}) {
  return <section className="notes-review" aria-label="书评">
    <header>
      <h2>书评</h2>
      {!pending && !failed && <Button disabled={busy} onClick={onEdit}><Icon name="edit" size={16} />{review ? '编辑' : '写书评'}</Button>}
    </header>
    {failed ? <p className="notes-review-empty" role="alert">书评读取失败。<button type="button" className="button" onClick={onRetry}>重试</button></p>
      : pending ? <p className="notes-review-empty" role="status">正在读取…</p>
        : review ? <><p className="notes-review-body">{review.body}</p><small className="notes-meta">{new Date(review.updatedAt).toLocaleDateString('zh-CN')}</small></>
          : <p className="notes-review-empty">读完这本书，写下整体的感想。书评随笔记一起导出。</p>}
  </section>;
}

function ReviewSheet({ initial, busy, onClose, onSave }: { initial: string; busy: boolean; onClose(): void; onSave(body: string): void }) {
  const [body, setBody] = useState(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const empty = !body.trim();
  return <Sheet title="书评" busy={busy} onClose={onClose}
    footer={<>
      {initial && <Button className="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>删除</Button>}
      <Button className="primary" disabled={busy || (empty && !initial)} onClick={() => empty ? setConfirmDelete(true) : onSave(body)}>保存</Button>
    </>}>
    <textarea className="notes-review-input" aria-label="书评" maxLength={REVIEW_MAX_LENGTH} value={body} disabled={busy}
      placeholder="这本书讲了什么，哪里打动了你，它让你想到了什么" onInput={event => setBody(event.currentTarget.value)} />
    <p className="notes-export-status">书评保存在服务器上，需要联网；{body.length}/{REVIEW_MAX_LENGTH}</p>
    {confirmDelete && <ConfirmSheet danger busy={busy} title="删除书评" text="确定删除这篇书评？删除后所有设备上都不再显示。" confirmText="确认删除"
      onCancel={() => setConfirmDelete(false)} onConfirm={() => { setConfirmDelete(false); onSave(''); }} />}
  </Sheet>;
}

const TAG_MAX_LENGTH = 32, TAGS_MAX = 10;

/** A note's tags: remove one, type new ones, or pick from the tags already in use. */
function TagSheet({ note, known, busy, onClose, onSave }: { note: LibraryNote; known: NotesTag[]; busy: boolean; onClose(): void; onSave(tags: string[]): void }) {
  const [tags, setTags] = useState(note.tags);
  const [input, setInput] = useState('');
  const [message, setMessage] = useState('');
  // Returns the list with the typed tags added, or null (with the reason shown) when one is not allowed.
  function added(text: string): string[] | null {
    const typed = text.split(/[,，、\n]/).map(item => item.replace(/^#/, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const next = [...new Set([...tags, ...typed])];
    if (typed.some(item => item.length > TAG_MAX_LENGTH)) { setMessage(`标签最长 ${TAG_MAX_LENGTH} 个字`); return null; }
    if (next.length > TAGS_MAX) { setMessage(`一条笔记最多 ${TAGS_MAX} 个标签`); return null; }
    setMessage('');
    return next;
  }
  const add = (text: string) => { const next = added(text); if (next) { setTags(next); setInput(''); } };
  // 保存 also takes what is still in the field: a typed tag is not lost for want of pressing 添加.
  const save = () => { const next = added(input); if (next) onSave(next); };
  const suggestions = known.filter(item => !tags.includes(item.tag)).slice(0, 12);
  return <Sheet title="标签" size="compact" busy={busy} onClose={onClose} subtitle={excerpt(note.type === 'bookmark' ? note.bookTitle : note.text || note.comment)}
    footer={<Button className="primary" disabled={busy} onClick={save}>保存</Button>}>
    {tags.length > 0 ? <ul className="notes-tags notes-tags-editing" aria-label="已有标签">{tags.map(item => <li key={item}>
      <button type="button" className="notes-tag" disabled={busy} aria-label={`移除标签 ${item}`} onClick={() => setTags(tags.filter(other => other !== item))}>#{item}<Icon name="close" size={14} /></button>
    </li>)}</ul> : <p className="notes-export-hint">这条笔记还没有标签。</p>}
    <form className="notes-tag-form" onSubmit={event => { event.preventDefault(); add(input); }}>
      <input aria-label="新标签" placeholder="输入标签，多个用逗号分隔" maxLength={200} value={input} disabled={busy} onInput={event => setInput(event.currentTarget.value)} />
      <Button type="submit" disabled={busy || !input.trim()}>添加</Button>
    </form>
    {suggestions.length > 0 && <ul className="notes-tags" aria-label="常用标签">{suggestions.map(item => <li key={item.tag}>
      <button type="button" className="notes-tag" disabled={busy} aria-label={`添加标签 ${item.tag}`} onClick={() => add(item.tag)}>#{item.tag}</button>
    </li>)}</ul>}
    <p className="notes-export-status" role="status">{message}</p>
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
