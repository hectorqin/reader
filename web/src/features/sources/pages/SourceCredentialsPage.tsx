import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useSources, useSourceMutations } from '../hooks/sourceQueries.ts';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';
import { Button, Callout } from '../../../ui/toolkit.tsx';
import { SourcesHeader } from '../components/SourcesHeader.tsx';
import { ConfirmSheet } from '../../../ui/sheet.tsx';
import { notify } from '../../../ui/notifications.ts';

const STATES = {
  unknown: '尚未验证访问',
  reachable: '最近访问成功',
  'auth-required': '需要登录或凭据已过期',
  'verification-required': '需要人工验证',
} as const;

export function SourceCredentialsPage() {
  const { api } = useRuntime();
  const navigate = useNavigate();
  const { sourceId = '' } = useParams();
  const sources = useSources();
  const source = sources.data?.find(item => item.id === sourceId);
  const mutations = useSourceMutations();
  const status = useQuery({ queryKey: ['source-credentials', api.baseUrl, sourceId], queryFn: () => api.credentialStatus(sourceId), enabled: !!source });
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState<{ key: string; label: string } | null>(null);
  if (sources.isPending) return <FloatingNotice message="正在加载书源…" busy />;
  // An empty field leaves the stored credential alone; deleting one is its own confirmed action.
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!source) return;
    setBusy(true); setError('');
    try {
      for (const field of source.descriptor?.credentialKeys ?? []) {
        const value = values[field.key] ?? '';
        if (value) await mutations.credential.mutateAsync({ id: source.id, key: field.key, value });
      }
      notify('凭据已保存', { kind: 'success' });
      navigate('/sources');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存凭据失败，请重试'); }
    finally { setBusy(false); }
  };
  const clear = async (key: string, label: string) => {
    if (!source) return;
    setBusy(true); setError('');
    try {
      await api.deleteCredential(source.id, key);
      setValues(previous => ({ ...previous, [key]: '' }));
      await status.refetch();
      notify(`已清除${label}`, { kind: 'success' });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '清除凭据失败，请重试'); }
    finally { setBusy(false); setClearing(null); }
  };
  return <div className="sources-screen">
    <SourcesHeader title={source ? `${source.name} · 凭据` : '书源凭据'} />
    <main className="sources-body">
      {!source ? <Callout tone="error">来源不存在</Callout> : <form className="sources-card" onSubmit={save}>
        <FloatingNotice message={status.isPending ? '正在读取凭据状态…' : ''} busy />
        {status.data && <p>状态：{STATES[status.data.state]}</p>}
        {status.data && !status.data.available && <Callout tone="warning">来源当前不可用，请联系管理员检查插件</Callout>}
        {source.descriptor?.credentialKeys?.map(field => { const configured = !!status.data?.fields.find(item => item.key === field.key)?.configured; return <label key={field.key}>
          {field.label} · {configured ? '已配置' : '未配置'}
          <input type="password" autoComplete="off" disabled={busy} value={values[field.key] ?? ''} onChange={event => { const value = event.currentTarget.value; setValues(previous => ({ ...previous, [field.key]: value })); }} />
          <small className="muted">{configured ? '留空则保留现有凭据' : '填写后保存'}</small>
          {configured && <Button className="danger" disabled={busy} onClick={() => setClearing({ key: field.key, label: field.label })}>清除{field.label}</Button>}
        </label>; })}
        {error && <Callout tone="error">{error}</Callout>}
        <div className="sources-actions">
          <Button type="submit" className="primary" disabled={busy || !Object.values(values).some(Boolean)}>{busy ? '正在保存…' : '保存凭据'}</Button>
          <Button disabled={busy} onClick={() => navigate('/sources')}>取消</Button>
        </div>
      </form>}
    </main>
    {clearing && <ConfirmSheet danger title={`清除${clearing.label}`} busy={busy} confirmText="清除"
      text={`服务器上保存的${clearing.label}将被删除，这个书源可能需要重新登录才能使用。`}
      onCancel={() => setClearing(null)} onConfirm={() => void clear(clearing.key, clearing.label)} />}
  </div>;
}
