import { useState } from 'react';
import { ConfirmSheet } from '../../../ui/sheet.tsx';
import { Icon } from '../../../ui/toolkit.tsx';
import { MediaSelect } from './select.tsx';
import { PlaybackSettings } from './playback-settings.tsx';
import { MediaThemeSettings } from './theme-settings.tsx';
import type { AppSettings } from '../../../store/settings.ts';
import type { MediaPlayer } from '../services/player.ts';
import type { MediaAccount } from '../api/media-api.ts';
import { defaultMediaPreferences, saveMediaPreferences, type MediaPreferences } from '../services/preferences.ts';

export type SettingsPanel = 'theme' | 'browse' | 'playback' | 'account';

export const SETTINGS_TITLES: Record<SettingsPanel, string> = {
  theme: '外观与主题',
  browse: '影音浏览',
  playback: '播放',
  account: '账号与连接',
};

/**
 * One settings panel of 我的 (/me/:panel). There is no media settings home any
 * more: 我的 is the list, and each row opens one of these panels.
 *
 * Only 影音浏览 holds a draft; leaving it with unsaved changes asks first.
 */
export function MediaSettings({ scope, preferences, player, account, onSaved, onBack, panel, onReaderSettings, onPlayback, backLabel = '返回我的' }: {
  scope: string;
  preferences: MediaPreferences;
  player: MediaPlayer;
  account?: MediaAccount | null;
  onSaved: (value: MediaPreferences) => void;
  onBack: () => void;
  panel: SettingsPanel;
  onReaderSettings?: (patch: Partial<AppSettings>) => void;
  onPlayback?: () => void;
  backLabel?: string;
}) {
  const [draft, setDraft] = useState({ ...preferences });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const dirty = draft.density !== preferences.density
    || draft.showContinue !== preferences.showContinue
    || draft.showLibraryName !== preferences.showLibraryName
    || (draft.sort ?? 'default') !== (preferences.sort ?? 'default');

  function back() {
    if (panel === 'browse' && dirty) { setLeaving(true); return; }
    onBack();
  }
  function save() {
    setError('');
    setSaved(false);
    try {
      onSaved(saveMediaPreferences(scope, draft));
      setSaved(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存失败');
    }
  }
  function change(patch: Partial<MediaPreferences>) {
    setDraft({ ...draft, ...patch });
    setSaved(false);
  }

  return <section className="media-settings" aria-label={SETTINGS_TITLES[panel]}>
    <div className="media-settings-heading">
      <button type="button" className="media-back-button" data-media-back aria-label={backLabel} title={backLabel} onClick={back}><Icon name="chevron-left" /></button>
      <h1>{SETTINGS_TITLES[panel]}</h1>
    </div>
    {leaving && <ConfirmSheet danger title="放弃浏览偏好修改？" text="浏览偏好尚未保存，离开后将丢弃本次修改。" confirmText="放弃修改" cancelText="继续编辑"
      onCancel={() => setLeaving(false)}
      onConfirm={() => { setLeaving(false); setDraft({ ...preferences }); onBack(); }} />}
    {panel === 'theme' && <MediaThemeSettings scope={scope} {...(onReaderSettings ? { onReaderSettings } : {})} />}
    {panel === 'browse' && <form className="media-form media-settings-panel" onSubmit={event => { event.preventDefault(); save(); }}>
      <p>仅影响影音页面，在当前设备为此服务器和账号保存</p>
      <label className="media-setting-field">封面密度
        <MediaSelect aria-label="封面密度" value={draft.density} onChange={event => change({ density: event.currentTarget.value as MediaPreferences['density'] })}>
          <option value="compact">紧凑（手机三列）</option>
          <option value="comfortable">宽松（手机两列）</option>
        </MediaSelect>
      </label>
      <label className="media-setting-field">默认排序
        <MediaSelect aria-label="默认排序" value={draft.sort ?? 'default'} onChange={event => change({ sort: event.currentTarget.value as NonNullable<MediaPreferences['sort']> })}>
          <option value="default">默认顺序</option>
          <option value="title-asc">名称升序</option>
          <option value="title-desc">名称降序</option>
        </MediaSelect>
      </label>
      <label className="media-settings-check"><span>首页显示最近续播</span><input type="checkbox" checked={draft.showContinue} onChange={event => change({ showContinue: event.currentTarget.checked })} /></label>
      <label className="media-settings-check"><span>列表工具栏显示来源库</span><input type="checkbox" checked={draft.showLibraryName} onChange={event => change({ showLibraryName: event.currentTarget.checked })} /></label>
      <div className="media-settings-footer">
        <button type="button" onClick={() => { setDraft({ ...defaultMediaPreferences }); setSaved(false); }}>恢复默认值</button>
        <button className="media-primary" type="submit">保存偏好</button>
      </div>
      {saved && <p role="status">影音偏好已保存</p>}
      {error && <p role="alert">{error}</p>}
    </form>}
    {panel === 'account' && account && <section className="media-account-panel">
      <div className="media-account-avatar" aria-hidden="true">{Array.from(account.displayName || account.username)[0]}</div>
      <h2>{account.displayName || account.username}</h2>
      <p>@{account.username} · {account.role === 'admin' ? '管理员' : '普通用户'}</p>
      <p className="media-manager-note">共享作品资料，收藏、队列和播放进度按账号隔离</p>
      <dl><dt>当前服务器</dt><dd>{account.server || window.location.origin}</dd></dl>
    </section>}
    {panel === 'playback' && <PlaybackSettings scope={scope} player={player} {...(onPlayback ? { onPlayback } : {})} />}
  </section>;
}
