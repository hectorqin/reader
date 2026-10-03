import { Alert, Button, Card, Group, Loader, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useSources, useSourceMutations } from '../hooks/sourceQueries.ts';

export function SourceCredentialsPage() {
  const { api } = useRuntime(); const navigate = useNavigate(); const { sourceId = '' } = useParams();
  const sources = useSources(); const source = sources.data?.find(item => item.id === sourceId); const mutations = useSourceMutations();
  const status = useQuery({ queryKey: ['source-credentials', api.baseUrl, sourceId], queryFn: () => api.credentialStatus(sourceId), enabled: !!source });
  const [values, setValues] = useState<Record<string, string>>({});
  if (sources.isPending) return <Loader />; if (!source) return <Alert color="red">来源不存在。</Alert>;
  const save = async (event: React.FormEvent) => { event.preventDefault(); for (const field of source.descriptor?.credentialKeys ?? []) if (field.key in values) { const value = values[field.key] ?? ''; if (value) await mutations.credential.mutateAsync({ id: source.id, key: field.key, value }); else await api.deleteCredential(source.id, field.key); } navigate('/sources'); };
  return <Stack p="md" maw={700} mx="auto"><Group justify="space-between"><Title order={1}>{source.name} · 凭据</Title><Button variant="subtle" onClick={() => navigate('/sources')}>返回</Button></Group><Card withBorder><form onSubmit={save}><Stack>{status.isPending && <Loader />}{status.data && <><Text>状态：{{ unknown: '尚未验证访问', reachable: '最近访问成功', 'auth-required': '需要登录或凭据已过期', 'verification-required': '需要人工验证' }[status.data.state]}</Text>{!status.data.available && <Alert color="yellow">来源当前不可用，请联系管理员检查插件。</Alert>}</>}{source.descriptor?.credentialKeys?.map(field => <PasswordInput key={field.key} label={`${field.label} · ${status.data?.fields.find(item => item.key === field.key)?.configured ? '已配置' : '未配置'}`} value={values[field.key] ?? ''} onChange={event => setValues(previous => ({ ...previous, [field.key]: event.currentTarget.value }))} description="留空并保存可删除此凭据" autoComplete="off" />)}<Button type="submit" loading={mutations.credential.isPending}>保存凭据</Button></Stack></form></Card></Stack>;
}
