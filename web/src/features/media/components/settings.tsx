import { useState } from 'react';
import { MediaSelect } from './select.tsx';
import type { MediaAccount } from '../api/media-api.ts';
import { readMediaPreferences, saveMediaPreferences, type MediaPreferences } from '../services/preferences.ts';

/**
 * 影音浏览: the media screens' per-device browsing preferences, the 影音浏览 section
 * of 我的 › 偏好设置. Like every other section there, a change applies at once;
 * a storage failure is reported and the control returns to what is stored.
 */
export function MediaBrowseSettings({ scope }: { scope: string }) {
  const [value, setValue] = useState(() => readMediaPreferences(scope));
  const [error, setError] = useState('');
  function change(patch: Partial<MediaPreferences>) {
    try {
      setValue(saveMediaPreferences(scope, { ...value, ...patch }));
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存失败');
    }
  }
  return <div className="media-settings-panel">
    <label className="media-setting-field">封面密度
      <MediaSelect aria-label="封面密度" value={value.density} onChange={event => change({ density: event.currentTarget.value as MediaPreferences['density'] })}>
        <option value="compact">紧凑（手机三列）</option>
        <option value="comfortable">宽松（手机两列）</option>
      </MediaSelect>
    </label>
    <label className="media-setting-field">默认排序
      <MediaSelect aria-label="默认排序" value={value.sort ?? 'default'} onChange={event => change({ sort: event.currentTarget.value as NonNullable<MediaPreferences['sort']> })}>
        <option value="default">默认顺序</option>
        <option value="title-asc">名称升序</option>
        <option value="title-desc">名称降序</option>
      </MediaSelect>
    </label>
    <label className="media-settings-check"><span>首页显示最近续播</span><input type="checkbox" role="switch" checked={value.showContinue} onChange={event => change({ showContinue: event.currentTarget.checked })} /></label>
    <label className="media-settings-check"><span>列表工具栏显示来源库</span><input type="checkbox" role="switch" checked={value.showLibraryName} onChange={event => change({ showLibraryName: event.currentTarget.checked })} /></label>
    {error && <p role="alert">{error}</p>}
  </div>;
}

/** 账号与连接: who is signed in and to which server. Never shows tokens. */
export function MediaAccountPanel({ account }: { account: MediaAccount }) {
  return <section className="media-account-panel">
    <div className="media-account-avatar" aria-hidden="true">{Array.from(account.displayName || account.username)[0]}</div>
    <h2>{account.displayName || account.username}</h2>
    <p>@{account.username} · {account.role === 'admin' ? '管理员' : '普通用户'}</p>
    <p className="media-manager-note">共享作品资料，收藏、队列和播放进度按账号隔离</p>
    <dl><dt>当前服务器</dt><dd>{account.server || window.location.origin}</dd></dl>
  </section>;
}
