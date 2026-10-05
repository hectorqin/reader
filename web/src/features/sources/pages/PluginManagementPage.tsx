import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Package, Upload, X } from 'lucide-react';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { usePlugins, useSourceMutations } from '../hooks/sourceQueries.ts';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';

export function PluginManagementPage() {
  const admin = useAuthStore(state => state.verifiedUser?.role === 'admin');
  const plugins = usePlugins(admin);
  const mutations = useSourceMutations();
  const [packageName, setPackageName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [trusted, setTrusted] = useState(false);
  const [error, setError] = useState('');
  const busy = mutations.installPlugin.isPending || mutations.uploadPlugin.isPending;
  if (!admin) return <div className="sources-screen plugin-management-screen"><FloatingNotice message="只有管理员可以管理插件。" error /></div>;
  const install = async () => {
    setError('');
    if (!trusted) { setError('请确认插件来源可信。'); return; }
    try {
      if (file) await mutations.uploadPlugin.mutateAsync(file);
      else if (packageName.trim()) await mutations.installPlugin.mutateAsync(packageName.trim());
      else { setError('请输入 npm 包名或选择插件包。'); return; }
      setPackageName(''); setFile(null); setTrusted(false); if (fileInput.current) fileInput.current.value = '';
    } catch (reason) { setError(reason instanceof Error ? reason.message : '插件安装失败'); }
  };
  return <div className="sources-screen plugin-management-screen">
    <header className="sources-header"><Link className="icon-button" to="/sources" aria-label="返回" title="返回"><ArrowLeft size={20} /></Link><h1>插件管理</h1><span /></header>
    <main className="sources-body plugin-management-body">
      {plugins.isPending && <FloatingNotice message="正在加载插件列表…" busy />}
      {error && <div className="notice error" role="alert">{error}</div>}
      <section className="sources-card plugin-install-card">
        <div className="plugin-card-heading"><Package size={20} aria-hidden="true" /><div><h2>安装插件</h2><p className="muted">从 npm 包名或本地压缩包安装来源插件。</p></div></div>
        <p className="notice">插件以服务端权限运行。安装前请确认来源可信；npm 安装需要服务端能够访问 npm 仓库。</p>
        <form className="plugin-install-form" onSubmit={event => { event.preventDefault(); void install(); }}>
          <div className="plugin-install-grid">
            <label>npm 包名<input type="text" placeholder="例如 reader-source-example" value={packageName} onChange={event => setPackageName(event.currentTarget.value)} disabled={busy || Boolean(file)} /></label>
            <label>上传插件包<input ref={fileInput} type="file" accept=".tgz,application/gzip,application/x-gzip" onChange={event => setFile(event.currentTarget.files?.[0] ?? null)} disabled={busy || Boolean(packageName.trim())} /></label>
          </div>
          <label className="plugin-trust"><input type="checkbox" checked={trusted} onChange={event => setTrusted(event.currentTarget.checked)} />我信任这个插件的代码</label>
          <button className="button primary plugin-install-submit" type="submit" disabled={busy || !trusted || (!packageName.trim() && !file)}><Upload size={16} aria-hidden="true" />{busy ? '安装中…' : '安装并启用'}</button>
        </form>
      </section>
      {plugins.error && <div className="notice error" role="alert">{plugins.error.message}</div>}
      <section className="sources-card plugin-list-card"><div className="plugin-list-heading"><h2>已安装插件</h2><span className="source-count">{plugins.data?.length ?? 0}</span></div>
        {!plugins.isPending && !plugins.data?.length && <p className="muted">暂无已安装插件。</p>}
        <div className="plugin-list">{(plugins.data ?? []).map(plugin => <article className="sources-row plugin-row" key={plugin.pluginId}><div className="plugin-row-info"><strong>{plugin.name || plugin.pluginId}</strong><small>{plugin.version || '未知版本'} · {plugin.builtin ? '内置' : plugin.enabled ? '已启用' : '已停用'}</small>{plugin.error && <small className="plugin-error">{plugin.error.message}</small>}</div>{!plugin.builtin && <div className="sources-actions plugin-row-actions"><button className="button" type="button" disabled={mutations.enablePlugin.isPending} onClick={() => mutations.enablePlugin.mutate({ id: plugin.pluginId, enabled: !plugin.enabled })}>{plugin.enabled ? <><X size={15} />停用</> : <><Check size={15} />启用</>}</button><button className="button danger" type="button" disabled={mutations.uninstallPlugin.isPending} onClick={() => mutations.uninstallPlugin.mutate(plugin.pluginId)}>卸载</button></div>}</article>)}</div>
      </section>
    </main>
  </div>;
}
