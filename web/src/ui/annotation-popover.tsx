import { useEffect, useRef, useState } from './vendor/preact.ts';
import type { Note } from '../api/types.ts';
import type { TextAnchor } from './text-anchor.ts';
import { Modal } from './modal.tsx';

export interface AnnotationTarget { anchor: TextAnchor; rect: DOMRect; note?: Note }
export function AnnotationPopover({ target, save, remove, close }: {
  target: AnnotationTarget;
  save(type: 'highlight' | 'note' | 'bookmark', comment: string, color: string): Promise<void>;
  remove(): Promise<void>; close(): void;
}) {
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [comment, setComment] = useState(target.note?.comment ?? ''), [color, setColor] = useState(target.note?.color || '#ffd54f');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const panel = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  const viewport = window.visualViewport;
  const width = Math.min(328, (viewport?.width ?? innerWidth) - 24);
  const left = Math.max(12, Math.min((viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth) - width - 12, target.rect.left));
  const top = Math.max((viewport?.offsetTop ?? 0) + 12, Math.min(target.rect.bottom + 10, (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) - 260));
  async function work(action: () => Promise<void>) {
    if (busy) return; setBusy(true); setError('');
    try { await action(); close(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); setBusy(false); }
  }
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!editing && !busy && !panel.current?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); close(); } };
    const moved = (event: Event) => { if (!editing && !busy && !(event.target instanceof Node && panel.current?.contains(event.target))) close(); };
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', key, true);
    window.addEventListener('resize',moved); document.addEventListener('scroll',moved,true);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', key, true); window.removeEventListener('resize',moved); document.removeEventListener('scroll',moved,true); };
  }, [editing, busy]);
  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);
  if (editing) return <Modal title={target.note ? '编辑批注' : '添加批注'} busy={busy} onClose={close}>
    <form className="annotation-editor source-modal-content" onSubmit={event => { event.preventDefault(); void work(() => save(comment.trim() ? 'note' : 'highlight', comment, color)); }}>
      <blockquote>{target.anchor.quote}</blockquote>
      <label>批注<textarea ref={input} aria-label="批注" maxLength={4000} value={comment} onInput={event => setComment(event.currentTarget.value)} placeholder="写下此刻的想法" disabled={busy} /></label>
      <div className="reading-note-colors" role="group" aria-label="高亮颜色">{[['#ffd54f','黄色'],['#80cbc4','绿色'],['#ce93d8','紫色']].map(([value, label]) => <button type="button" aria-label={label} aria-pressed={color === value} style={{'--note-color':value}} disabled={busy} onClick={() => setColor(value)}>{color === value ? '✓' : ''}</button>)}</div>
      {error && <p role="alert">{error}</p>}<div className="reading-tool-actions"><button type="button" className="button" disabled={busy} onClick={close}>取消</button><button className="button primary" disabled={busy}>保存批注</button></div>
    </form>
  </Modal>;
  return <div ref={panel} className="annotation-popover" style={{left,top,width}} role={target.note ? 'dialog' : 'toolbar'} aria-label={target.note ? '批注详情' : '选中文字操作'} onPointerDown={event => event.preventDefault()}>
    {target.note && <><blockquote>{target.anchor.quote}</blockquote><p className="annotation-comment">{target.note.comment || '这段文字已高亮，尚未添加批注。'}</p></>}
    {error && <p role="alert">{error}</p>}
    <div className="annotation-actions">
      {!target.note && <button disabled={busy} onClick={() => void work(async () => { if (!navigator.clipboard) throw new Error('当前环境不支持剪贴板，请使用系统复制'); await navigator.clipboard.writeText(target.anchor.quote); })}>复制</button>}
      {!target.note && <button disabled={busy} onClick={() => void work(() => save('highlight', '', color))}>高亮</button>}
      <button disabled={busy} onClick={() => setEditing(true)}>{target.note ? '编辑批注' : '批注'}</button>
      {!target.note && <button disabled={busy} onClick={() => void work(() => save('bookmark', '', ''))}>书签</button>}
      {target.note && <button disabled={busy} onClick={() => confirmDelete ? void work(remove) : setConfirmDelete(true)}>{confirmDelete ? '确认删除' : '删除'}</button>}
      <button disabled={busy} aria-label="关闭选区工具" onClick={close}>关闭</button>
    </div>
  </div>;
}
