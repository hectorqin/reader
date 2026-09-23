import { useEffect, useRef, useState } from './vendor/preact.ts';
import { ApiError, type ReaderApi } from '../api/client.ts';
import type { OpdsCredential } from '../api/sources.ts';
import { Modal } from './modal.tsx';
import { Button } from './toolkit.tsx';

export function OpdsAccess({ api, onClose, onSignedOut }: { api: ReaderApi; onClose(): void; onSignedOut(): void }) {
  const [items, setItems] = useState<OpdsCredential[]>([]), [name, setName] = useState('');
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const active = useRef(true), running = useRef(false);
  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (reason) {
      if (active.current) {
        if (reason instanceof ApiError && reason.isAuthFailure) onSignedOut();
        else setError(reason instanceof Error ? reason.message : '操作失败');
      }
    } finally { running.current = false; if (active.current) setBusy(false); }
  };
  const reload = async () => {
    const value = await api.opdsCredentials();
    if (!active.current) return;
    setItems(value.credentials); setUrl(new URL(value.catalogUrl, api.baseUrl || location.href).href);
  };
  useEffect(() => { void run(reload); return () => { active.current = false; }; }, []);
  return <Modal title="连接外部阅读器" busy={busy} onClose={onClose}>
    <div className="sources-card source-modal-form"><div className="source-modal-content">
      {busy && <p role="status">正在处理…</p>}
      <p>通过 OPDS 1.2 只读目录访问当前账号书架中的文件书籍。章节书和目录漫画暂不发布。</p>
      <label>目录地址<input readOnly value={url} /></label>
      <p>在外部阅读器中填入目录地址和专用账号/密码。请使用 HTTPS；凭据有效期一年，可随时撤销。</p>
      {error && <p role="alert">{error}</p>}
      {created && <div role="status"><p>密码仅展示这一次，请先保存。关闭后无法重新查看。</p>
        <label>OPDS 用户名<input readOnly value={created.username} /></label>
        <label>OPDS 密码<input readOnly value={created.password} autoComplete="off" /></label>
      </div>}
      <form onSubmit={event => { event.preventDefault(); void run(async () => {
        const result = await api.createOpdsCredential(name);
        if (!active.current) return;
        setCreated(result); setName(''); await reload();
      }); }}>
        <label>客户端名称<input required maxLength={80} value={name} disabled={busy} onInput={event => setName(event.currentTarget.value)} placeholder="例如：平板阅读器" /></label>
        <Button type="submit" disabled={busy || !name.trim()}>创建 OPDS 凭据</Button>
      </form>
      {items.map(item => <article className="sources-row" key={item.id}><div><strong>{item.name}</strong><small>到期：{new Date(item.expiresAt).toLocaleDateString()}</small></div>
        <Button disabled={busy} onClick={() => void run(async () => { await api.revokeOpdsCredential(item.id); if (!active.current) return; if (created?.username === item.id) setCreated(null); await reload(); })}>撤销 {item.name}</Button></article>)}
    </div></div>
  </Modal>;
}
