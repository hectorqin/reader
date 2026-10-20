import { useEffect, useState } from 'react';
import type { MediaApi } from '../api/media-api.ts';

interface SettingsView {
  group: string; revision: number; values: Record<string, string | number | boolean>;
  fields: Array<{ key: string; label: string; type: string; help?: string }>;
}
/** The 扫描设置 business-settings fields this card owns, in the prototype's order. */
export const scanSettingKeys = ['mediaAutoScan', 'mediaScrape', 'mediaEmbedded', 'mediaHidden'] as const;

/**
 * 扫描与元数据 (prototype 20): four switches for every media library. They are the
 * server's 扫描设置 business settings, so the same values appear in 系统设置 too;
 * a switch saves on its own, with the settings revision guarding concurrent edits.
 */
export function MediaScanSettings({ api }: { api: Pick<MediaApi, 'businessSettingsRequest'> }) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setStatus('loading');
    void api.businessSettingsRequest<{ groups: SettingsView[] }>('', 'GET', undefined, abort.signal).then(result => {
      if (abort.signal.aborted) return;
      setView(result.groups.find(group => group.group === 'scanning') ?? null); setStatus('ready');
    }).catch(() => { if (!abort.signal.aborted) setStatus('error'); });
    return () => abort.abort();
  }, [api, retry]);
  const fields = scanSettingKeys.map(key => view?.fields.find(field => field.key === key)).filter(field => field !== undefined);
  // An older server without these settings: nothing to show.
  if (status === 'ready' && !fields.length) return null;
  async function toggle(key: string) {
    if (!view || busy) return;
    setBusy(true); setError('');
    try {
      setView(await api.businessSettingsRequest<SettingsView>('scanning', 'PATCH', { values: { [key]: !view.values[key] }, revision: view.revision }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '设置保存失败');
    } finally { setBusy(false); }
  }
  return <aside className="media-scan-settings" aria-label="扫描与元数据">
    <h2>扫描与元数据</h2>
    {status === 'loading' && <p className="media-scan-settings-note" role="status">正在读取设置…</p>}
    {status === 'error' && <div className="media-error" role="alert"><p>扫描设置读取失败。</p><button onClick={() => setRetry(value => value + 1)}>重试</button></div>}
    {view && <div className="media-scan-settings-list">{fields.map(field => {
      const on = view.values[field.key] === true;
      return <button type="button" role="switch" key={field.key} aria-checked={on} disabled={busy} onClick={() => void toggle(field.key)}>
        <span><strong>{field.label}</strong>{field.help && <small>{field.help}</small>}</span>
        <i className="media-scan-switch" aria-hidden="true" />
      </button>;
    })}</div>}
    {error && <p className="media-error" role="alert">{error}</p>}
    <p className="media-scan-settings-note">元数据优先使用本地 NFO 与内嵌标签，缺失时再联网刮削。</p>
  </aside>;
}
