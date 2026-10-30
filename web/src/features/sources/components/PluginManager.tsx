import { Icon } from '../../../ui/icon.tsx';
import { useState } from 'react';
import { usePlugins, useSourceMutations } from '../hooks/sourceQueries.ts';
import type { SourcePlugin } from '../../../api/sources.ts';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';
import { ActionMenu } from '../../../ui/action-menu.tsx';
import { ConfirmSheet, Sheet } from '../../../ui/sheet.tsx';
import { Button, Callout, Segmented, SwitchRow } from '../../../ui/toolkit.tsx';
import { notify } from '../../../ui/notifications.ts';
import '../styles/plugins.css';

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function status(plugin: SourcePlugin): { label: string; tone?: 'on' | 'error' } {
  if (plugin.error) return { label: '加载失败', tone: 'error' };
  if (!plugin.enabled) return { label: '已停用' };
  return { label: '已启用', tone: 'on' };
}

/** 插件管理 tab of the sources hub, laid out like 书源管理: the installed plugins, and a sheet to install another. Admin only. */
export function PluginManager() {
  const plugins = usePlugins();
  const mutations = useSourceMutations();
  const [installing, setInstalling] = useState(false);
  const [removing, setRemoving] = useState<SourcePlugin | null>(null);
  const list = plugins.data ?? [];
  const toggle = (plugin: SourcePlugin) => mutations.enablePlugin.mutate({ id: plugin.pluginId, enabled: !plugin.enabled }, {
    onError: reason => notify(message(reason, plugin.enabled ? '停用失败' : '启用失败'), { kind: 'error' }),
  });
  const uninstall = (plugin: SourcePlugin) => mutations.uninstallPlugin.mutate(plugin.pluginId, {
    onSuccess: () => { setRemoving(null); notify(`已卸载 ${plugin.name || plugin.pluginId}`, { kind: 'success' }); },
    onError: reason => { setRemoving(null); notify(message(reason, '卸载失败'), { kind: 'error' }); },
  });

  return <section className="sources-card sources-list plugin-manager">
    <div className="sources-list-heading"><h2>已安装插件 <span className="source-count">{list.length}</span></h2><button className="button source-add" type="button" onClick={() => setInstalling(true)}><Icon name="upload" size={16} />安装插件</button></div>
    {plugins.isPending && <FloatingNotice message="正在加载插件列表…" busy />}
    {plugins.error && <Callout tone="error" title="读取失败" action={{ label: '重试', onClick: () => { void plugins.refetch(); } }}>{plugins.error.message}</Callout>}
    {plugins.data && !list.length && <p className="muted">还没有安装插件。插件可以接入新的书源类型。</p>}
    {list.map(plugin => {
      const state = status(plugin);
      const name = plugin.name || plugin.pluginId;
      return <article className="sources-row source-entry" key={plugin.pluginId}><div className="source-entry-top">
        <div className="source-entry-info">
          <strong>{name}{plugin.builtin && <span className="source-default-badge">内置</span>}</strong>
          <small>{[plugin.version ? `v${plugin.version}` : '未知版本', plugin.name ? plugin.pluginId : ''].filter(Boolean).join(' · ')}</small>
          {plugin.error && <small className="plugin-error">{plugin.error.message}</small>}
          <span className={'source-state' + (state.tone === 'on' ? ' is-enabled' : '') + (state.tone === 'error' ? ' is-error' : '')}>{state.label}</span>
        </div>
        {!plugin.builtin && <div className="source-entry-actions"><ActionMenu label={`${name} 的操作`} items={[
          { label: plugin.enabled ? '停用' : '启用', disabled: mutations.enablePlugin.isPending, onSelect: () => toggle(plugin) },
          { label: '卸载…', danger: true, disabled: mutations.uninstallPlugin.isPending, onSelect: () => setRemoving(plugin) },
        ]} /></div>}
      </div></article>;
    })}
    {installing && <InstallPluginSheet onClose={() => setInstalling(false)} />}
    {removing && <ConfirmSheet danger title="卸载插件？" confirmText="卸载" busy={mutations.uninstallPlugin.isPending}
      text={`卸载「${removing.name || removing.pluginId}」后，使用它的书源将无法再搜索和更新`}
      onCancel={() => setRemoving(null)} onConfirm={() => uninstall(removing)} />}
  </section>;
}

function InstallPluginSheet({ onClose }: { onClose(): void }) {
  const mutations = useSourceMutations();
  const [mode, setMode] = useState<'npm' | 'file'>('npm');
  const [packageName, setPackageName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [trusted, setTrusted] = useState(false);
  const [error, setError] = useState('');
  const busy = mutations.installPlugin.isPending || mutations.uploadPlugin.isPending;
  const ready = trusted && (mode === 'npm' ? !!packageName.trim() : !!file);
  const install = async () => {
    if (!ready) return;
    setError('');
    try {
      const plugin = mode === 'file' && file
        ? await mutations.uploadPlugin.mutateAsync(file)
        : await mutations.installPlugin.mutateAsync(packageName.trim());
      notify(`已安装 ${plugin?.name || plugin?.pluginId || '插件'}`, { kind: 'success' });
      onClose();
    } catch (reason) {
      setError(message(reason, '插件安装失败'));
    }
  };
  return <Sheet title="安装插件" busy={busy} onClose={onClose}
    footer={<>
      <Button disabled={busy} onClick={onClose}>取消</Button>
      <Button className="primary" type="submit" form="plugin-install-form" disabled={busy || !ready}>{busy ? '安装中…' : '安装并启用'}</Button>
    </>}>
    <form id="plugin-install-form" className="sheet-form plugin-install-form" onSubmit={event => { event.preventDefault(); void install(); }}>
      <Segmented label="安装方式" value={mode} onChange={value => { setMode(value); setError(''); }}
        options={[{ value: 'npm', label: 'npm 包' }, { value: 'file', label: '本地文件' }]} />
      {mode === 'npm'
        ? <label className="sheet-field">npm 包名
          <input type="text" placeholder="例如 reader-source-example" autoComplete="off" spellCheck={false} value={packageName} disabled={busy} onChange={event => setPackageName(event.currentTarget.value)} />
          <small>服务端需要能访问 npm 仓库</small>
        </label>
        : <label className="sheet-field">插件包（.tgz）
          <input type="file" accept=".tgz,application/gzip,application/x-gzip" disabled={busy} onChange={event => setFile(event.currentTarget.files?.[0] ?? null)} />
        </label>}
      <SwitchRow label="我信任这个插件" hint="插件以服务端权限运行，只安装来源可靠的插件" checked={trusted} onChange={setTrusted} />
      {error && <Callout tone="error">{error}</Callout>}
    </form>
  </Sheet>;
}
