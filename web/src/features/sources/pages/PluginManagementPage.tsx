import { useState } from 'react';
import { Package } from 'lucide-react';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { usePlugins, useSourceMutations } from '../hooks/sourceQueries.ts';
import type { SourcePlugin } from '../../../api/sources.ts';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';
import { ActionMenu } from '../../../ui/action-menu.tsx';
import { ConfirmSheet, Sheet } from '../../../ui/sheet.tsx';
import { Button, Callout, Icon, Segmented, SwitchRow } from '../../../ui/toolkit.tsx';
import { notify } from '../../../ui/notifications.ts';
import { SourcesHeader } from '../components/SourcesHeader.tsx';
import '../styles/plugins.css';

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function status(plugin: SourcePlugin): { label: string; tone: 'on' | 'off' | 'error' | 'builtin' } {
  if (plugin.error) return { label: '加载失败', tone: 'error' };
  if (plugin.builtin) return { label: '内置', tone: 'builtin' };
  return plugin.enabled ? { label: '已启用', tone: 'on' } : { label: '已停用', tone: 'off' };
}

/** 插件管理: the installed source plugins, and a sheet to install another. */
export function PluginManagementPage() {
  const admin = useAuthStore(state => state.verifiedUser?.role === 'admin');
  const plugins = usePlugins(admin);
  const mutations = useSourceMutations();
  const [installing, setInstalling] = useState(false);
  const [removing, setRemoving] = useState<SourcePlugin | null>(null);
  if (!admin) return <div className="sources-screen plugin-management-screen">
    <SourcesHeader title="插件管理" />
    <main className="sources-body plugin-body"><Callout tone="warning">只有管理员可以管理插件</Callout></main>
  </div>;

  const list = plugins.data ?? [];
  const toggle = (plugin: SourcePlugin) => mutations.enablePlugin.mutate({ id: plugin.pluginId, enabled: !plugin.enabled }, {
    onError: reason => notify(message(reason, plugin.enabled ? '停用失败' : '启用失败'), { kind: 'error' }),
  });
  const uninstall = (plugin: SourcePlugin) => mutations.uninstallPlugin.mutate(plugin.pluginId, {
    onSuccess: () => { setRemoving(null); notify(`已卸载 ${plugin.name || plugin.pluginId}`, { kind: 'success' }); },
    onError: reason => { setRemoving(null); notify(message(reason, '卸载失败'), { kind: 'error' }); },
  });

  return <div className="sources-screen plugin-management-screen">
    <SourcesHeader title="插件管理" {...(plugins.data ? { subtitle: `${list.length} 个插件` } : {})}
      actions={<Button className="primary plugin-install-open" onClick={() => setInstalling(true)}><Icon name="upload" /><span>安装插件</span></Button>} />
    <main className="sources-body plugin-body">
      {plugins.isPending && <FloatingNotice message="正在读取插件列表…" busy />}
      {plugins.error && <Callout tone="error" title="读取失败" action={{ label: '重试', onClick: () => { void plugins.refetch(); } }}>{plugins.error.message}</Callout>}
      {plugins.data && !list.length && <section className="plugin-empty">
        <span className="plugin-empty-icon" aria-hidden="true"><Package size={28} /></span>
        <strong>还没有安装插件</strong>
        <p>插件可以接入新的书源类型</p>
        <Button className="primary" onClick={() => setInstalling(true)}>安装插件</Button>
      </section>}
      {list.length > 0 && <ul className="plugin-list" aria-label="已安装插件">
        {list.map(plugin => {
          const state = status(plugin);
          const name = plugin.name || plugin.pluginId;
          return <li className="plugin-row" key={plugin.pluginId} data-disabled={!plugin.enabled || undefined}>
            <span className="plugin-row-icon" aria-hidden="true"><Package size={20} /></span>
            <div className="plugin-row-text">
              <div className="plugin-row-title"><strong>{name}</strong><span className="plugin-tag" data-tone={state.tone}>{state.label}</span></div>
              <small>{[plugin.version ? `v${plugin.version}` : '未知版本', plugin.name ? plugin.pluginId : ''].filter(Boolean).join(' · ')}</small>
              {plugin.error && <small className="plugin-row-error">{plugin.error.message}</small>}
            </div>
            {!plugin.builtin && <ActionMenu className="plugin-row-more" label={`${name} 的操作`} items={[
              { label: plugin.enabled ? '停用' : '启用', disabled: mutations.enablePlugin.isPending, onSelect: () => toggle(plugin) },
              { label: '卸载…', danger: true, disabled: mutations.uninstallPlugin.isPending, onSelect: () => setRemoving(plugin) },
            ]} />}
          </li>;
        })}
      </ul>}
    </main>
    {installing && <InstallPluginSheet onClose={() => setInstalling(false)} />}
    {removing && <ConfirmSheet danger title="卸载插件？" confirmText="卸载" busy={mutations.uninstallPlugin.isPending}
      text={`卸载「${removing.name || removing.pluginId}」后，使用它的书源将无法再搜索和更新`}
      onCancel={() => setRemoving(null)} onConfirm={() => uninstall(removing)} />}
  </div>;
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
