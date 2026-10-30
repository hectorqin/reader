import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { SourceType } from '../../../api/sources.ts';
import { useSources, useSourceMutations, useSourceTypes } from '../hooks/sourceQueries.ts';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';
import { ConfirmSheet } from '../../../ui/sheet.tsx';
import { Button, Callout } from '../../../ui/toolkit.tsx';
import { SourcesHeader } from '../components/SourcesHeader.tsx';
import { notify } from '../../../ui/notifications.ts';

export function SourceEditorPage() {
  const navigate = useNavigate();
  const { sourceId } = useParams();
  const sources = useSources();
  const types = useSourceTypes();
  const mutations = useSourceMutations();
  const source = sources.data?.find(item => item.id === sourceId);
  const [typeKey, setTypeKey] = useState(source ? `${source.pluginId}/${source.sourceType}` : '');
  const [name, setName] = useState(source?.name ?? '');
  const [config, setConfig] = useState<Record<string, unknown>>(source?.config ?? {});
  const [raw, setRaw] = useState(JSON.stringify(source?.config ?? {}, null, 2));
  const [jsonError, setJsonError] = useState('');
  const [removing, setRemoving] = useState(false);
  useEffect(() => {
    if (!source) return;
    setTypeKey(`${source.pluginId}/${source.sourceType}`);
    setName(source.name);
    setConfig(source.config ?? {});
    setRaw(JSON.stringify(source.config ?? {}, null, 2));
  }, [source]);
  const type: SourceType | undefined = types.data?.find(item => `${item.pluginId}/${item.id}` === typeKey)
    ?? (source ? types.data?.find(item => item.pluginId === source.pluginId && item.id === source.sourceType) : undefined);
  if (sources.isPending || types.isPending) return <FloatingNotice message="正在加载书源配置…" busy />;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    let value = config;
    if (!type?.configSchema?.properties) {
      try { value = JSON.parse(raw) as Record<string, unknown>; setJsonError(''); }
      catch { setJsonError('配置 JSON 格式不正确'); return; }
    }
    try {
      await mutations.save.mutateAsync({ id: sourceId ?? null, input: { name: name.trim(), config: value, ...(sourceId ? {} : { pluginId: type?.pluginId, sourceType: type?.id }) } });
      notify(sourceId ? '书源已保存' : '书源已添加', { kind: 'success' });
      navigate('/sources');
    } catch (reason) { setJsonError(reason instanceof Error ? reason.message : '保存书源失败，请重试'); }
  };
  const setField = (key: string, value: unknown) => setConfig(previous => ({ ...previous, [key]: value }));
  return <div className="sources-screen">
    <SourcesHeader title={sourceId ? '编辑书源' : '添加书源'} />
    <main className="sources-body">
      {sourceId && !source ? <Callout tone="error">来源不存在</Callout> : <form className="sources-card" onSubmit={save}>
        <label>来源类型
          <select required disabled={!!sourceId} value={typeKey} onChange={event => { setTypeKey(event.currentTarget.value); setConfig({}); setRaw('{}'); }}>
            <option value="" disabled>选择来源类型</option>
            {types.data?.map(item => <option key={`${item.pluginId}/${item.id}`} value={`${item.pluginId}/${item.id}`}>{item.label} ({item.pluginId})</option>)}
          </select>
        </label>
        <label>名称<input required value={name} onChange={event => setName(event.currentTarget.value)} /></label>
        {type?.configSchema?.properties
          ? Object.entries(type.configSchema.properties).map(([key, field]) => field.type === 'boolean'
            ? <label key={key} className="sources-consent"><input type="checkbox" checked={config[key] === true} onChange={event => setField(key, event.currentTarget.checked)} />{field.title ?? key}</label>
            : field.enum
              ? <label key={key}>{field.title ?? key}<select value={String(config[key] ?? field.default ?? '')} onChange={event => setField(key, event.currentTarget.value)}>{field.enum.map((value, index) => <option key={value} value={value}>{field.enumNames?.[index] ?? value}</option>)}</select></label>
              : <label key={key}>{field.title ?? key}<input type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'} value={String(config[key] ?? field.default ?? '')} onChange={event => setField(key, field.type === 'number' || field.type === 'integer' ? Number(event.currentTarget.value) : event.currentTarget.value)} /></label>)
          : <label>配置 JSON<textarea rows={8} value={raw} onChange={event => setRaw(event.currentTarget.value)} /></label>}
        {jsonError && <Callout tone="error">{jsonError}</Callout>}
        {source?.descriptor?.credentialKeys?.length ? <p className="muted">凭据不会保存到配置中，请保存后单独设置</p> : null}
        <div className="sources-actions">
          <Button type="submit" className="primary" disabled={mutations.save.isPending}>{mutations.save.isPending ? '正在保存…' : '保存'}</Button>
          <Button onClick={() => navigate('/sources')}>取消</Button>
          {sourceId && <Button className="danger" disabled={mutations.remove.isPending} onClick={() => setRemoving(true)}>删除来源</Button>}
        </div>
      </form>}
    </main>
    {removing && sourceId && <ConfirmSheet danger title="删除来源" text={`确定删除书源「${source?.name ?? sourceId}」？`} confirmText="删除"
      onCancel={() => setRemoving(false)}
      onConfirm={() => { setRemoving(false); void mutations.remove.mutateAsync(sourceId).then(() => { notify('书源已删除', { kind: 'success' }); navigate('/sources'); }, reason => notify(reason instanceof Error ? reason.message : '删除书源失败，请重试', { kind: 'error' })); }} />}
  </div>;
}
