import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ExtensionContent, ExtensionField, ExtensionForm, ExtensionPage } from '../../../api/sources.ts';
import { ApiError } from '../../../api/errors.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { FloatingConfirm } from '../../../ui/floating-confirm.tsx';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';
import { Button, IconButton } from '../../../ui/toolkit.tsx';

type FormValues = Record<string, unknown>;

function initialValues(form: ExtensionForm): FormValues {
  const values: FormValues = { ...(form.values ?? {}) };
  for (const field of form.fields) {
    if (values[field.key] === undefined) values[field.key] = field.value ?? (field.type === 'boolean' ? false : '');
  }
  return values;
}

function safeExternalUrl(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function fileToValue(file: File): Promise<{ name: string; type: string; data: string }> {
  return file.arrayBuffer().then(buffer => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return { name: file.name, type: file.type, data: btoa(binary) };
  });
}

function FieldControl({ field, value, disabled, onChange, onSelectAction }: {
  field: ExtensionField; value: unknown; disabled: boolean; onChange(value: unknown): void;
  onSelectAction?(field: ExtensionField, value: string): void;
}) {
  const common = { 'aria-label': field.label, required: field.required, disabled };
  if (field.type === 'textarea') return <textarea {...common} placeholder={field.placeholder} value={String(value ?? '')} onChange={event => onChange(event.currentTarget.value)} />;
  if (field.type === 'file') return <input {...common} type="file" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void fileToValue(file).then(onChange); }} />;
  if (field.type === 'boolean') return <input {...common} type="checkbox" checked={value === true} onChange={event => onChange(event.currentTarget.checked)} />;
  if (field.type === 'select') return <select {...common} value={String(value ?? '')} onChange={event => { const next = event.currentTarget.value; onChange(next); if (field.changeAction) onSelectAction?.(field, next); }}>
    {field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>;
  return <input {...common} type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'} autoComplete={field.type === 'password' ? 'off' : undefined} placeholder={field.placeholder} min={field.min} max={field.max} value={value === undefined || value === null ? '' : String(value)} onChange={event => {
    const raw = event.currentTarget.value;
    onChange(field.type === 'number' ? (raw === '' ? '' : Number(raw)) : raw);
  }} />;
}

function FormView({ form, formKey, values, busy, selected, onChange, onSubmit, onSelectAction }: {
  form: ExtensionForm; formKey: string; values: FormValues; busy: boolean; selected: Set<string>;
  onChange(key: string, value: unknown): void;
  onSubmit(form: ExtensionForm, values: FormValues, formKey: string): void;
  onSelectAction(field: ExtensionField, value: string, form: ExtensionForm, formKey: string): void;
}) {
  return <form className={form.layout === 'inline' ? 'extension-form-inline' : undefined} onSubmit={event => { event.preventDefault(); onSubmit(form, { ...values, ...(form.id === 'batch' ? { ids: [...selected] } : {}) }, formKey); }}>
    {form.title && <h3>{form.title}</h3>}
    {form.fields.map(field => <label key={field.key} data-field-type={field.type}>
      {field.label}
      <FieldControl field={field} value={values[field.key]} disabled={busy} onChange={value => onChange(field.key, value)} onSelectAction={(changed, value) => onSelectAction(changed, value, form, formKey)} />
    </label>)}
    <Button type="submit" disabled={busy}>{form.submit}</Button>
  </form>;
}

function ContentView({ content, scope, values, busy, selected, expanded, onChange, onSubmit, onSelectAction, onToggle, onToggleSelected }: {
  content: ExtensionContent; scope: string; values: Record<string, FormValues>; busy: boolean; selected: Set<string>; expanded: Set<string>;
  onChange(scope: string, key: string, value: unknown): void;
  onSubmit(form: ExtensionForm, values: FormValues, formKey: string): void;
  onSelectAction(field: ExtensionField, value: string, form: ExtensionForm, formKey: string): void;
  onToggle(key: string): void; onToggleSelected(key: string): void;
}) {
  const editor = <>
    {content.links?.filter(link => safeExternalUrl(link.url)).map(link => <a className="button" key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">{link.title}</a>)}
    {content.forms.map(form => { const key = `${scope}:form:${form.id}`; return <section className="sources-card" key={key}><FormView form={form} formKey={key} values={values[key] ?? initialValues(form)} busy={busy} selected={selected} onChange={(field, value) => onChange(key, field, value)} onSubmit={onSubmit} onSelectAction={onSelectAction} /></section>; })}
  </>;
  const output = <>
    {content.sections?.map((section, sectionIndex) => <section className="extension-section" key={`${scope}:section:${sectionIndex}`}>
      <h2>{section.title}</h2>
      {!section.items.length && section.emptyText && <p className="extension-empty">{section.emptyText}</p>}
      {section.items.map((item, itemIndex) => { const key = `${scope}:item:${sectionIndex}:${itemIndex}`; const open = expanded.has(key); return <article className="sources-card extension-item" key={key}>
        <div className="extension-item-heading"><div>
          {item.selectable && item.key && <input type="checkbox" aria-label={`选择 ${item.title}`} checked={selected.has(item.key)} onChange={() => onToggleSelected(item.key!)} />}
          <h3>{item.title}</h3>{item.description && <p className="source-description">{item.description}</p>}
        </div>{item.collapsible && <button className="button" type="button" aria-expanded={open} aria-controls={`extension-item-${key}`} onClick={() => onToggle(key)}>{open ? '收起' : '管理'}</button>}</div>
        <div id={`extension-item-${key}`} hidden={item.collapsible && !open} className="extension-actions">{item.forms?.map(form => { const formKey = `${key}:form:${form.id}`; return <FormView key={formKey} form={form} formKey={formKey} values={values[formKey] ?? initialValues(form)} busy={busy} selected={selected} onChange={(field, value) => onChange(formKey, field, value)} onSubmit={onSubmit} onSelectAction={onSelectAction} />; })}</div>
      </article>; })}
    </section>)}
    {content.outputs?.map(output => <details className="sources-card extension-output" open key={`${scope}:output:${output.title}`}><summary>{output.title}</summary><pre tabIndex={0} aria-label={output.title} data-format={output.format}>{output.text}</pre></details>)}
  </>;
  return content.layout === 'workbench' ? <div className="extension-workbench"><div className="extension-workbench-editor">{editor}</div><div className="extension-workbench-output">{output}</div></div> : <>{editor}{output}</>;
}

export function SourceExtensionPage() {
  const runtime = useRuntime(); const { api } = runtime; const navigate = useNavigate();
  const { sourceId, pluginId, pageId = '' } = useParams(); const admin = useAuthStore(state => state.verifiedUser?.role === 'admin');
  const queryClient = useQueryClient(); const owner = sourceId ? `source:${sourceId}` : `plugin:${pluginId}`; const queryKey = ['source-extension', api.baseUrl, owner, pageId];
  const pageQuery = useQuery({ queryKey, queryFn: () => sourceId ? api.sourcePage(sourceId, pageId) : api.pluginPage(pluginId!, pageId), enabled: Boolean(pageId && (sourceId || admin)) });
  const action = useMutation({ mutationFn: ({ id, values }: { id?: string; values?: FormValues }) => sourceId ? api.sourcePage(sourceId, pageId, id, values) : api.pluginPage(pluginId!, pageId, id, values) });
  const page = pageQuery.data as ExtensionPage | undefined; const [activeTab, setActiveTab] = useState('');
  const [values, setValues] = useState<Record<string, FormValues>>({}); const [selected, setSelected] = useState<Set<string>>(new Set()); const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState(''); const [noticeTab, setNoticeTab] = useState(''); const [confirmation, setConfirmation] = useState<{ form: ExtensionForm; values: FormValues; key: string } | null>(null); const busy = action.isPending;
  const tabs = page?.tabs ?? []; const selectedTab = useMemo(() => tabs.find(tab => tab.id === activeTab), [tabs, activeTab]);
  useEffect(() => { setActiveTab(''); setValues({}); setSelected(new Set()); setExpanded(new Set()); setError(''); setNoticeTab(''); setConfirmation(null); }, [owner, pageId]);
  useEffect(() => { if (!page) return; setActiveTab(current => page.activeTab && !current ? page.activeTab : (current && tabs.some(tab => tab.id === current) ? current : tabs[0]?.id ?? '')); setNoticeTab(current => current || page.activeTab || tabs[0]?.id || ''); }, [page, tabs]);
  const updateValue = (key: string, field: string, value: unknown) => setValues(previous => {
    const form = findForm(page, key);
    const base = previous[key] ?? (form ? initialValues(form) : {});
    return { ...previous, [key]: { ...base, [field]: value } };
  });
  const toggleExpanded = (key: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const toggleSelected = (key: string) => setSelected(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const execute = async (id?: string, payload?: FormValues, submittedKey?: string, submittedForm?: ExtensionForm) => {
    setError('');
    try {
      const request: { id?: string; values?: FormValues } = {};
      if (id !== undefined) request.id = id;
      if (payload !== undefined) request.values = payload;
      const next = await action.mutateAsync(request);
      queryClient.setQueryData(queryKey, next);
      if (submittedKey) setValues(previous => { const copy = { ...previous }; delete copy[submittedKey]; return copy; });
      setNoticeTab(activeTab);
      setConfirmation(null);
      return true;
    } catch (reason) {
      if (reason instanceof ApiError && reason.isAuthFailure) void api.signOut();
      else setError(reason instanceof Error ? reason.message : '操作失败');
      if (submittedKey) setValues(previous => {
        const current = { ...(previous[submittedKey] ?? {}) };
        const form = submittedForm ?? findForm(page, submittedKey);
        for (const field of form?.fields ?? []) if (field.type === 'password') current[field.key] = '';
        return { ...previous, [submittedKey]: current };
      });
      return false;
    }
  };
  const submit = (form: ExtensionForm, formValues: FormValues, formKey: string) => { if (form.confirm) setConfirmation({ form, values: formValues, key: formKey }); else void execute(form.id, formValues, formKey, form); };
  const selectAction = (field: ExtensionField, value: string, form: ExtensionForm, formKey: string) => { if (!field.changeAction) return; const previous = values[formKey]?.[field.key] ?? initialValues(form)[field.key]; void execute(field.changeAction, { ...(values[formKey] ?? initialValues(form)), [field.key]: value }).then(ok => { if (!ok) updateValue(formKey, field.key, previous); }); };
  if (!sourceId && !admin) return <div className="sources-screen extension-screen"><FloatingNotice message="只有管理员可以访问插件配置。" error /></div>;
  if (pageQuery.isPending) return <div className="sources-screen extension-screen"><FloatingNotice message="正在加载扩展页面…" busy /><main className="sources-body" /></div>;
  if (pageQuery.error) return <div className="sources-screen extension-screen"><main className="sources-body"><p className="notice error">{pageQuery.error instanceof Error ? pageQuery.error.message : '加载失败'}</p></main></div>;
  if (!page) return null;
  const status = busy ? '正在处理…' : error || (noticeTab === activeTab ? page.notice ?? '' : ''); const statusError = Boolean(error || (!busy && page.noticeKind === 'error'));
  return <div className="sources-screen extension-screen"><header className="sources-header"><IconButton label="返回" icon="arrow-left" onClick={() => navigate('/sources')} /><h1>{page.title}</h1><Button disabled={busy} onClick={() => void execute()}>刷新</Button></header>
    {tabs.length > 0 && <div className="extension-toolbar"><div className="extension-tabs" role="tablist" aria-label="配置分类">{tabs.map((tab, index) => <button type="button" key={tab.id} id={`extension-tab-${tab.id}`} role="tab" aria-selected={activeTab === tab.id} aria-controls={`extension-panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1} disabled={busy} onClick={() => { setActiveTab(tab.id); if (tab.loadAction) void execute(tab.loadAction); }} onKeyDown={event => { let next = index; if (event.key === 'ArrowRight') next = (index + 1) % tabs.length; else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length; else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = tabs.length - 1; else return; event.preventDefault(); const nextTab = tabs[next]!; setActiveTab(nextTab.id); document.getElementById(`extension-tab-${nextTab.id}`)?.focus({ preventScroll: true }); }}>{tab.title}</button>)}</div></div>}
    {status && <FloatingNotice message={status} busy={busy} error={statusError} kind="success" />}
    <main className="sources-body" aria-busy={busy} tabIndex={-1}>{page.description && <p className="extension-description">{page.description}</p>}
      <ContentView content={page} scope="page" values={values} busy={busy} selected={selected} expanded={expanded} onChange={updateValue.bind(null)} onSubmit={submit} onSelectAction={selectAction} onToggle={toggleExpanded} onToggleSelected={toggleSelected} />
      {selectedTab && <div role="tabpanel" id={`extension-panel-${selectedTab.id}`} aria-labelledby={`extension-tab-${selectedTab.id}`} tabIndex={-1}>{selectedTab.description && <p className="extension-description">{selectedTab.description}</p>}<ContentView content={selectedTab} scope={`tab:${selectedTab.id}`} values={values} busy={busy} selected={selected} expanded={expanded} onChange={updateValue.bind(null)} onSubmit={submit} onSelectAction={selectAction} onToggle={toggleExpanded} onToggleSelected={toggleSelected} /></div>}
    </main>{confirmation && <FloatingConfirm title="确认操作" text={confirmation.form.confirm ?? ''} confirmText={`确认${confirmation.form.submit}`} cancelText="取消" onCancel={() => setConfirmation(null)} onConfirm={() => void execute(confirmation.form.id, confirmation.values, confirmation.key, confirmation.form)} />}
  </div>;
}

function findForm(page: ExtensionPage | undefined, key: string) { if (!page) return undefined; const forms = [page, ...(page.tabs ?? [])].flatMap(content => [...content.forms, ...(content.sections ?? []).flatMap(section => section.items.flatMap(item => item.forms ?? []))]); return forms.find(form => key.endsWith(`:form:${form.id}`)); }
