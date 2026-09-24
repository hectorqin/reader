import type { ReadingOverrides } from './reading-overrides.ts';
import { useEffect, useMemo, useRef, useState } from './vendor/preact.ts';
import { Modal } from './modal.tsx';
import type { ReaderApi } from '../api/client.ts';
import type { Manifest, Note } from '../api/types.ts';
import type { OfflineStore } from '../store/offline.ts';
import type { SyncEngine } from '../core/sync.ts';
import { PublicationCache } from '../store/publications.ts';
import { OfflineDownload, type DownloadState } from '../core/offline-download.ts';
import { decodeAnchor, encodeAnchor, findText, type SearchHit, type TextAnchor } from './text-anchor.ts';

export interface SearchSection { id: string; title: string; text: string }
export interface ReadingToolsProps {
  api: ReaderApi; cache: PublicationCache; offline: OfflineStore; sync: SyncEngine; manifest: Manifest;
  selection: TextAnchor | null; locator: string; returnLocator: string;
  sections(signal: AbortSignal): AsyncGenerator<SearchSection>;
  navigate(target: TextAnchor | string): Promise<void>;
  overrides: ReadingOverrides;
  saveOverrides(value: ReadingOverrides): Promise<void>;
  undoOverrides(): Promise<void>;
  previewHeadings(prefix: string): Promise<string[]>;
  onNotes(): void; onClose(): void;
  previewSpeech(): Promise<string>; stopPreview(): void;
}

export function ReadingTools(props: ReadingToolsProps) {
  const [tab, setTab] = useState<'search' | 'notes' | 'offline' | 'speech' | 'edit'>(props.selection ? 'notes' : 'search');
  const [query, setQuery] = useState(''), [hits, setHits] = useState<SearchHit[]>([]);
  const [scanned, setScanned] = useState(0), [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');
  const [replacement, setReplacement] = useState(''), [prefix, setPrefix] = useState(props.overrides.headingPrefix);
  const [headingPreview, setHeadingPreview] = useState<string[] | null>(null), [saving, setSaving] = useState(false);
  async function edit(work: () => Promise<void>) { if (saving) return; setSaving(true); await action(work); if (alive.current) setSaving(false); }
  const [notes, setNotes] = useState<Note[]>(props.offline.notesFor(props.manifest.book.id));
  const [comment, setComment] = useState(''), [editing, setEditing] = useState<Note | null>(null);
  const [color, setColor] = useState('#ffd54f');
  const [composing, setComposing] = useState(!!props.selection);
  const [noteFilter, setNoteFilter] = useState<'all' | 'bookmark' | 'annotation'>('all');
  const [deleteId, setDeleteId] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const [from, setFrom] = useState(1), [to, setTo] = useState(['chapters', 'txt'].includes(props.manifest.book.format) ? props.manifest.content?.total ?? 1 : 1);
  const [downloadReady, setDownloadReady] = useState(false);
  const [download, setDownload] = useState<DownloadState | null>(null);
  const [usage, setUsage] = useState(0), [books, setBooks] = useState<Array<{ id: string; bytes: number }>>([]), [quota, setQuota] = useState(256);
  const [removeId, setRemoveId] = useState('');
  const [returnTo] = useState(props.returnLocator);
  const searchRun = useRef<AbortController | null>(null), alive = useRef(true);
  const task = useMemo(() => new OfflineDownload(props.api, props.cache, props.manifest, state => { if (alive.current) setDownload(state); }), []);
  const bookId = props.manifest.book.id;
  const rangedDownload = ['chapters', 'txt'].includes(props.manifest.book.format) && !props.overrides.headingPrefix;
  const visibleNotes = notes.filter(note => noteFilter === 'all' || (noteFilter === 'bookmark' ? note.type === 'bookmark' : note.type !== 'bookmark'));
  const bookmarked = notes.some(note => note.type === 'bookmark' && note.locator === props.locator);
  useEffect(() => { if (editing || composing) editorRef.current?.querySelector('textarea')?.focus(); }, [editing, composing]);
  async function storage() {
    const entries = await props.cache.entries(), grouped = new Map<string, number>();
    for (const entry of entries) grouped.set(entry.bookId, (grouped.get(entry.bookId) ?? 0) + entry.bytes);
    if (!alive.current) return;
    setUsage(entries.reduce((sum, e) => sum + e.bytes, 0)); setBooks([...grouped].map(([id, bytes]) => ({ id, bytes })));
    setQuota((await props.cache.quota()) / 1024 / 1024);
  }
  async function action(work: () => Promise<unknown>) {
    try { await work(); } catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : '操作失败'); }
  }
  useEffect(() => {
    void action(async () => { await task.load(); if (!alive.current) return; setDownloadReady(true); if (task.state.status !== 'idle') { setFrom(task.state.from); setTo(task.state.to); } await storage(); });
    return () => { alive.current = false; searchRun.current?.abort(); if (task.state.status === 'running') void task.pause().catch(() => undefined); props.stopPreview(); };
  }, []);
  async function search() {
    searchRun.current?.abort(); const run = searchRun.current = new AbortController();
    setHits([]); setScanned(0); setSearching(true); setMessage('');
    const found: SearchHit[] = []; let count = 0;
    try {
      for await (const section of props.sections(run.signal)) {
        run.signal.throwIfAborted();
        found.push(...findText(section.id, section.title, section.text, query.trim(), 200 - found.length));
        if (alive.current) { setHits([...found]); setScanned(++count); }
        if (found.length >= 200) { setMessage('已显示前 200 个命中，请缩小关键词范围'); break; }
      }
    } catch (error) {
      if (!run.signal.aborted && alive.current) setMessage(error instanceof Error ? error.message : '搜索失败，已有结果保留');
    } finally { if (searchRun.current === run && alive.current) setSearching(false); }
  }
  async function saveNote(bookmark = false) {
    const selected = props.selection;
    if (!bookmark && !editing && !selected) throw new Error('先在正文选择文字，再打开阅读工具');
    const note: Note = editing && !bookmark ? { ...editing, type: editing.type === 'bookmark' ? 'bookmark' : comment.trim() ? 'note' : 'highlight', comment, color, updatedAt: Date.now() } : {
      id: crypto.randomUUID(), bookId, type: bookmark ? 'bookmark' : comment.trim() ? 'note' : 'highlight',
      locator: bookmark ? props.locator : encodeAnchor(selected!), text: bookmark ? props.manifest.book.title : selected!.quote,
      comment: bookmark ? '' : comment, color: bookmark ? '' : color, updatedAt: Date.now(),
    };
    await props.offline.upsertNotes([note]); props.sync.schedule();
    setNotes(props.offline.notesFor(bookId));
    if (!bookmark) { setComment(''); setEditing(null); setComposing(false); }
    setNoteFilter(bookmark ? 'bookmark' : 'all'); props.onNotes(); setMessage(bookmark ? '已添加当前位置书签' : '笔记已保存');
  }
  return <Modal title="阅读工具" busy={saving} onClose={props.onClose}>
    <div className="reading-tools">
      <nav className="reading-tool-tabs" aria-label="阅读工具分类">{([
        ['search', '搜索', '书内搜索'], ['notes', '笔记', '笔记'], ['offline', '缓存', '离线缓存'], ['speech', '朗读', '朗读检测'], ['edit', '整理', '内容整理'],
      ] as const).map(([id, label, accessible]) => <button className="reading-tool-tab" type="button" aria-label={accessible} aria-pressed={tab === id} aria-controls="reading-tool-panel" onClick={() => { setTab(id); setMessage(''); }}>{label}</button>)}</nav>
      <div className="reading-tool-panel" id="reading-tool-panel">
      {message && <p className="reading-tool-feedback" role="status">{message}</p>}
      {tab === 'search' && <section aria-label="书内搜索">
        <h3>书内搜索</h3>
        <form className="reading-tool-search" onSubmit={event => { event.preventDefault(); if (query.trim()) void search(); }}><label>关键词<input placeholder="输入要查找的文字" value={query} maxLength={200} onInput={event => setQuery(event.currentTarget.value)} /></label><button className="button primary" disabled={searching || !query.trim()}>搜索全文</button></form>
        {searching && <button className="button" onClick={() => { searchRun.current?.abort(); setSearching(false); }}>停止搜索</button>}
        <p role="status">已扫描 {scanned} 章，找到 {hits.length} 处</p>
        <button className="button" disabled={!returnTo} onClick={() => void action(async () => { await props.navigate(returnTo); props.onClose(); })}>返回原阅读位置</button>
        <ol className="reading-tool-results">{hits.map((hit, index) => <li key={index}><button className="button" onClick={() => void action(async () => { await props.navigate(hit.anchor); props.onClose(); })}><strong>{hit.title}</strong><span>{hit.excerpt}</span></button></li>)}</ol>
      </section>}
      {tab === 'notes' && <section aria-label="笔记管理">
        <div className="reading-tool-heading"><h3>笔记与书签 <small>{notes.length}</small></h3><button className="button" aria-label={bookmarked ? '已添加当前位置书签' : '添加当前位置书签'} disabled={saving || !props.locator || bookmarked} onClick={() => void edit(() => saveNote(true))}>{bookmarked ? '已加书签' : '＋ 加书签'}</button></div>
        {(editing || composing) && <div className="reading-note-editor" ref={editorRef}>
          <h4>{editing ? '编辑' + (editing.type === 'bookmark' ? '书签' : '笔记') : '记录所选文字'}</h4>
          <blockquote>{editing?.text ?? props.selection?.quote}</blockquote>
          <label><span>批注 <small>可选</small></span><textarea aria-label="批注" disabled={saving} placeholder={editing?.type === 'bookmark' ? '为这个位置添加备注' : '写下想法，或留空仅保存高亮'} value={comment} maxLength={4000} onInput={event => setComment(event.currentTarget.value)} /></label>
          {editing?.type !== 'bookmark' && <div className="reading-note-colors" role="group" aria-label="高亮颜色"><span>高亮颜色</span>{[['#ffd54f', '黄色'], ['#80cbc4', '绿色'], ['#ce93d8', '紫色']].map(([value, label]) => <button type="button" disabled={saving} aria-label={label} aria-pressed={color === value} style={{ '--note-color': value }} onClick={() => setColor(value)}>{color === value ? '✓' : ''}</button>)}</div>}
          <div className="reading-tool-actions"><button className="button" disabled={saving} onClick={() => { setEditing(null); setComposing(false); setComment(''); }}>取消编辑</button><button className="button primary" disabled={saving} onClick={() => void edit(() => saveNote())}>{editing ? '保存修改' : comment.trim() ? '保存批注' : '保存高亮'}</button></div>
        </div>}
        {!editing && !composing && props.selection && <button className="button" onClick={() => setComposing(true)}>为所选文字添加笔记</button>}
        {!editing && !composing && <><div className="reading-note-filters" role="group" aria-label="笔记筛选">{([['all', '全部'], ['bookmark', '书签'], ['annotation', '高亮与批注']] as const).map(([value, label]) => <button type="button" aria-pressed={noteFilter === value} onClick={() => { setNoteFilter(value); setDeleteId(''); }}>{label}</button>)}</div>
        <ul className="reading-note-list">{visibleNotes.map(note => <li key={note.id}>
          <button className="reading-note-open" disabled={saving} onClick={() => void action(async () => { await props.navigate(decodeAnchor(note.locator) ?? note.locator); props.onClose(); })}><span className="reading-note-kind">{note.type === 'bookmark' ? '书签' : note.type === 'highlight' ? '高亮' : '批注'}<span>跳转阅读 ›</span></span><strong>{note.text || '书签'}</strong>{note.comment && <span className="reading-note-comment">{note.comment}</span>}</button>
          <div className="reading-note-actions">{deleteId === note.id ? <><span>删除这条{note.type === 'bookmark' ? '书签' : '笔记'}？</span><button type="button" disabled={saving} onClick={() => setDeleteId('')}>取消</button><button type="button" disabled={saving} onClick={() => void edit(async () => { await props.offline.deleteNote(note.id); props.sync.schedule(); setNotes(props.offline.notesFor(bookId)); setDeleteId(''); props.onNotes(); })}>确认删除</button></> : <><button type="button" disabled={saving} onClick={() => { setEditing(note); setComment(note.comment); setColor(note.color || '#ffd54f'); setDeleteId(''); }}>编辑</button><button type="button" disabled={saving} onClick={() => setDeleteId(note.id)}>删除笔记</button></>}</div>
        </li>)}</ul>
        {!visibleNotes.length && <div className="reading-tool-empty"><strong>{noteFilter === 'bookmark' ? '还没有书签' : noteFilter === 'annotation' ? '还没有高亮或批注' : '还没有阅读记录'}</strong><p>加书签，记住当前读到的位置。<br />在正文选中文字后，可添加高亮或批注。</p>{!props.selection && <button className="button" onClick={props.onClose}>返回正文</button>}</div>}</>}
      </section>}
      {tab === 'offline' && <section aria-label="离线缓存管理">
        <p>缓存保存在当前设备、当前账号。关闭此面板会暂停任务，已下载内容保留。</p>
        {rangedDownload && <div className="reading-tool-range"><label>起始章<input type="number" min={1} max={props.manifest.content?.total} value={from} onInput={e => setFrom(Number(e.currentTarget.value))} /></label><label>结束章<input type="number" min={from} max={props.manifest.content?.total} value={to} onInput={e => setTo(Number(e.currentTarget.value))} /></label></div>}
        <div className="reading-tool-actions">{download?.status === 'running' ? <><button className="button" onClick={() => void action(() => task.pause())}>暂停</button><button className="button" onClick={() => void action(() => task.pause(true))}>取消任务</button></> : <button className="button primary" disabled={!downloadReady} onClick={() => void action(async () => { await task.start(rangedDownload ? from : 1, rangedDownload ? to : 1); await storage(); })}>下载 / 继续</button>}</div>
        {download && <p role="status">{download.message} · {download.completed}/{download.total}</p>}
        <p>当前账号缓存占用 {(usage / 1024 / 1024).toFixed(1)} MiB</p>
        <details className="reading-tool-advanced"><summary>存储管理与配额</summary><div><label>设备账号配额（MiB）<input type="number" min={1} max={10240} value={quota} onInput={e => setQuota(Number(e.currentTarget.value))} /></label>
        <button className="button" onClick={() => void action(async () => { await props.cache.setQuota(quota * 1024 * 1024); setMessage('配额已保存'); })}>保存配额</button>
        <ul>{books.map(book => <li key={book.id}>{props.offline.current.books[book.id]?.title ?? (book.id === bookId ? props.manifest.book.title : book.id)} · {(book.bytes / 1024 / 1024).toFixed(1)} MiB <button className="button" disabled={download?.status === 'running'} onClick={() => setRemoveId(book.id)}>清理缓存</button></li>)}</ul>
        {removeId && <div role="group" aria-label="确认清理缓存"><p>只删除此设备的书籍缓存，保留原书、进度和笔记。</p><button className="button" onClick={() => void action(async () => { await props.cache.removeBook(removeId); setRemoveId(''); setDownload(null); await storage(); })}>确认清理</button><button className="button" onClick={() => setRemoveId('')}>保留缓存</button></div>}
        </div></details>
      </section>}
      {tab === 'edit' && <section aria-label="内容整理">
        <p>个人整理规则保存在服务器，联网时保存；原书保持不变。清空替换内容可过滤选中的文字。</p>
        <blockquote>{props.selection?.quote ?? '请先在正文选择需要纠正的文字'}</blockquote>
        <label>替换为<textarea maxLength={4000} value={replacement} onInput={e => setReplacement(e.currentTarget.value)} /></label>
        <button className="button" disabled={saving || !props.selection || props.selection.quote.length > 4000} onClick={() => void edit(async () => { await props.saveOverrides({ ...props.overrides, corrections: [...props.overrides.corrections, {id: crypto.randomUUID(),anchor:props.selection!,replacement}] }); setMessage('纠错已保存，正文已更新'); })}>保存纠错 / 过滤</button>
        <ul>{props.overrides.corrections.map(c => <li key={c.id}>{c.anchor.quote.slice(0,60)} → {c.replacement.slice(0,60) || '（过滤）'} <button className="button" disabled={saving} onClick={() => void edit(() => props.saveOverrides({ ...props.overrides,corrections:props.overrides.corrections.filter(item => item.id !== c.id) }))}>移除此项</button></li>)}</ul>
        <button className="button" disabled={saving || props.overrides.version === 0} onClick={() => void edit(async () => { await props.undoOverrides(); setMessage('已撤销上一次整理修改'); })}>撤销上一次整理修改</button>
        {props.manifest.book.format === 'txt' && <>
          <h3>TXT 目录规则</h3><p>匹配以指定文字开头、长度不超过 80 字的行；留空恢复自动识别。应用会重新划分章节并从首章打开，旧笔记仍保留。</p>
          <label>常用模板<select value="" onChange={e => { setPrefix(e.currentTarget.value); setHeadingPreview(null); }}><option value="">自动识别</option><option value="第">中文章回</option><option value="Chapter ">英文 Chapter</option><option value="【">方括号标题</option></select></label>
          <label>标题开头<input maxLength={60} value={prefix} onInput={e => { setPrefix(e.currentTarget.value); setHeadingPreview(null); }} /></label>
          <button className="button" disabled={saving} onClick={() => void edit(async () => setHeadingPreview(await props.previewHeadings(prefix)))}>预览目录</button>
          {headingPreview && <><p>识别 {headingPreview.length} 个章节，展示前 100 项</p><ol>{headingPreview.slice(0,100).map((title,i) => <li key={i}>{title}</li>)}</ol><button className="button" disabled={saving} onClick={() => void edit(async () => { await props.saveOverrides({ ...props.overrides, headingPrefix:prefix }); setMessage('目录规则已保存'); })}>应用预览规则</button></>}
        </>}
      </section>}
      {tab === 'speech' && <section aria-label="朗读检测"><p>使用当前朗读设置试听。HTTP 引擎会请求服务端合成试听音频。</p><button className="button" onClick={() => void action(async () => setMessage(await props.previewSpeech()))}>检测并试听</button><button className="button" onClick={props.stopPreview}>停止试听</button><p>若浏览器限制播放，请点击试听后允许音频；可在朗读设置切换系统或 HTTP 引擎。</p></section>}
      </div>
    </div>
  </Modal>;
}
