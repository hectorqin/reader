import { ApiError, type ReaderApi } from '../api/client.ts';
import type { ExtensionForm, ExtensionPage } from '../api/sources.ts';
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
  private inputs = new Map<ExtensionForm, Record<string, string | number | boolean>>();
  constructor(private readonly options: { api: ReaderApi; pluginId: string; pageId: string; onBack(): void; onSignedOut(): void }) {
    this.element.className = 'sources-screen'; this.ui = mountUI(this.element, () => this.view(), null);
  }
  show() { return this.run(); }
  dispose() { this.disposed = true; this.inputs.clear(); this.ui.unmount(); }
  private draw() { if (!this.disposed) this.ui.update(null); }
  private async run(action?: string, values?: Record<string, unknown>) {
    if (this.busy || this.disposed) return;
    this.busy = true; this.error = ''; this.draw();
    try {
      const page = await this.options.api.pluginPage(this.options.pluginId, this.options.pageId, action, values);
      if (this.disposed) return; this.page = page; this.inputs.clear();
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
  private view() {
    return <>
      <header className="sources-header"><IconButton label="返回" icon="arrow-left" onClick={this.options.onBack} /><h1>{this.page?.title ?? '插件配置'}</h1>
        <Button disabled={this.busy} onClick={() => void this.run()}>刷新</Button></header>
      <div role="status" className="notice">{this.busy ? '正在处理…' : this.error}</div>
      <main className="sources-body"><p>{this.page?.description}</p>
        {this.page?.forms.map(form => <section className="sources-card">{this.form(form)}</section>)}
        {this.page?.sections?.map(section => <section className="sources-card"><h2>{section.title}</h2>
          {section.items.map(item => <article className="sources-card"><h3>{item.title}</h3><p className="source-description">{item.description}</p>
            {item.forms?.map(form => this.form(form))}</article>)}
        </section>)}
      </main>
    </>;
  }
}
