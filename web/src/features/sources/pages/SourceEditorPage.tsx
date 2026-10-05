import { Alert, Button, Card, Group, Select, Stack, Switch, Text, TextInput, Textarea, Title } from '@mantine/core';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { SourceType } from '../../../api/sources.ts';
import { useSources, useSourceMutations, useSourceTypes } from '../hooks/sourceQueries.ts';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';

export function SourceEditorPage() {
  const navigate = useNavigate();
  const { sourceId } = useParams();
  const sources = useSources(); const types = useSourceTypes(); const mutations = useSourceMutations();
  const source = sources.data?.find(item => item.id === sourceId);
  const [typeKey, setTypeKey] = useState(source ? `${source.pluginId}/${source.sourceType}` : '');
  const [name, setName] = useState(source?.name ?? '');
  const [config, setConfig] = useState<Record<string, unknown>>(source?.config ?? {});
  const [raw, setRaw] = useState(JSON.stringify(source?.config ?? {}, null, 2));
  useEffect(() => { if (!source) return; setTypeKey(`${source.pluginId}/${source.sourceType}`); setName(source.name); setConfig(source.config ?? {}); setRaw(JSON.stringify(source.config ?? {}, null, 2)); }, [source]);
  const type: SourceType | undefined = types.data?.find(item => `${item.pluginId}/${item.id}` === typeKey) ?? (source ? types.data?.find(item => item.pluginId === source.pluginId && item.id === source.sourceType) : undefined);
  if (sources.isPending || types.isPending) return <FloatingNotice message="正在加载书源配置…" busy />;
  if (sourceId && !source) return <Alert color="red">来源不存在。</Alert>;
  const save = async (event: React.FormEvent) => { event.preventDefault(); let value = config; try { if (!type?.configSchema?.properties) value = JSON.parse(raw) as Record<string, unknown>; } catch { return; } await mutations.save.mutateAsync({ id: sourceId ?? null, input: { name: name.trim(), config: value, ...(sourceId ? {} : { pluginId: type?.pluginId, sourceType: type?.id }) } }); navigate('/sources'); };
  return <Stack p="md" maw={800} mx="auto"><Group justify="space-between"><Title order={1}>{sourceId ? '编辑书源' : '添加书源'}</Title><Button variant="subtle" onClick={() => navigate('/sources')}>返回</Button></Group><Card withBorder><form onSubmit={save}><Stack><Select label="来源类型" required disabled={!!sourceId} value={typeKey} data={types.data?.map(item => ({ value: `${item.pluginId}/${item.id}`, label: `${item.label} (${item.pluginId})` })) ?? []} onChange={value => { setTypeKey(value ?? ''); setConfig({}); setRaw('{}'); }} /><TextInput label="名称" required value={name} onChange={event => setName(event.currentTarget.value)} />{type?.configSchema?.properties ? Object.entries(type.configSchema.properties).map(([key, field]) => field.type === 'boolean' ? <Switch key={key} label={field.title ?? key} checked={config[key] === true} onChange={event => setConfig(previous => ({ ...previous, [key]: event.currentTarget.checked }))} /> : field.enum ? <Select key={key} label={field.title ?? key} value={String(config[key] ?? field.default ?? '')} data={field.enum.map((value, index) => ({ value, label: field.enumNames?.[index] ?? value }))} onChange={value => setConfig(previous => ({ ...previous, [key]: value ?? '' }))} /> : <TextInput key={key} label={field.title ?? key} type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'} value={String(config[key] ?? field.default ?? '')} onChange={event => setConfig(previous => ({ ...previous, [key]: field.type === 'number' || field.type === 'integer' ? Number(event.currentTarget.value) : event.currentTarget.value }))} />) : <Textarea label="配置 JSON" value={raw} onChange={event => setRaw(event.currentTarget.value)} minRows={8} />}{source?.descriptor?.credentialKeys?.length ? <Text size="sm" c="dimmed">凭据不会保存到配置中，请保存后单独设置。</Text> : null}<Group><Button type="submit" loading={mutations.save.isPending}>保存</Button><Button type="button" variant="light" onClick={() => navigate('/sources')}>取消</Button>{sourceId && <Button type="button" color="red" variant="subtle" loading={mutations.remove.isPending} onClick={async () => { await mutations.remove.mutateAsync(sourceId); navigate('/sources'); }}>删除来源</Button>}</Group></Stack></form></Card></Stack>;
}
