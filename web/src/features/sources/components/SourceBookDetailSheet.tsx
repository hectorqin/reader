import type { SourceEntry } from '../../../api/sources.ts';
import { Sheet } from '../../../ui/sheet.tsx';
import { Button } from '../../../ui/toolkit.tsx';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';

/**
 * A source result's detail, shared by the source hub and a single source's catalog:
 * they show the same entry and offer the same 加入书架 choices.
 */
export function SourceBookDetailSheet({ detail, pending, error, acquiring, onAcquire, onClose }: {
  detail: SourceEntry;
  pending: boolean;
  error: Error | null;
  acquiring: boolean;
  onAcquire(entry: SourceEntry, option?: string): void;
  onClose(): void;
}) {
  const options = detail.options ?? [];
  return <Sheet title={detail.title || '书籍详情'} onClose={onClose}
    footer={options.length
      ? options.map(option => <Button key={option.id} className="primary" disabled={option.available === false || acquiring} onClick={() => onAcquire(detail, option.id)}>{option.label}</Button>)
      : <Button className="primary" disabled={acquiring} onClick={() => onAcquire(detail)}>加入书架</Button>}>
    <FloatingNotice message={pending ? '正在读取书籍详情…' : ''} busy />
    <div className="book-detail">
      <p className="book-detail-author">{detail.authors?.join('、') || '作者未知'}</p>
      {error && <p className="notice error" role="alert">{error.message}</p>}
      <p className="book-detail-description">{detail.description || '暂无简介'}</p>
    </div>
  </Sheet>;
}
