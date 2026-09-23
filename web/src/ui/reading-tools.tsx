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
  const [tab, setTab] = useState<'search' | 'notes' | 'offline' | 'speech' | 'edit'>('search');
  const [query, setQuery] = useState(''), [hits, setHits] = useState<SearchHit[]>([]);
  const [scanned, setScanned] = useState(0), [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');
  const [replacement, setReplacement] = useState(''), [prefix, setPrefix] = useState(props.overrides.headingPrefix);
  const [headingPreview, setHeadingPreview] = useState<string[] | null>(null), [saving, setSaving] = useState(false);
  async function edit(work: () => Promise<void>) { if (saving) return; setSaving(true); await action(work); if (alive.current) setSaving(false); }
  const [notes, setNotes] = useState<Note[]>(props.offline.notesFor(props.manifest.book.id));
  const [comment, setComment] = useState(''), [editing, setEditing] = useState<Note | null>(null);
  const [color, setColor] = useState('#ffd54f');
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
      comment, color, updatedAt: Date.now(),
    };
    await props.offline.upsertNotes([note]); props.sync.schedule();
    setNotes(props.offline.notesFor(bookId)); setComment(''); setEditing(null); props.onNotes(); setMessage('已保存，联网后同步');
  }
  return <Modal title="阅读工具" busy={saving} onClose={props.onClose}>
    <div className="reading-tools source-modal-content">
      <nav className="reading-tool-tabs" aria-label="阅读工具分类">{([
        ['search', '书内搜索'], ['notes', '笔记'], ['offline', '离线缓存'], ['speech', '朗读检测'], ['edit', '内容整理'],
      ] as const).map(([id, label]) => <button className="button" type="button" aria-pressed={tab === id} onClick={() => { setTab(id); setMessage(''); }}>{label}</button>)}</nav>
      {message && <p role="status">{message}</p>}
      {tab === 'search' && <section aria-label="书内搜索">
        <form onSubmit={event => { event.preventDefault(); if (query.trim()) void search(); }}><label>关键词<input value={query} maxLength={200} onInput={event => setQuery(event.currentTarget.value)} /></label><button className="button" disabled={searching || !query.trim()}>搜索全文</button></form>
        {searching && <button className="button" onClick={() => { searchRun.current?.abort(); setSearching(false); }}>停止搜索</button>}
        <p role="status">已扫描 {scanned} 章，找到 {hits.length} 处</p>
        <button className="button" disabled={!returnTo} onClick={() => void action(async () => { await props.navigate(returnTo); props.onClose(); })}>返回原阅读位置</button>
        <ol className="reading-tool-results">{hits.map((hit, index) => <li key={index}><button className="button" onClick={() => void action(async () => { await props.navigate(hit.anchor); props.onClose(); })}><strong>{hit.title}</strong><span>{hit.excerpt}</span></button></li>)}</ol>
      </section>}
      {tab === 'notes' && <section aria-label="笔记管理">
        <blockquote>{editing?.text ?? props.selection?.quote ?? '在正文选择文字可高亮或批注；也可保存当前位置书签。'}</blockquote>
        <label>批注<textarea value={comment} maxLength={4000} onInput={event => setComment(event.currentTarget.value)} /></label>
        <label>高亮颜色<select value={color} onChange={event => setColor(event.currentTarget.value)}><option value="#ffd54f">黄色</option><option value="#80cbc4">绿色</option><option value="#ce93d8">紫色</option></select></label>
        <button className="button" disabled={!editing && !props.selection} onClick={() => void action(() => saveNote())}>{editing ? '保存修改' : '保存高亮或批注'}</button>
        <button className="button" disabled={!props.locator} onClick={() => void action(() => saveNote(true))}>添加当前位置书签</button>
        {editing && <button className="button" onClick={() => { setEditing(null); setComment(''); }}>取消编辑</button>}
        <ul className="reading-tool-results">{notes.map(note => <li key={note.id}><button className="button" onClick={() => void action(async () => { await props.navigate(decodeAnchor(note.locator) ?? note.locator); props.onClose(); })}>{note.text || '书签'}{note.comment && <span>{note.comment}</span>}</button>
          <button className="button" onClick={() => { setEditing(note); setComment(note.comment); setColor(note.color || '#ffd54f'); }}>编辑</button><button className="button" onClick={() => void action(async () => { await props.offline.deleteNote(note.id); props.sync.schedule(); setNotes(props.offline.notesFor(bookId)); props.onNotes(); })}>删除笔记</button></li>)}</ul>
        {!notes.length && <p>暂无笔记</p>}
      </section>}
      {tab === 'offline' && <section aria-label="离线缓存管理">
        <p>缓存保存在当前设备、当前账号。关闭此面板会暂停任务，已下载内容保留。</p>
        {rangedDownload && <div className="reading-tool-range"><label>起始章<input type="number" min={1} max={props.manifest.content?.total} value={from} onInput={e => setFrom(Number(e.currentTarget.value))} /></label><label>结束章<input type="number" min={from} max={props.manifest.content?.total} value={to} onInput={e => setTo(Number(e.currentTarget.value))} /></label></div>}
        <button className="button" disabled={!downloadReady || download?.status === 'running'} onClick={() => void action(async () => { await task.start(rangedDownload ? from : 1, rangedDownload ? to : 1); await storage(); })}>下载 / 继续</button>
        <button className="button" disabled={download?.status !== 'running'} onClick={() => void action(() => task.pause())}>暂停</button>
        <button className="button" disabled={download?.status !== 'running'} onClick={() => void action(() => task.pause(true))}>取消任务</button>
        {download && <p role="status">{download.message} · {download.completed}/{download.total}</p>}
        <p>当前账号缓存占用 {(usage / 1024 / 1024).toFixed(1)} MiB</p>
        <label>设备账号配额（MiB）<input type="number" min={1} max={10240} value={quota} onInput={e => setQuota(Number(e.currentTarget.value))} /></label>
        <button className="button" onClick={() => void action(async () => { await props.cache.setQuota(quota * 1024 * 1024); setMessage('配额已保存'); })}>保存配额</button>
        <ul>{books.map(book => <li key={book.id}>{props.offline.current.books[book.id]?.title ?? (book.id === bookId ? props.manifest.book.title : book.id)} · {(book.bytes / 1024 / 1024).toFixed(1)} MiB <button className="button" disabled={download?.status === 'running'} onClick={() => setRemoveId(book.id)}>清理缓存</button></li>)}</ul>
        {removeId && <div role="group" aria-label="确认清理缓存"><p>只删除此设备的书籍缓存，保留原书、进度和笔记。</p><button className="button" onClick={() => void action(async () => { await props.cache.removeBook(removeId); setRemoveId(''); setDownload(null); await storage(); })}>确认清理</button><button className="button" onClick={() => setRemoveId('')}>保留缓存</button></div>}
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
  </Modal>;
}
