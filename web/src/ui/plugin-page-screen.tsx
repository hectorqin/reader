import { ApiError, type ReaderApi } from '../api/client.ts';
import type { ExtensionContent, ExtensionForm, ExtensionPage } from '../api/sources.ts';
import { mountUI } from './mount.ts';
import { Button, IconButton } from './toolkit.tsx';

/** Safe declarative UI: plugins supply data and actions, never app-origin HTML. */
export class PluginPageScreen {
  readonly element = document.createElement('div');
  private readonly ui: ReturnType<typeof mountUI>;
  private page?: ExtensionPage;
  private disposed = false;
  private busy = false;
  private error = '';
  private activeTab = '';
  private expanded = new Set<string>();
  private inputs = new Map<ExtensionForm, Record<string, string | number | boolean>>();
  constructor(private readonly options: { api: ReaderApi; pageId: string; onBack(): void; onSignedOut(): void } & ({ sourceId: string; pluginId?: never } | { pluginId: string; sourceId?: never })) {
    this.element.className = 'sources-screen extension-screen'; this.ui = mountUI(this.element, () => this.view(), null);
  }
  show() { return this.run(); }
  dispose() { this.disposed = true; this.inputs.clear(); this.ui.unmount(); }
  private draw() { if (!this.disposed) this.ui.update(null); }
  private async run(action?: string, values?: Record<string, unknown>) {
    if (this.busy || this.disposed) return;
    this.busy = true; this.error = ''; this.draw();
    try {
      const page = await (this.options.sourceId !== undefined
        ? this.options.api.sourcePage(this.options.sourceId, this.options.pageId, action, values)
        : this.options.api.pluginPage(this.options.pluginId!, this.options.pageId, action, values));
      if (this.disposed) return; this.page = page; this.inputs.clear(); this.expanded.clear();
      this.activeTab = page.activeTab ?? (page.tabs?.some(tab => tab.id === this.activeTab) ? this.activeTab : page.tabs?.[0]?.id ?? '');
    } catch (error) {
      if (this.disposed) return;
      if (error instanceof ApiError && error.isAuthFailure) this.options.onSignedOut();
      else this.error = error instanceof Error ? error.message : '操作失败';
    } finally { this.busy = false; this.draw(); }
  }
  private form(form: ExtensionForm) {
    let values = this.inputs.get(form);
    if (!values) { values = { ...form.values }; for (const field of form.fields) values[field.key] = field.value ?? (field.type === 'boolean' ? false : ''); this.inputs.set(form, values); }
    const data = values;
    return <form onSubmit={event => { event.preventDefault(); void this.run(form.id, data); }}>
      {form.title && <h3>{form.title}</h3>}
      {form.fields.map(field => <label key={field.key}>{field.label}
        {field.type === 'textarea' ? <textarea required={field.required} disabled={this.busy} value={String(data[field.key] ?? '')} onInput={event => { data[field.key] = event.currentTarget.value; }} />
          : field.type === 'boolean' ? <input type="checkbox" disabled={this.busy} checked={data[field.key] === true} onChange={event => { data[field.key] = event.currentTarget.checked; }} />
          : field.type === 'select' ? <select disabled={this.busy} value={String(data[field.key] ?? '')} onChange={event => { data[field.key] = event.currentTarget.value; }}>
            {field.options?.map(option => <option value={option.value}>{option.label}</option>)}
          </select> : <input required={field.required} disabled={this.busy} type={field.type === 'number' ? 'number' : 'text'} value={String(data[field.key] ?? '')}
            onInput={event => { data[field.key] = field.type === 'number' ? Number(event.currentTarget.value) : event.currentTarget.value; }} />}
      </label>)}
      <Button type="submit" disabled={this.busy}>{form.submit}</Button>
    </form>;
  }
  private content(content: ExtensionContent, scope = 'page') {
    return <>
      {content.forms.map(form => <section className="sources-card">{this.form(form)}</section>)}
      {content.sections?.map((section, sectionIndex) => <section className="extension-section"><h2>{section.title}</h2>
        {!section.items.length && section.emptyText && <p className="extension-empty">{section.emptyText}</p>}
        {section.items.map((item, index) => {
          const key = scope + ':' + sectionIndex + ':' + index, open = this.expanded.has(key);
          return <article className="sources-card extension-item" key={key}>
            <div className="extension-item-heading"><div><h3>{item.title}</h3><p className="source-description">{item.description}</p></div>
              {item.collapsible && <button className="button" type="button" aria-expanded={open} aria-controls={'extension-item-' + key} onClick={() => {
                if (open) this.expanded.delete(key); else this.expanded.add(key); this.draw();
              }}>{open ? '收起' : '管理'}</button>}</div>
            <div id={'extension-item-' + key} hidden={item.collapsible && !open} className="extension-actions">{item.forms?.map(form => this.form(form))}</div>
          </article>;
        })}
      </section>)}
    </>;
  }
  private view() {
    const tabs = this.page?.tabs, selected = tabs?.find(tab => tab.id === this.activeTab);
    const status = this.busy ? '正在处理…' : this.error || this.page?.notice;
    return <>
      <header className="sources-header"><IconButton label="返回" icon="arrow-left" onClick={this.options.onBack} /><h1>{this.page?.title ?? '书源配置'}</h1>
        <Button disabled={this.busy} onClick={() => void this.run()}>刷新</Button></header>
      <main className="sources-body">
        {this.page?.description && <p className="extension-description">{this.page.description}</p>}
        {tabs && <div className="extension-tabs" role="tablist" aria-label="配置分类">{tabs.map((tab, index) => <button type="button"
          id={'extension-tab-' + tab.id} role="tab" aria-selected={this.activeTab === tab.id} aria-controls={'extension-panel-' + tab.id}
          tabIndex={this.activeTab === tab.id ? 0 : -1} onClick={() => { this.activeTab = tab.id; this.draw(); }} onKeyDown={event => {
            let next = index;
            if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
            else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = tabs.length - 1;
            else return;
            event.preventDefault(); this.activeTab = tabs[next]!.id; this.draw();
            document.getElementById('extension-tab-' + this.activeTab)?.focus();
          }}>{tab.title}</button>)}</div>}
        {status && <div role="status" className="notice">{status}</div>}
        {this.page && this.content(this.page)}
        {selected && <div key={selected.id} role="tabpanel" id={'extension-panel-' + selected.id} aria-labelledby={'extension-tab-' + selected.id}>
          {selected.description && <p className="extension-description">{selected.description}</p>}{this.content(selected, 'tab-' + selected.id)}
        </div>}
      </main>
    </>;
  }
}
