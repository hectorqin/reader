/**
 * 换封面: the covers book sources have for this book.
 *
 * A book that came from a source runs the same search as 换源 (same title and author,
 * through its own source library). A local book has no source of its own, so it
 * searches a source the reader picks by the book's title. Either way only editions
 * with a cover are listed, and picking one stores it on the server as this book's
 * cover; the book itself stays as it is. A local book can go back to the cover in
 * its file.
 */
import { type JSX, useEffect, useState } from 'react';
import type { SourceEntry, SourceInstance, SourcePage } from '../api/sources.ts';
import { useRuntime } from '../app/providers/runtime-context.tsx';
import { LazyCover } from './lazy-cover.tsx';
import { notify } from './notifications.ts';
import { Select } from './select.tsx';
import { Sheet } from './sheet.tsx';

export interface CoverBook { id: string; title: string; format?: string | null; manualFields?: string[] }

const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const session = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
/** Sources whose entries can carry a cover the server can read. */
const searchable = (source: SourceInstance) => source.enabled && !!source.descriptor?.capabilities.includes('search') && !!source.descriptor.capabilities.includes('content.resource');

export function ChangeCoverSheet({ book, onClose, onChanged }: { book: CoverBook; onClose(): void; onChanged(): void }): JSX.Element {
  const { api } = useRuntime();
  const fromSource = book.format === 'chapters';
  const [sources, setSources] = useState<SourceInstance[] | null>(fromSource ? [] : null);
  const [sourceId, setSourceId] = useState('');
  const [entries, setEntries] = useState<SourceEntry[]>([]);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [searching, setSearching] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  useEffect(() => {
    if (fromSource) return;
    let live = true;
    void api.sources().then((list) => {
      if (!live) return;
      const usable = list.filter(searchable);
      setSources(usable); setSourceId((usable.find((source) => source.isDefault) ?? usable[0])?.id ?? '');
      if (!usable.length) setSearching(false);
    }).catch((reason) => { if (live) { setSources([]); setSearching(false); setError(reason instanceof Error ? reason.message : '读取书源失败'); } });
    return () => { live = false; };
  }, [api, fromSource]);
  useEffect(() => {
    if (!fromSource && !sourceId) return;
    const run = new AbortController(), title = normalize(book.title);
    setEntries([]); setProgress(null); setSearching(true); setError('');
    void (async () => {
      try {
        const found = new Map<string, SourceEntry>();
        const pages: AsyncIterable<SourcePage> = fromSource
          ? api.alternatives(book.id, { sessionId: session() }, { signal: run.signal })
          : api.searchSource(sourceId, { query: book.title, sessionId: session(), resultLimit: 500 }, { signal: run.signal });
        for await (const page of pages) {
          if (run.signal.aborted) return;
          // A title search also returns near matches; a cover is only offered for this book.
          for (const entry of page.items) if (entry.coverRef && (fromSource || normalize(entry.title) === title)) found.set(entry.ref, entry);
          setEntries([...found.values()]); if (page.batch) setProgress(page.batch);
        }
      } catch (reason) {
        if (!run.signal.aborted) setError(reason instanceof Error ? reason.message : '搜索封面失败');
      } finally { if (!run.signal.aborted) setSearching(false); }
    })();
    return () => run.abort();
  }, [api, book.id, book.title, fromSource, sourceId]);
  const done = (message: string) => { notify(message, { kind: 'success' }); onChanged(); onClose(); };
  const choose = async (entry: SourceEntry) => {
    if (saving || !entry.coverRef) return;
    setSaving(entry.ref); setError('');
    try { await api.changeCover(book.id, entry.ref, entry.coverRef, fromSource ? undefined : sourceId); done(`已更换《${book.title}》的封面`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '更换封面失败'); setSaving(''); }
  };
  const restore = async () => {
    if (saving) return;
    setSaving('restore'); setError('');
    try { await api.restoreCover(book.id); done(`已恢复《${book.title}》原来的封面`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '恢复封面失败'); setSaving(''); }
  };
  const coverUrl = (entry: SourceEntry) => fromSource
    ? `/api/v1/books/${encodeURIComponent(book.id)}/cover-candidate?entryRef=${encodeURIComponent(entry.ref)}&coverRef=${encodeURIComponent(entry.coverRef ?? '')}`
    : `/api/v1/sources/${encodeURIComponent(sourceId)}/cover?entryRef=${encodeURIComponent(entry.ref)}&coverRef=${encodeURIComponent(entry.coverRef ?? '')}`;
  const status = sources === null ? '正在读取书源…'
    : !fromSource && !sources.length ? '还没有可以搜索封面的书源。请先在“书源”里添加并启用一个书源库。'
      : searching ? `正在书源中查找《${book.title}》的封面${progress ? ` · ${progress.completed} / ${progress.total}` : ''}`
        : entries.length ? `找到 ${entries.length} 个封面，点选一个使用` : '没有找到这本书的封面';
  return <Sheet title="更换封面" subtitle={book.title} busy={!!saving} onClose={onClose}>
    <div className="cover-picker">
      {!fromSource && (sources?.length ?? 0) > 1 && <label className="cover-picker-source">搜索封面的书源
        <Select aria-label="搜索封面的书源" value={sourceId} disabled={!!saving} onChange={(event) => setSourceId(event.currentTarget.value)}>{sources!.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</Select>
      </label>}
      <p className="cover-picker-status" role="status">{status}</p>
      {error && <p className="notice error">{error}</p>}
      <div className="cover-picker-grid">{entries.map((entry) => <button type="button" key={entry.ref} className="cover-picker-item" disabled={!!saving}
        aria-label={`使用${entry.sourceName ?? '此书源'}的封面`} onClick={() => void choose(entry)}>
        <LazyCover url={coverUrl(entry)} title={entry.title} />
        <small>{saving === entry.ref ? '正在保存…' : entry.sourceName ?? '书源'}</small>
      </button>)}</div>
      {!fromSource && book.manualFields?.includes('cover') && <button type="button" className="button cover-picker-restore" disabled={!!saving} onClick={() => void restore()}>{saving === 'restore' ? '正在恢复…' : '恢复文件自带的封面'}</button>}
    </div>
  </Sheet>;
}
