/**
 * 换封面: the covers other book sources have for the same book.
 *
 * It runs the same search as 换源 (same title and author, through the book's own
 * source library) and lists only the editions that have a cover. Picking one stores
 * it on the server as this book's cover; the book and its source stay as they are.
 */
import { type JSX, useEffect, useState } from 'react';
import type { SourceEntry } from '../api/sources.ts';
import { useRuntime } from '../app/providers/runtime-context.tsx';
import { LazyCover } from './lazy-cover.tsx';
import { notify } from './notifications.ts';
import { Sheet } from './sheet.tsx';

const candidateUrl = (bookId: string, entry: SourceEntry) =>
  `/api/v1/books/${encodeURIComponent(bookId)}/cover-candidate?entryRef=${encodeURIComponent(entry.ref)}&coverRef=${encodeURIComponent(entry.coverRef ?? '')}`;

export function ChangeCoverSheet({ bookId, title, onClose, onChanged }: { bookId: string; title: string; onClose(): void; onChanged(): void }): JSX.Element {
  const { api } = useRuntime();
  const [entries, setEntries] = useState<SourceEntry[]>([]);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [searching, setSearching] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  useEffect(() => {
    const run = new AbortController();
    const sessionId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    void (async () => {
      try {
        const found = new Map<string, SourceEntry>();
        for await (const page of api.alternatives(bookId, { sessionId }, { signal: run.signal })) {
          if (run.signal.aborted) return;
          for (const entry of page.items) if (entry.coverRef) found.set(entry.ref, entry);
          setEntries([...found.values()]); if (page.batch) setProgress(page.batch);
        }
      } catch (reason) {
        if (!run.signal.aborted) setError(reason instanceof Error ? reason.message : '搜索封面失败');
      } finally { if (!run.signal.aborted) setSearching(false); }
    })();
    return () => run.abort();
  }, [api, bookId]);
  const choose = async (entry: SourceEntry) => {
    if (saving || !entry.coverRef) return;
    setSaving(entry.ref); setError('');
    try {
      await api.changeCover(bookId, entry.ref, entry.coverRef);
      notify(`已更换《${title}》的封面`, { kind: 'success' });
      onChanged(); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '更换封面失败'); setSaving(''); }
  };
  return <Sheet title="更换封面" subtitle={title} busy={!!saving} onClose={onClose}>
    <div className="cover-picker">
      <p className="cover-picker-status" role="status">
        {searching ? `正在其它书源中查找封面${progress ? ` · ${progress.completed} / ${progress.total}` : ''}` : entries.length ? `找到 ${entries.length} 个封面，点选一个使用` : '其它书源没有提供这本书的封面'}
      </p>
      {error && <p className="notice error">{error}</p>}
      <div className="cover-picker-grid">{entries.map((entry) => <button type="button" key={entry.ref} className="cover-picker-item" disabled={!!saving}
        aria-label={`使用${entry.sourceName ?? '此书源'}的封面`} onClick={() => void choose(entry)}>
        <LazyCover url={candidateUrl(bookId, entry)} title={entry.title} />
        <small>{saving === entry.ref ? '正在保存…' : entry.sourceName ?? '书源'}</small>
      </button>)}</div>
    </div>
  </Sheet>;
}
