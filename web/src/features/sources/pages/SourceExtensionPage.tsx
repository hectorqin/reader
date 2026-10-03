import { Alert, Button, Card, Checkbox, Group, Loader, NumberInput, PasswordInput, Select, Stack, Tabs, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ExtensionContent, ExtensionField, ExtensionForm } from '../../../api/sources.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';

function Field({ field, value, onChange, disabled }: { field: ExtensionField; value: unknown; onChange: (value: unknown) => void; disabled?: boolean }) {
  if (field.type === 'boolean') return <Checkbox label={field.label} checked={value === true} disabled={disabled} onChange={event => onChange(event.currentTarget.checked)} />;
  const required = field.required ? { required: true } : {};
  const placeholder = field.placeholder ? { placeholder: field.placeholder } : {};
  if (field.type === 'select') return <Select label={field.label} {...required} value={String(value ?? '')} data={field.options?.map(option => ({ value: option.value, label: option.label })) ?? []} {...(disabled ? { disabled: true } : {})} onChange={next => onChange(next ?? '')} />;
  if (field.type === 'textarea') return <Textarea label={field.label} {...required} value={String(value ?? '')} {...(disabled ? { disabled: true } : {})} onChange={event => onChange(event.currentTarget.value)} />;
  if (field.type === 'number') return <NumberInput label={field.label} {...required} {...(field.min !== undefined ? { min: field.min } : {})} {...(field.max !== undefined ? { max: field.max } : {})} value={typeof value === 'number' ? value : ''} {...(disabled ? { disabled: true } : {})} onChange={next => onChange(typeof next === 'number' ? next : Number(next))} />;
  if (field.type === 'password') return <PasswordInput label={field.label} {...required} {...placeholder} value={String(value ?? '')} {...(disabled ? { disabled: true } : {})} onChange={event => onChange(event.currentTarget.value)} />;
  return <TextInput label={field.label} {...required} {...placeholder} value={String(value ?? '')} {...(disabled ? { disabled: true } : {})} onChange={event => onChange(event.currentTarget.value)} />;
}

function FormBlock({ form, submit }: { form: ExtensionForm; submit: (id: string, values: Record<string, unknown>) => void }) {
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...(form.values ?? {}), ...Object.fromEntries(form.fields.map(field => [field.key, field.value ?? (field.type === 'boolean' ? false : '')])) }));
  return <form onSubmit={event => { event.preventDefault(); submit(form.id, values); }}><Stack>{form.title && <Text fw={600}>{form.title}</Text>}{form.fields.map(field => <Field key={field.key} field={field} value={values[field.key]} onChange={value => setValues(previous => ({ ...previous, [field.key]: value }))} />)}<Button type="submit">{form.submit}</Button></Stack></form>;
}

function Content({ content, submit }: { content: ExtensionContent; submit: (id: string, values: Record<string, unknown>) => void }) {
  return <Stack>{content.links?.map(link => <Button key={link.url} component="a" href={link.url} target="_blank" rel="noopener noreferrer" variant="light">{link.title}</Button>)}{content.forms.map(form => <Card key={form.id} withBorder><FormBlock form={form} submit={submit} /></Card>)}{content.sections?.map(section => <Card key={section.title} withBorder><Title order={3}>{section.title}</Title>{section.items.length === 0 && <Text c="dimmed">{section.emptyText ?? '暂无内容'}</Text>}{section.items.map(item => <Card key={item.key ?? item.title} withBorder mt="sm"><Text fw={600}>{item.title}</Text>{item.description && <Text size="sm" c="dimmed">{item.description}</Text>}{item.forms?.map(form => <FormBlock key={form.id} form={form} submit={submit} />)}</Card>)}</Card>)}{content.outputs?.map(output => <Card key={output.title} withBorder><Text fw={600}>{output.title}</Text><pre style={{ whiteSpace: 'pre-wrap' }}>{output.text}</pre></Card>)}</Stack>;
}

export function SourceExtensionPage() {
  const { api } = useRuntime(); const navigate = useNavigate(); const { sourceId, pluginId, pageId = '' } = useParams(); const admin = useAuthStore(state => state.verifiedUser?.role === 'admin');
  const queryClient = useQueryClient();
  const owner = sourceId ? `source:${sourceId}` : `plugin:${pluginId}`;
  const pageQuery = useQuery({ queryKey: ['source-extension', api.baseUrl, owner, pageId], queryFn: () => sourceId ? api.sourcePage(sourceId, pageId) : api.pluginPage(pluginId!, pageId), enabled: !!pageId && (!!sourceId || admin) });
  const action = useMutation({ mutationFn: ({ id, values }: { id: string; values: Record<string, unknown> }) => sourceId ? api.sourcePage(sourceId, pageId, id, values) : api.pluginPage(pluginId!, pageId, id, values), onSuccess: data => { queryClient.setQueryData(['source-extension', api.baseUrl, owner, pageId], data); } });
  const page = pageQuery.data;
  if (!sourceId && !admin) return <Alert color="red">只有管理员可以访问插件配置。</Alert>;
  if (pageQuery.isPending) return <Loader />; if (pageQuery.error) return <Alert color="red">{pageQuery.error.message}</Alert>; if (!page) return null;
  const tabs = page.tabs ?? []; const selected = page.activeTab ?? tabs[0]?.id;
  return <Stack p="md" maw={1100} mx="auto"><Group justify="space-between"><Title order={1}>{page.title}</Title><Button variant="subtle" onClick={() => navigate('/sources')}>返回</Button></Group>{page.description && <Text c="dimmed">{page.description}</Text>}<Tabs defaultValue={selected}><Tabs.List>{tabs.map(tab => <Tabs.Tab key={tab.id} value={tab.id}>{tab.title}</Tabs.Tab>)}</Tabs.List><Tabs.Panel value={selected ?? ''} pt="md"><Content content={page} submit={(id, values) => action.mutate({ id, values })} /></Tabs.Panel>{tabs.map(tab => <Tabs.Panel key={tab.id} value={tab.id} pt="md"><Content content={tab} submit={(id, values) => action.mutate({ id, values })} /></Tabs.Panel>)}</Tabs>{action.error && <Alert color="red">{action.error instanceof Error ? action.error.message : '操作失败'}</Alert>}</Stack>;
}
