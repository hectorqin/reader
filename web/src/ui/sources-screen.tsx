import type { ExtensionField } from '../api/sources.ts';
import { ApiError, type ReaderApi } from '../api/client.ts';
import type { Book } from '../api/types.ts';
import type { ChapterSubscription, SourceEntry, SourceInstance, SourcePage, SourcePlugin, SourceType } from '../api/sources.ts';
import { mountUI } from './mount.ts';
import { Button, IconButton } from './toolkit.tsx';

interface Options { api: ReaderApi; admin: boolean; onBack(): void; onOpen(book: Book): void; onSignedOut(): void }
interface Editor { id: string | null; typeKey: string; name: string; config: Record<string, unknown>; raw: string }
const keyFor = (type: { pluginId: string; id: string }) => `${type.pluginId}/${type.id}`;
const date = (value: number | null) => value ? new Date(value).toLocaleString() : '尚未检查';

/** Source configuration and browsing use the same declared provider capabilities. */
export class SourcesScreen {
  readonly element = document.createElement('div');
  private readonly ui: ReturnType<typeof mountUI>;
  private disposed = false;
  private busy = false;
  private message = '';
  private savedSource: SourceInstance | null = null;
  private types: SourceType[] = [];
  private sources: SourceInstance[] = [];
  private plugins: SourcePlugin[] = [];
  private subscriptions: ChapterSubscription[] = [];
  private tab: 'sources' | 'updates' | 'plugins' = 'sources';
  private editor: Editor | null = null;
  private selected: SourceInstance | null = null;
  private page: SourcePage | null = null;
  private path: Array<{ ref?: string; query?: string; cursor?: string; filters?: Record<string, string> }> = [];
  private query = '';
  private filters: ExtensionField[] = [];
  private filterValues: Record<string, string> = {};
  private credentialValues: Record<string, string> = {};
  private folder = '';
  private trusted = false;
  private acquired: Book | null = null;

  constructor(private readonly options: Options) {
    this.element.className = 'sources-screen';
    this.ui = mountUI(this.element, () => this.view(), null);
  }
  async show(): Promise<void> { await this.run(() => this.reload()); }
  dispose(): void { this.disposed = true; this.credentialValues = {}; this.ui.unmount(); }
  private draw(): void { if (!this.disposed) this.ui.update(null); }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true; this.message = ''; this.draw();
    try { await action(); }
    catch (error) {
      if (this.disposed) return;
      if (error instanceof ApiError && error.isAuthFailure) this.options.onSignedOut();
      else this.message = error instanceof Error ? error.message : '操作失败，请重试';
    } finally { this.busy = false; this.draw(); }
  }
  private async reload(): Promise<void> {
    const [types, sources, subscriptions, plugins] = await Promise.all([
      this.options.api.sourceTypes(), this.options.api.sources(), this.options.api.subscriptions(),
      this.options.admin ? this.options.api.plugins() : Promise.resolve([]),
    ]);
    this.types = types; this.sources = sources; this.subscriptions = subscriptions; this.plugins = plugins;
    if (this.savedSource) this.savedSource = sources.find(source => source.id === this.savedSource?.id) ?? null;
    if (this.selected) this.selected = sources.find((source) => source.id === this.selected?.id) ?? null;
  }
  private edit(source?: SourceInstance): void {
    const type = source ? this.types.find((t) => t.pluginId === source.pluginId && t.id === source.sourceType) : this.types.find((t) => t.id === 'opds') ?? this.types[0];
    if (!type) return;
    this.editor = { id: source?.id ?? null, typeKey: keyFor(type), name: source?.name ?? '', config: { ...source?.config }, raw: JSON.stringify(source?.config ?? {}, null, 2) };
    this.draw(); this.element.querySelector('.source-editor')?.scrollIntoView?.({ block: 'start' });
  }
  private async save(): Promise<void> {
    const editor = this.editor; if (!editor) return;
    const type = this.types.find((t) => keyFor(t) === editor.typeKey)!;
    const config = type.configSchema?.properties ? editor.config : JSON.parse(editor.raw);
    this.savedSource = await this.options.api.saveSource(editor.id, { name: editor.name, config, ...(!editor.id ? { pluginId: type.pluginId, sourceType: type.id } : {}) });
    this.editor = null; await this.reload(); this.message = this.savedSource?.descriptor?.extensions?.pages?.length ? '来源已保存，接下来可以配置此书源。' : editor.id ? '来源已保存；修改连接配置后请重新保存个人凭据。' : '来源已创建，可以打开书库。';
    this.draw(); this.element.querySelector('.source-next-step')?.scrollIntoView?.({ block: 'start' });
  }
  private async catalog(query: { ref?: string; query?: string; cursor?: string; filters?: Record<string, string> }, push = true): Promise<void> {
    if (!this.selected) return;
    const page = await this.options.api.sourceCatalog(this.selected.id, query);
    this.page = page; if (push) this.path.push(query);
  }
  private select(source: SourceInstance): void {
    this.selected = source; this.page = null; this.path = []; this.query = ''; this.credentialValues = {}; this.acquired = null;
    this.filters = []; this.filterValues = {};
    void this.run(async () => {
      if (source.descriptor?.capabilities.includes('search.filters')) this.filters = await this.options.api.sourceFilters(source.id);
      if (source.descriptor?.capabilities.includes('browse')) await this.catalog({});
      this.draw(); this.element.querySelector('.source-catalog')?.scrollIntoView?.({ block: 'start' });
    });
  }
  private async acquire(entry: SourceEntry, optionId?: string): Promise<void> {
    if (!this.selected) return;
    const result = await this.options.api.acquireSource(this.selected.id, entry.ref, optionId);
    if (result.kind === 'action-required') { this.message = result.action?.label ?? '请先在来源服务完成授权'; return; }
    if (!result.publicationId) throw new Error('来源没有返回书籍');
    this.acquired = (await this.options.api.getBook(result.publicationId)).book;
    this.subscriptions = await this.options.api.subscriptions();
    this.message = '已加入书架，可在“自动追更”中开启检查。';
  }
  private view() {
    const type = this.types.find((t) => keyFor(t) === this.editor?.typeKey);
    return <>
      <header className="sources-header"><IconButton label="返回" icon="arrow-left" onClick={this.options.onBack} /><h1>书源与追更</h1>
        <Button disabled={this.busy} onClick={() => void this.run(() => this.reload())}>刷新</Button></header>
      <nav className="sources-tabs" aria-label="书源功能">
        <Button onClick={() => { this.tab = 'sources'; this.draw(); }}>书源</Button>
        <Button onClick={() => { this.tab = 'updates'; this.draw(); }}>自动追更{this.subscriptions.some((s) => s.newChapters > 0) ? ' · 有更新' : ''}</Button>
        {this.options.admin && <Button onClick={() => { this.tab = 'plugins'; this.draw(); }}>插件管理</Button>}
      </nav>
      {(this.busy || this.message) && <div role="status" className="notice">{this.busy ? '正在处理…' : this.message}</div>}
      <main className="sources-body">
      {this.tab === 'sources' && <>
        {!!this.savedSource?.descriptor?.extensions?.pages?.length && <section className="sources-card source-next-step"><strong>{this.savedSource!.name}</strong>
          <p>可为此书源单独管理订阅和规则。</p>{this.savedSource!.descriptor!.extensions!.pages!.map(page => <a className="button primary" href={'#/sources/' + encodeURIComponent(this.savedSource!.id) + '/' + encodeURIComponent(page.id)}>{page.title}</a>)}
        </section>}
        <section className="sources-card"><h2>我的来源</h2>
          {this.options.admin && <Button disabled={this.busy} onClick={() => this.edit()}>添加来源</Button>}
          {this.sources.map((source) => <div className="sources-row" key={source.id}>
            <div><strong>{source.name}</strong><small>{source.descriptor?.label ?? '插件未启用或未安装'} · {source.enabled ? '已启用' : '已暂停'}</small></div>
            <div className="sources-actions"><Button disabled={this.busy || !source.enabled || !source.descriptor} onClick={() => this.select(source)}>打开</Button>
              {this.options.admin && <>
                {source.descriptor?.extensions?.pages?.map(page => <a className="button" href={'#/sources/' + encodeURIComponent(source.id) + '/' + encodeURIComponent(page.id)}>{page.title}</a>)}
                <Button disabled={this.busy || !source.descriptor} onClick={() => this.edit(source)}>基本设置</Button>
              <Button disabled={this.busy} onClick={() => void this.run(async () => { await this.options.api.saveSource(source.id, { enabled: !source.enabled }); await this.reload(); })}>{source.enabled ? '暂停' : '启用'}</Button></>}
            </div></div>)}
        </section>
        {this.editor && <section className="sources-card source-editor"><h2>{this.editor.id ? '编辑来源' : '添加来源'}</h2>
          <form onSubmit={(event) => { event.preventDefault(); void this.run(() => this.save()); }}>
            <label>来源类型<select disabled={this.busy || !!this.editor.id} value={this.editor.typeKey} onChange={(event) => {
              this.editor!.typeKey = event.currentTarget.value; this.editor!.config = {}; this.editor!.raw = '{}'; this.draw();
            }}>{this.types.map((t) => <option value={keyFor(t)}>{t.label}</option>)}</select></label>
            <label>名称<input required maxLength={128} value={this.editor.name} onInput={(event) => { this.editor!.name = event.currentTarget.value; }} /></label>
            {type?.configSchema?.properties ? Object.entries(type.configSchema.properties).map(([key, field]) => <label key={key}>{field.title ?? key}
              {field.type === 'array' || field.type === 'object' ? <textarea aria-label={field.title ?? key} value={JSON.stringify(this.editor!.config[key] ?? (field.type === 'array' ? [] : {}), null, 2)}
                onChange={(event) => { try { this.editor!.config[key] = JSON.parse(event.currentTarget.value); event.currentTarget.setCustomValidity(''); } catch { event.currentTarget.setCustomValidity('请输入有效 JSON'); } }} />
                : field.type === 'boolean' ? <input type="checkbox" checked={this.editor!.config[key] === true}
                  onChange={(event) => { this.editor!.config[key] = event.currentTarget.checked; }} />
                : <input type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'} step={field.type === 'number' ? 'any' : '1'} required={type.configSchema?.required?.includes(key)} value={String(this.editor!.config[key] ?? '')}
                  onInput={(event) => { const value = event.currentTarget.value;
                    if (!value && !type.configSchema?.required?.includes(key)) delete this.editor!.config[key];
                    else this.editor!.config[key] = field.type === 'number' || field.type === 'integer' ? Number(value) : value;
                  }} />}
            </label>) : <label>配置（JSON）<textarea value={this.editor.raw} onInput={(event) => { this.editor!.raw = event.currentTarget.value; }} /></label>}
            <p className="notice">配置不包含密码。修改连接配置会清除该来源保存的个人凭据。</p>
            <div className="sources-actions"><Button type="submit" disabled={this.busy}>保存来源</Button>
              <Button disabled={this.busy} onClick={() => { this.editor = null; this.draw(); }}>取消</Button>
              {this.editor.id && <Button disabled={this.busy || type?.id === 'local'} onClick={() => void this.run(async () => {
                await this.options.api.removeSource(this.editor!.id!); this.editor = null; await this.reload();
              })}>删除空来源</Button>}</div>
          </form></section>}
        {this.selected && <section className="sources-card source-catalog"><h2>{this.selected.name}</h2>
          {(this.selected.descriptor?.credentialKeys?.length ?? 0) > 0 && <form onSubmit={(event) => { event.preventDefault(); void this.run(async () => {
            const source = this.selected!;
            for (const field of source.descriptor?.credentialKeys ?? []) {
              if (this.disposed) return;
              if (field.key in this.credentialValues) await this.options.api.sourceCredential(source.id, field.key, this.credentialValues[field.key]!);
            }
            this.credentialValues = {}; this.message = '个人凭据已保存，不会回显。';
          }); }}><h3>我的登录凭据</h3>{this.selected.descriptor?.credentialKeys?.map((field) => <label key={field.key}>{field.label}
            <input type="password" autoComplete="off" value={this.credentialValues[field.key] ?? ''} onInput={(event) => { this.credentialValues[field.key] = event.currentTarget.value; }} /></label>)}
            <Button type="submit" disabled={this.busy}>保存个人凭据</Button></form>}
          {this.selected.descriptor?.capabilities.includes('search') && <form className="sources-search" onSubmit={(event) => { event.preventDefault(); void this.run(() => this.catalog({ query: this.query.trim(), filters: { ...this.filterValues } })); }}>
            {this.filters.map(field => <label key={field.key}>{field.label}<select aria-label={field.label} value={this.filterValues[field.key] ?? ''} disabled={this.busy}
              onChange={event => { this.filterValues[field.key] = event.currentTarget.value; this.draw(); }}>
              {field.options?.map(option => <option value={option.value}>{option.label}</option>)}
            </select></label>)}
            <label>搜索书籍<input type="search" required value={this.query} onInput={(event) => { this.query = event.currentTarget.value; }} /></label><Button type="submit" disabled={this.busy}>搜索</Button></form>}
          {this.path.length > 1 && <Button disabled={this.busy} onClick={() => void this.run(async () => { const previous = this.path[this.path.length - 2]!; await this.catalog(previous, false); this.path.pop(); })}>上一页目录</Button>}
          {this.page?.title && <h3>{this.page.title}</h3>}
          {this.page?.navigation?.map((entry) => <Button disabled={this.busy} onClick={() => void this.run(() => this.catalog({ ref: entry.ref }))}>{entry.title}</Button>)}
          {this.page?.items.length === 0 && <p>这里还没有书籍。可以进入分类或换一个关键词。</p>}
          {this.page?.items.map((entry) => <article className="sources-row" key={entry.ref}>
            <div><strong>{entry.title}</strong><small>{entry.authors?.join(' / ')}</small><p className="source-description">{entry.description}</p></div>
            <div className="sources-actions"><Button disabled={this.busy} onClick={() => void this.run(async () => {
              const detail = await this.options.api.sourceDetail(this.selected!.id, entry.ref); Object.assign(entry, detail);
            })}>详情</Button>
            {(entry.options?.length ? entry.options : [{ id: '', label: '加入书架' }]).map((option) => <Button disabled={this.busy || option.available === false}
              onClick={() => void this.run(() => this.acquire(entry, option.id))}>{option.label}</Button>)}</div>
          </article>)}
          {this.page?.nextCursor && <Button disabled={this.busy} onClick={() => void this.run(() => this.catalog({ ...this.path.at(-1), cursor: this.page!.nextCursor! }))}>下一页</Button>}
          {this.acquired && <Button onClick={() => this.options.onOpen(this.acquired!)}>阅读《{this.acquired.title}》</Button>}
        </section>}
      </>}
      {this.tab === 'updates' && <section className="sources-card"><h2>自动追更</h2><p className="notice">服务端定时检查目录，浏览器关闭后继续运行。正文和图片在阅读时缓存。</p>
        {!this.subscriptions.length && <p>先从章节书源加入书籍，再开启追更。</p>}
        {this.subscriptions.map((subscription) => <article className="sources-row" key={subscription.bookId}><div><strong>{subscription.title}</strong>
          <small>{subscription.newChapters ? `新增 ${subscription.newChapters} 章 · ` : ''}上次成功：{date(subscription.lastSuccessAt)}</small>
          <small>{subscription.enabled ? `下次检查：${date(subscription.nextCheckAt)}` : '自动追更已关闭'}{subscription.lastError ? ` · 检查失败：${subscription.lastError}` : ''}</small></div>
          <div className="sources-actions"><label>检查间隔<select aria-label={`${subscription.title}检查间隔`} value={subscription.intervalMinutes} disabled={this.busy}
            onChange={(event) => { const intervalMinutes = Number(event.currentTarget.value); void this.run(async () => { await this.options.api.configureSubscription(subscription.bookId, { intervalMinutes }); await this.reload(); }); }}>
            {[...new Set([15, 60, 360, 1440, subscription.intervalMinutes])].sort((a, b) => a - b).map((minutes) => <option value={minutes}>{minutes} 分钟</option>)}</select></label>
            <Button disabled={this.busy} onClick={() => void this.run(async () => { await this.options.api.configureSubscription(subscription.bookId, { enabled: !subscription.enabled }); await this.reload(); })}>{subscription.enabled ? '关闭追更' : '开启追更'}</Button>
            <Button disabled={this.busy} onClick={() => void this.run(async () => { await this.options.api.refreshPublication(subscription.bookId); await this.reload(); this.message = '目录已更新'; })}>立即检查</Button>
            <Button disabled={this.busy} onClick={() => void this.run(async () => {
              await this.options.api.configureSubscription(subscription.bookId, { acknowledge: true });
              const book = (await this.options.api.getBook(subscription.bookId)).book; if (!this.disposed) this.options.onOpen(book);
            })}>阅读</Button>
          </div></article>)}
      </section>}
      {this.tab === 'plugins' && this.options.admin && <section className="sources-card"><h2>插件管理</h2>
        <form onSubmit={(event) => { event.preventDefault(); if (!this.trusted) return; void this.run(async () => { await this.options.api.installPlugin(this.folder); this.folder = ''; this.trusted = false; await this.reload(); }); }}>
          <label>已部署的插件目录或 npm 包<input required value={this.folder} placeholder="npm:external-source" onInput={(event) => { this.folder = event.currentTarget.value; }} /></label>
          <p className="notice">支持插件目录名，或管理员已安装的 npm:包名。插件以服务端权限运行，部署方式见插件说明。</p>
          <label className="sources-consent"><input type="checkbox" checked={this.trusted} onChange={(event) => { this.trusted = event.currentTarget.checked; this.draw(); }} />我信任这个插件的代码</label>
          <Button type="submit" disabled={this.busy || !this.trusted}>安装插件</Button>
        </form>
        {this.plugins.map((plugin) => <article className="sources-row" key={plugin.pluginId}><div><strong>{plugin.name ?? plugin.pluginId}</strong>
          <small>{plugin.version} · {plugin.builtin ? '内置' : plugin.enabled ? '已启用' : '已停用'}{plugin.error ? ` · ${plugin.error.message}` : ''}{plugin.runtime?.state === 'failed' ? ' · 运行失败，请重启插件' : ''}</small></div>
          {plugin.enabled && plugin.extensions?.pages?.map(page => <a className="button" href={'#/plugins/' + encodeURIComponent(plugin.pluginId) + '/' + encodeURIComponent(page.id)}>{page.title}</a>)}
          {!plugin.builtin && <div className="sources-actions"><Button disabled={this.busy} onClick={() => void this.run(async () => { await this.options.api.enablePlugin(plugin.pluginId, !plugin.enabled); await this.reload(); })}>{plugin.enabled ? '停用' : '启用'}</Button>
            {plugin.runtime?.state === 'failed' && <Button disabled={this.busy} onClick={() => void this.run(async () => { await this.options.api.enablePlugin(plugin.pluginId, true); await this.reload(); })}>重启插件</Button>}
            <Button disabled={this.busy} onClick={() => void this.run(async () => { await this.options.api.uninstallPlugin(plugin.pluginId); await this.reload(); this.message = '插件已卸载，书籍及已缓存内容保留。'; })}>卸载</Button></div>}
        </article>)}
      </section>}
      </main>
    </>;
  }
}
