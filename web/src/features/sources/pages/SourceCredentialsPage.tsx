import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useSources, useSourceMutations } from '../hooks/sourceQueries.ts';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';
import { Button, Callout } from '../../../ui/toolkit.tsx';
import { SourcesHeader } from '../components/SourcesHeader.tsx';

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
  if (sources.isPending) return <FloatingNotice message="正在加载书源…" busy />;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!source) return;
    for (const field of source.descriptor?.credentialKeys ?? []) {
      if (!(field.key in values)) continue;
      const value = values[field.key] ?? '';
      if (value) await mutations.credential.mutateAsync({ id: source.id, key: field.key, value });
      else await api.deleteCredential(source.id, field.key);
    }
    navigate('/sources');
  };
  return <div className="sources-screen">
    <SourcesHeader title={source ? `${source.name} · 凭据` : '书源凭据'} />
    <main className="sources-body">
      {!source ? <Callout tone="error">来源不存在</Callout> : <form className="sources-card" onSubmit={save}>
        <FloatingNotice message={status.isPending ? '正在读取凭据状态…' : ''} busy />
        {status.data && <p>状态：{STATES[status.data.state]}</p>}
        {status.data && !status.data.available && <Callout tone="warning">来源当前不可用，请联系管理员检查插件</Callout>}
        {source.descriptor?.credentialKeys?.map(field => <label key={field.key}>
          {field.label} · {status.data?.fields.find(item => item.key === field.key)?.configured ? '已配置' : '未配置'}
          <input type="password" autoComplete="off" value={values[field.key] ?? ''} onChange={event => { const value = event.currentTarget.value; setValues(previous => ({ ...previous, [field.key]: value })); }} />
          <small className="muted">留空并保存可删除此凭据</small>
        </label>)}
        <div className="sources-actions">
          <Button type="submit" className="primary" disabled={mutations.credential.isPending}>保存凭据</Button>
          <Button onClick={() => navigate('/sources')}>取消</Button>
        </div>
      </form>}
    </main>
  </div>;
}
