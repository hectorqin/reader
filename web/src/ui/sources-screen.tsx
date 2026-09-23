import type { ExtensionField } from '../api/sources.ts';
import { ApiError, type ReaderApi } from '../api/client.ts';
import type { Book } from '../api/types.ts';
import type { ChapterSubscription, SourceEntry, SourceInstance, SourcePage, SourcePlugin, SourceType } from '../api/sources.ts';
import { Modal } from './modal.tsx';
import { FloatingNotice } from './floating-notice.tsx';
import { CatalogFeedback } from './catalog-feedback.tsx';
import { mountUI } from './mount.ts';
import { Button, IconButton, Icon } from './toolkit.tsx';

interface Options { api: ReaderApi; admin: boolean; onBack(): void; onOpen(book: Book): void; onSignedOut(): void }
type SourceTab = 'search' | 'sources' | 'updates' | 'plugins';
interface Editor { id: string | null; typeKey: string; name: string; config: Record<string, unknown>; raw: string }
const keyFor = (type: { pluginId: string; id: string }) => `${type.pluginId}/${type.id}`;
const date = (value: number | null) => value ? new Date(value).toLocaleString() : '尚未检查';
// getRandomValues also works when a self-hosted Reader is opened over LAN HTTP.
const searchId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

/** Source configuration and browsing use the same declared provider capabilities. */
export class SourcesScreen {
  readonly element = document.createElement('div');
  private readonly ui: ReturnType<typeof mountUI>;
  private disposed = false;
  private working = false;
  private searchRun: AbortController | null = null;
  private searchState: 'idle' | 'searching' | 'stopped' | 'complete' | 'error' | 'limited' = 'idle';
  private searchSession: { sourceId: string; id: string } | null = null;
  private searchMenu = false;
  private searchRequest: { query: string; filters: Record<string, string> } | null = null;
  private get busy(): boolean { return this.working || this.searchRun !== null; }
  private message = '';
  private messageError = false;
  private savedSource: SourceInstance | null = null;
  private types: SourceType[] = [];
  private sources: SourceInstance[] = [];
  private plugins: SourcePlugin[] = [];
  private subscriptions: ChapterSubscription[] = [];
  private tab: SourceTab = 'search';
  private credentialsOpen = false;
  private managing: string | null = null;
  private editor: Editor | null = null;
  private selected: SourceInstance | null = null;
  private page: SourcePage | null = null;
  private path: Array<{ ref?: string; query?: string; cursor?: string; filters?: Record<string, string> }> = [];
  private query = '';
  private filters: ExtensionField[] = [];
  private filterValues: Record<string, string> = {};
  private credentialValues: Record<string, string> = {};
  private folder = '';
  private pluginFile: File | null = null;
  private pluginFileVersion = 0;
  private installing = false;
  private installMethod: 'npm' | 'upload' = 'npm';
  private trusted = false;
  private acquired: Book | null = null;

  constructor(private readonly options: Options) {
    this.element.className = 'sources-screen sources-hub';
    this.ui = mountUI(this.element, () => this.view(), null);
  }
  async show(): Promise<void> { await this.run(() => this.reload()); }
  dispose(): void { this.disposed = true; this.stopSearch(); this.credentialValues = {}; this.ui.unmount(); }
  private draw(): void { if (!this.disposed) this.ui.update(null); }
  private async run(action: () => Promise<void>, duringSearch = false): Promise<void> {
    if (this.working || (!duringSearch && this.searchRun) || this.disposed) return;
    this.working = true; this.message = ''; this.messageError = false; this.draw();
    try { await action(); }
    catch (error) {
      if (this.disposed) return;
      if (error instanceof ApiError && error.isAuthFailure) this.options.onSignedOut();
      else { this.message = error instanceof Error ? error.message : '操作失败，请重试'; this.messageError = true; }
    } finally {
      this.working = false; this.draw();
    }
  }
  private async reload(): Promise<void> {
    const [types, sources, subscriptions, plugins] = await Promise.all([
      this.options.api.sourceTypes(), this.options.api.sources(), this.options.api.subscriptions(),
      this.options.admin ? this.options.api.plugins() : Promise.resolve([]),
    ]);
    this.types = types; this.sources = sources; this.subscriptions = subscriptions; this.plugins = plugins;
    if (this.savedSource) this.savedSource = sources.find(source => source.id === this.savedSource?.id) ?? null;
    if (this.selected) {
      this.selected = sources.find(source => source.id === this.selected?.id && source.enabled && source.descriptor) ?? null;
      if (!this.selected) { this.page = null; this.filters = []; this.credentialValues = {}; }
    }
  }
  private async installPlugin(upload: boolean): Promise<void> {
    if (!this.trusted || (upload && !this.pluginFile)) return;
    await this.run(async () => {
      this.installing = true; this.draw();
      try {
        const plugin = upload ? await this.options.api.uploadPlugin(this.pluginFile!) : await this.options.api.installPlugin(this.folder.trim());
        this.folder = ''; this.pluginFile = null; this.pluginFileVersion++; this.trusted = false;
        await this.reload();
        this.message = plugin?.updated ? `插件已更新至 ${plugin.version} 并启用，书源配置和数据已保留。` : '插件已安装并启用，可前往“书源管理”添加来源。';
      } finally { this.installing = false; }
    });
  }
  private edit(source?: SourceInstance): void {
    const type = source ? this.types.find((t) => t.pluginId === source.pluginId && t.id === source.sourceType) : this.types.find((t) => t.id === 'opds') ?? this.types[0];
    if (!type) return;
    this.editor = { id: source?.id ?? null, typeKey: keyFor(type), name: source?.name ?? '', config: { ...source?.config }, raw: JSON.stringify(source?.config ?? {}, null, 2) };
    this.message = ''; this.draw();
  }
  private async save(): Promise<void> {
    const editor = this.editor; if (!editor) return;
    const type = this.types.find((t) => keyFor(t) === editor.typeKey)!;
    const config = type.configSchema?.properties ? editor.config : JSON.parse(editor.raw);
    this.savedSource = await this.options.api.saveSource(editor.id, { name: editor.name, config, ...(!editor.id ? { pluginId: type.pluginId, sourceType: type.id } : {}) });
    this.editor = null; await this.reload(); this.message = this.savedSource?.descriptor?.extensions?.pages?.length ? '来源已保存，接下来可以配置此书源。' : editor.id ? '来源已保存；修改连接配置后请重新保存个人凭据。' : '来源已创建，可在“搜书”中选择此来源。';
  }
  private async catalog(query: { ref?: string; query?: string; cursor?: string; filters?: Record<string, string> }, push = true): Promise<void> {
    if (!this.selected) return;
    const page = await this.options.api.sourceCatalog(this.selected.id, query);
    this.page = page;
    if (push) {
      if (query.query !== undefined && !query.cursor) this.path = [query];
      else this.path.push(query);
    }
  }
  private select(source: SourceInstance): void {
    this.stopSearch(); this.searchState = 'idle'; this.searchRequest = null; this.searchSession = null; this.searchMenu = false;
    this.selected = source; this.page = null; this.path = []; this.query = ''; this.credentialValues = {}; this.acquired = null;
    this.filters = []; this.filterValues = {};
    void this.run(async () => {
      if (source.descriptor?.capabilities.includes('search.filters')) this.filters = await this.options.api.sourceFilters(source.id);
      if (source.descriptor?.capabilities.includes('browse')) await this.catalog({});
      this.draw();
    });
  }
  private stopSearch(): void {
    if (!this.searchRun) return;
    const run = this.searchRun; this.searchRun = null;
    this.searchState = 'stopped'; run.abort(); this.draw();
  }
  private get canResume(): boolean {
    return !!this.searchSession && !!this.searchRequest && this.searchState !== 'limited'
      && !!(this.page?.nextCursor || this.searchState === 'stopped' || this.searchState === 'error')
      && this.query.trim() === this.searchRequest.query
      && JSON.stringify(this.filterValues) === JSON.stringify(this.searchRequest.filters);
  }
  private async search(append = false): Promise<void> {
    if (this.busy || !this.selected || this.disposed) return;
    const source = this.selected, run = new AbortController();
    const request = append ? this.searchRequest : { query: this.query.trim(), filters: { ...this.filterValues } };
    if (!request?.query) return;
    const cursor = append ? this.page?.nextCursor : undefined;
    if (append && !this.canResume) return;
    this.searchMenu = false;
    if (!append) { this.page = null; this.path = []; this.acquired = null; }
    if (!append) this.searchSession = { sourceId: source.id, id: searchId() };
    const session = this.searchSession;
    this.searchRequest = request; this.searchRun = run; this.searchState = 'searching'; this.message = ''; this.messageError = false; this.draw();
    const current = () => !this.disposed && this.searchRun === run;
    try {
      if (!current()) return;
      for await (const page of this.options.api.searchSource(source.id,
        { ...request, ...(cursor ? { cursor } : {}), sessionId: session!.id, resultLimit: 10000 }, { signal: run.signal })) {
        if (!current()) return;
        if (page.batch && this.page?.batch && (page.batch.completed < this.page.batch.completed)) throw new Error('来源搜索进度没有推进，请重新搜索。');
        const entries = new Map((this.page?.items ?? []).map(entry => [entry.ref, entry]));
        for (const entry of page.items) { if (entries.has(entry.ref) || entries.size < 10000) entries.set(entry.ref, entry); }
        const errors = new Map((this.page?.errors ?? []).map(error => [error.source + '\0' + error.code, error]));
        for (const error of page.errors ?? []) errors.set(error.source + '\0' + error.code, error);
        this.page = { ...page, items: [...entries.values()], errors: [...errors.values()] };
        this.draw();
        if (entries.size >= 10000 || (page.limitReached && !page.nextCursor)) {
          this.message = '已达到单次搜索结果上限，请缩小搜索范围后重新搜索。';
          this.searchState = 'limited'; delete this.page.nextCursor; break;
        }
      }
      if (current() && this.searchState === 'searching') this.searchState = 'complete';
    } catch (error) {
      if (!current()) return;
      this.searchState = 'error';
      if (error instanceof ApiError && error.isAuthFailure) this.options.onSignedOut();
      else { this.message = error instanceof Error ? error.message : '搜索失败，已保留找到的书籍。'; this.messageError = true; }
    } finally {
      if (current()) { this.searchRun = null; this.draw(); }
    }
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
  private changeTab(tab: SourceTab): void {
    this.stopSearch();
    this.tab = tab; this.managing = null; this.message = ''; this.draw();
    const body = this.element.querySelector('.sources-body'); if (body) body.scrollTop = 0;
  }
  private view() {
    const type = this.types.find((t) => keyFor(t) === this.editor?.typeKey);
    const resume = this.canResume && (this.searchState === 'stopped' || this.searchState === 'error');
    const tabs: Array<{ id: SourceTab; title: string }> = [
      { id: 'search', title: '搜书' },
      ...(this.options.admin ? [{ id: 'sources' as const, title: '书源管理' }] : []),
      { id: 'updates', title: '自动追更' },
      ...(this.options.admin ? [{ id: 'plugins' as const, title: '插件管理' }] : []),
    ];
    return <>
      <header className="sources-header"><IconButton label="返回" icon="arrow-left" onClick={this.options.onBack} /><h1>书源与追更</h1>
        <Button disabled={this.busy} onClick={() => void this.run(() => this.reload())}>刷新</Button></header>
      <nav className="sources-tabs" role="tablist" aria-label="书源功能">{tabs.map((tab, index) => <button key={tab.id} type="button"
        role="tab" id={'sources-tab-' + tab.id} aria-controls={'sources-panel-' + tab.id} aria-selected={this.tab === tab.id}
        tabIndex={this.tab === tab.id ? 0 : -1} disabled={this.busy} onClick={() => this.changeTab(tab.id)} onKeyDown={event => {
          let next = index;
          if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
          else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = tabs.length - 1;
          else return;
          event.preventDefault(); this.changeTab(tabs[next]!.id);
          this.element.querySelector<HTMLElement>('#sources-tab-' + tabs[next]!.id)?.focus();
        }}>{tab.title}{tab.id === 'updates' && this.subscriptions.some(s => s.newChapters > 0) && <span className="sources-tab-dot" aria-label="有更新" />}</button>)}</nav>
      <FloatingNotice busy={this.working} error={this.messageError} message={this.installing ? '正在安装插件并启用，请稍候…' : this.working ? '正在处理…' : this.message} />
      <main key="body" className="sources-body" role="tabpanel" id={'sources-panel-' + this.tab} aria-labelledby={'sources-tab-' + this.tab} tabIndex={0}>
      {this.tab === 'sources' && this.options.admin && <>
        {!!this.savedSource?.descriptor?.extensions?.pages?.length && <section className="sources-card source-next-step"><strong>{this.savedSource!.name}</strong>
          <p>可为此书源单独管理订阅和规则。</p>{this.savedSource!.descriptor!.extensions!.pages!.map(page => <a className="button primary" href={'#/sources/' + encodeURIComponent(this.savedSource!.id) + '/' + encodeURIComponent(page.id)}>{page.title}</a>)}
        </section>}
        <section key="source-list" className="sources-card sources-list"><div className="sources-list-heading"><h2>我的来源 <span className="source-count">{this.sources.length}</span></h2>
          {this.options.admin && <Button className="source-add" disabled={this.busy} onClick={() => this.edit()}><Icon name="plus" />添加来源</Button>}
        </div>
          {this.sources.map(source => <article className="sources-row source-entry" key={source.id}>
            <div className="source-entry-top"><div className="source-entry-info"><strong>{source.name}</strong>
              <small>{source.descriptor?.label ?? '插件未启用或未安装'}</small>
              <span className={'source-state' + (source.enabled ? ' is-enabled' : '')}>{source.enabled ? '已启用' : '已暂停'}</span>
            </div><div className="source-entry-actions">
              {this.options.admin && <button type="button" className="source-manage-trigger" disabled={this.busy}
                aria-expanded={this.managing === source.id} aria-controls={'source-manage-' + source.id}
                onClick={() => { this.managing = this.managing === source.id ? null : source.id; this.draw(); }}
                onKeyDown={event => { if (event.key === 'Escape') { this.managing = null; this.draw(); } }}>管理<Icon name="chevron-right" /></button>}
            </div></div>
            {this.options.admin && this.managing === source.id && <div className="source-management" id={'source-manage-' + source.id} role="group" aria-label={source.name + '管理'}
              onKeyDown={event => { if (event.key === 'Escape') { this.managing = null; this.draw();
                this.element.querySelectorAll<HTMLElement>('.source-manage-trigger')[this.sources.indexOf(source)]?.focus();
              } }}>
              {source.descriptor?.extensions?.pages?.map(page => <a className="source-management-link" href={'#/sources/' + encodeURIComponent(source.id) + '/' + encodeURIComponent(page.id)}>{page.title}<Icon name="chevron-right" /></a>)}
              <button className="source-management-link" type="button" disabled={this.busy || !source.descriptor} onClick={() => this.edit(source)}>基本设置<Icon name="chevron-right" /></button>
              <button className="source-management-link source-toggle" type="button" disabled={this.busy} onClick={() => void this.run(async () => {
                await this.options.api.saveSource(source.id, { enabled: !source.enabled }); await this.reload(); this.managing = null;
                this.message = source.enabled ? '来源已暂停' : '来源已启用';
              })}>{source.enabled ? '暂停' : '启用'}</button>
            </div>}
          </article>)}
        </section>
      </>}
      {this.tab === 'search' && <>
        <section className="sources-card source-picker"><div><h2>搜书</h2><p className="muted">选择来源，发现想读的书。</p></div>
          <label>选择来源<select aria-label="选择来源" disabled={this.busy} value={this.selected?.id ?? ''} onChange={event => {
            const source = this.sources.find(source => source.id === event.currentTarget.value); if (source) this.select(source);
          }}><option value="" disabled>请选择一个来源</option>{this.sources.filter(source => source.enabled && source.descriptor).map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
          {!this.selected && <p className="muted">{this.sources.some(source => source.enabled && source.descriptor) ? '选择来源后，即可搜索书籍或浏览目录。' : '暂无可用来源，请先添加或启用来源。'}</p>}
        </section>
        {this.selected && <section className="sources-card source-catalog"><h2>搜索与浏览</h2>
          {(this.selected.descriptor?.credentialKeys?.length ?? 0) > 0 && <Button disabled={this.busy} onClick={() => { this.credentialsOpen = true; this.message = ''; this.draw(); }}>登录凭据</Button>}
          {this.selected.descriptor?.capabilities.includes('search') && <form className="sources-search" onSubmit={(event) => { event.preventDefault(); void this.search(resume); }}>
            {this.filters.map(field => <label key={field.key}>{field.label}<select aria-label={field.label} value={this.filterValues[field.key] ?? ''} disabled={this.busy}
              onChange={event => { this.filterValues[field.key] = event.currentTarget.value; this.draw(); }}>
              {field.options?.map(option => <option value={option.value}>{option.label}</option>)}
            </select></label>)}
            <label className="source-keyword">搜索书籍<input type="search" placeholder="输入书名或作者" disabled={this.busy} required value={this.query} onInput={(event) => { this.query = event.currentTarget.value; this.draw(); }} /></label>
            {this.searchRun ? <Button key="stop" type="button" className="search-stop" onClick={event => { event.preventDefault(); this.stopSearch(); }}><Icon name="stop" />停止搜索</Button>
              : <div key="search" className="search-split" onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { this.searchMenu = false; this.draw(); }
              }} onKeyDown={event => {
                if (event.key === 'Escape') { this.searchMenu = false; this.draw(); this.element.querySelector<HTMLButtonElement>('.search-menu-toggle')?.focus(); }
                if (this.searchMenu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault(); const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)')];
                  const index = items.indexOf(document.activeElement as HTMLButtonElement);
                  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
                  items[next]?.focus();
                }
              }}>
                <Button className="primary" type="submit" disabled={this.busy}><Icon name={resume ? 'play' : 'search'} />{resume ? '继续搜索' : '搜索'}</Button>
                {this.searchRequest && <><button type="button" className="button primary search-menu-toggle" aria-label="搜索选项" aria-haspopup="menu" aria-expanded={this.searchMenu} aria-controls="source-search-menu" disabled={this.busy}
                  onClick={() => { this.searchMenu = !this.searchMenu; this.draw(); }}><Icon name="chevron-right" /></button>
                  {this.searchMenu && <div id="source-search-menu" className="search-menu" role="menu" aria-label="搜索选项">
                    <button type="button" role="menuitem" aria-label="继续搜索" disabled={!this.canResume} onClick={() => void this.search(true)}><Icon name="play" /><span>继续搜索<small>保留结果，继续未完成的来源</small></span></button>
                    <button type="button" role="menuitem" aria-label="重新搜索" onClick={() => void this.search(false)}><Icon name="refresh" /><span>重新搜索<small>清空结果，从头搜索</small></span></button>
                  </div>}</>}
              </div>}</form>}
          {this.searchState !== 'idle' && <div className="search-progress" role="status">
            <span>{({ searching: '正在搜索', stopped: '已停止搜索', complete: '搜索完成', error: '搜索中断', limited: '已达到结果上限' })[this.searchState]}{this.page?.batch ? ` · 已检查 ${this.page.batch.completed} / ${this.page.batch.total} 个来源` : ''} · 已找到 {this.page?.items.length ?? 0} 本书</span>
            {this.page?.batch && <progress aria-label="书源搜索进度" max={Math.max(1, this.page.batch.total)} value={this.page.batch.completed} />}
            {this.searchState === 'searching' && <small>可查看详情、加入书架，或随时停止。</small>}
          </div>}
          {this.page && <CatalogFeedback page={this.page} merged={this.searchState !== 'idle'} searching={this.searchState === 'searching'} />}
          {this.page?.navigation?.map((entry) => <Button disabled={this.busy} onClick={() => void this.run(() => this.catalog({ ref: entry.ref }))}>{entry.title}</Button>)}
          {this.page?.items.length === 0 && !this.searchRun && <div className="catalog-empty"><Icon name={this.page.errors?.length ? 'warning' : 'search'} /><strong>{this.searchState === 'stopped' ? '搜索已停止，暂未找到书籍' : this.page.errors?.length ? '暂未返回书籍，部分来源搜索失败' : '没有找到匹配书籍'}</strong><p>{this.page.errors?.length ? '请查看失败原因，或调整搜索范围后重试。' : '试试其他关键词，或调整搜索范围。'}</p></div>}
          {this.page?.items.map((entry) => <article className="sources-row catalog-book" key={entry.ref}>
            <div><strong>{entry.title}</strong><small>{entry.authors?.join(' / ')}</small><p className="source-description">{entry.description}</p></div>
            <div className="sources-actions"><Button disabled={this.working} onClick={() => void this.run(async () => {
              const detail = await this.options.api.sourceDetail(this.selected!.id, entry.ref);
              const current = this.page?.items.find(item => item.ref === entry.ref); if (current) Object.assign(current, detail);
            }, true)}>详情</Button>
            {(entry.options?.length ? entry.options : [{ id: '', label: '加入书架' }]).map((option) => <Button className="primary" disabled={this.working || option.available === false}
              onClick={() => void this.run(() => this.acquire(entry, option.id), true)}>{option.label}</Button>)}</div>
          </article>)}
          {this.searchState === 'complete' && this.page?.nextCursor && <div className="catalog-pagination"><Button disabled={this.busy || !this.canResume} onClick={() => void this.search(true)}>加载更多结果</Button></div>}
          {this.searchState === 'idle' && (this.path.length > 1 || this.page?.nextCursor) && <nav className="catalog-pagination" aria-label="搜索结果翻页">
            {this.path.length > 1 && <Button disabled={this.busy} onClick={() => void this.run(async () => { const previous = this.path[this.path.length - 2]!; await this.catalog(previous, false); this.path.pop(); })}>上一页</Button>}
            {this.page?.nextCursor && <Button disabled={this.busy} onClick={() => void this.run(() => this.catalog({ ...this.path.at(-1), cursor: this.page!.nextCursor! }))}>下一页</Button>}
          </nav>}
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
        <p className="notice">插件以服务端权限运行。安装前请确认来源可信；npm 安装需要服务端能够访问 npm 仓库。</p>
        <p className="muted">更新已有插件：上传新版安装包或输入 npm 包名与版本即可，书源配置和数据会保留，无需卸载。</p>
        <label className="sources-consent"><input type="checkbox" disabled={this.busy} checked={this.trusted} onChange={(event) => { this.trusted = event.currentTarget.checked; this.draw(); }} />我信任这个插件的代码</label>
        <div className="plugin-install">
          <div className="plugin-install-tabs" role="tablist" aria-label="插件安装方式">
            {(['npm', 'upload'] as const).map(method => <button type="button" role="tab" id={'install-tab-' + method}
              aria-controls={'install-panel-' + method} aria-selected={this.installMethod === method} tabIndex={this.installMethod === method ? 0 : -1}
              disabled={this.busy} onClick={() => { this.installMethod = method; this.draw(); }} onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault(); this.installMethod = event.key === 'Home' ? 'npm' : event.key === 'End' ? 'upload' : method === 'npm' ? 'upload' : 'npm';
                this.draw(); this.element.querySelector<HTMLElement>('#install-tab-' + this.installMethod)?.focus();
              }}>{method === 'npm' ? '从 npm 安装' : '上传安装包'}</button>)}
          </div>
          <form hidden={this.installMethod !== 'npm'} role="tabpanel" id="install-panel-npm" aria-labelledby="install-tab-npm" onSubmit={(event) => { event.preventDefault(); void this.installPlugin(false); }}>
            <label>npm 包名<input required disabled={this.busy} value={this.folder} placeholder="reader-source-example 或 @scope/package" onInput={(event) => { this.folder = event.currentTarget.value; this.draw(); }} /></label>
            <small>支持包名、@scope/包名，以及包名@版本或标签。</small>
            <Button type="submit" disabled={this.busy || !this.trusted || !this.folder.trim()}>安装并启用</Button>
          </form>
          <form hidden={this.installMethod !== 'upload'} role="tabpanel" id="install-panel-upload" aria-labelledby="install-tab-upload" onSubmit={(event) => { event.preventDefault(); void this.installPlugin(true); }}>
            <label>npm pack 安装包<input key={this.pluginFileVersion} required disabled={this.busy} type="file" accept=".tgz,application/gzip,application/x-gzip" onChange={(event) => {
              const file = event.currentTarget.files?.[0] ?? null;
              const error = file && (!file.name.toLowerCase().endsWith('.tgz') ? '请选择 .tgz 安装包。' : file.size > 100 * 1024 * 1024 ? '安装包不能超过 100 MiB。' : '');
              this.pluginFile = error ? null : file; this.message = error || ''; this.messageError = !!error; this.draw();
            }} /></label>
            <small>仅支持 .tgz 文件，最大 100 MiB。未打包的依赖仍需联网下载。</small>
            <Button type="submit" disabled={this.busy || !this.trusted || !this.pluginFile}>上传并启用</Button>
          </form>
        </div>
        <h3>已安装插件</h3>
        {this.plugins.map((plugin) => <article className="sources-row" key={plugin.pluginId}><div><strong>{plugin.name ?? plugin.pluginId}</strong>
          <small>{plugin.version} · {plugin.builtin ? '内置' : plugin.enabled ? '已启用' : '已停用'}{plugin.error ? ` · ${plugin.error.message}` : ''}{plugin.runtime?.state === 'failed' ? ' · 运行失败，请重启插件' : ''}</small></div>
          {plugin.enabled && plugin.extensions?.pages?.map(page => <a className="button" href={'#/plugins/' + encodeURIComponent(plugin.pluginId) + '/' + encodeURIComponent(page.id)}>{page.title}</a>)}
          {!plugin.builtin && <div className="sources-actions"><Button disabled={this.busy} onClick={() => void this.run(async () => { await this.options.api.enablePlugin(plugin.pluginId, !plugin.enabled); await this.reload(); })}>{plugin.enabled ? '停用' : '启用'}</Button>
            {plugin.runtime?.state === 'failed' && <Button disabled={this.busy} onClick={() => void this.run(async () => { await this.options.api.enablePlugin(plugin.pluginId, true); await this.reload(); })}>重启插件</Button>}
            <Button disabled={this.busy} onClick={() => void this.run(async () => { await this.options.api.uninstallPlugin(plugin.pluginId); await this.reload(); this.message = '插件已卸载，书籍及已缓存内容保留。'; })}>卸载</Button></div>}
        </article>)}
      </section>}
      </main>
        {this.editor && <Modal title={this.editor.id ? '编辑来源' : '添加来源'} busy={this.busy} onClose={() => { this.editor = null; this.message = ''; this.draw(); }}>
          <form className="sources-card source-editor source-modal-form" onSubmit={(event) => { event.preventDefault(); void this.run(() => this.save()); }}>
            <div className="source-modal-content">
            <label>来源类型<select disabled={this.busy || !!this.editor.id} value={this.editor.typeKey} onChange={(event) => {
              this.editor!.typeKey = event.currentTarget.value; this.editor!.config = {}; this.editor!.raw = '{}'; this.draw();
            }}>{this.types.map((t) => <option value={keyFor(t)}>{t.label}</option>)}</select></label>
            <label>名称<input autoFocus required disabled={this.busy} maxLength={128} value={this.editor.name} onInput={(event) => { this.editor!.name = event.currentTarget.value; }} /></label>
            {type?.configSchema?.properties ? Object.entries(type.configSchema.properties).map(([key, field]) => <label key={key}>{field.title ?? key}
              {field.type === 'array' || field.type === 'object' ? <textarea disabled={this.busy} aria-label={field.title ?? key} value={JSON.stringify(this.editor!.config[key] ?? (field.type === 'array' ? [] : {}), null, 2)}
                onChange={(event) => { try { this.editor!.config[key] = JSON.parse(event.currentTarget.value); event.currentTarget.setCustomValidity(''); } catch { event.currentTarget.setCustomValidity('请输入有效 JSON'); } }} />
                : field.type === 'boolean' ? <input disabled={this.busy} type="checkbox" checked={this.editor!.config[key] === true}
                  onChange={(event) => { this.editor!.config[key] = event.currentTarget.checked; }} />
                : <input disabled={this.busy} min={field.minimum} max={field.maximum} type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'} step={field.type === 'number' ? 'any' : '1'} required={type.configSchema?.required?.includes(key)} value={String(this.editor!.config[key] ?? field.default ?? '')}
                  onInput={(event) => { const value = event.currentTarget.value;
                    if (!value && !type.configSchema?.required?.includes(key)) delete this.editor!.config[key];
                    else this.editor!.config[key] = field.type === 'number' || field.type === 'integer' ? Number(value) : value;
                  }} />}
            </label>) : <label>配置（JSON）<textarea disabled={this.busy} value={this.editor.raw} onInput={(event) => { this.editor!.raw = event.currentTarget.value; }} /></label>}
            <p className="notice">配置不包含密码。修改连接配置会清除该来源保存的个人凭据。</p>
            </div><footer className="source-modal-actions"><Button className="primary" type="submit" disabled={this.busy}>保存来源</Button>
              <Button disabled={this.busy} onClick={() => { this.editor = null; this.message = ''; this.draw(); }}>取消</Button>
              {this.editor.id && <Button disabled={this.busy || type?.id === 'local'} onClick={() => void this.run(async () => {
                await this.options.api.removeSource(this.editor!.id!); this.editor = null; await this.reload();
              })}>删除空来源</Button>}</footer>
          </form></Modal>}
          {this.credentialsOpen && this.selected && <Modal title="我的登录凭据" busy={this.busy} onClose={() => { this.credentialsOpen = false; this.credentialValues = {}; this.message = ''; this.draw(); }}><form className="sources-card source-modal-form" onSubmit={(event) => { event.preventDefault(); void this.run(async () => {
            const source = this.selected!;
            for (const field of source.descriptor?.credentialKeys ?? []) {
              if (this.disposed) return;
              if (field.key in this.credentialValues) await this.options.api.sourceCredential(source.id, field.key, this.credentialValues[field.key]!);
            }
            this.credentialValues = {}; this.credentialsOpen = false; this.message = '个人凭据已保存，不会回显。';
          }); }}><div className="source-modal-content">{this.selected.descriptor?.credentialKeys?.map((field) => <label key={field.key}>{field.label}
            <input autoFocus disabled={this.busy} type="password" autoComplete="off" value={this.credentialValues[field.key] ?? ''} onInput={(event) => { this.credentialValues[field.key] = event.currentTarget.value; }} /></label>)}
            </div><footer className="source-modal-actions"><Button className="primary" type="submit" disabled={this.busy}>保存个人凭据</Button></footer></form></Modal>}

    </>;
  }
}
