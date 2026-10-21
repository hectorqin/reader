import { useState } from 'react';
import { Check, SunMoon } from 'lucide-react';
import {
  appThemes, paperIds, readerPapers, resolveAppTheme, resolveReadingTheme, saveThemePreference, themes,
  type AppThemeId, type ReaderPaper, type ThemeId, type ThemeMode, type ThemePreference,
} from '../../../shared/theme/theme.ts';
import { useThemeState } from '../../../shared/theme/use-theme.ts';
import { useSettingsStore } from '../../../shared/stores/settings.store.ts';
import type { AppSettings } from '../../../store/settings.ts';

/** Both halves of a theme, light on the left and dark on the right, in its own colours. */
function ThemePreview({ id }: { id: ThemeId }) {
  return <span className="theme-preview" aria-hidden="true">{(['light', 'dark'] as const).map(mode => {
    const t = themes[id][mode];
    return <span key={mode} style={{ background: t.bg }}>
      <i className="theme-preview-title" style={{ background: t.ink }} />
      <span className="theme-preview-chips"><i style={{ background: t.brand }} /><i style={{ background: t.brandSoft }} /></span>
    </span>;
  })}</span>;
}

function ThemeCard({ id, label, note, pressed, onClick }: { id: ThemeId; label: string; note: string; pressed: boolean; onClick(): void }) {
  return <button type="button" className="theme-card" aria-label={label} aria-pressed={pressed} onClick={onClick}>
    <ThemePreview id={id} />
    <span className="theme-card-label"><strong>{label}</strong>{pressed && <Check size={18} aria-hidden="true" />}</span>
    <small>{note}</small>
  </button>;
}

function Chips<T extends string>({ label, options, value, onChange, labelPrefix = '' }: { label: string; options: readonly { value: T; label: string }[]; value: T; onChange(value: T): void; labelPrefix?: string }) {
  return <div className="theme-chips" role="group" aria-label={label}>{options.map(option =>
    <button type="button" key={option.value} aria-label={labelPrefix ? labelPrefix + ' ' + option.label : undefined} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}

const themeOptions = appThemes.map(theme => ({ value: theme.id as AppThemeId, label: theme.name }));
const modeOptions: readonly { value: ThemeMode; label: string }[] = [{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }];

/**
 * 外观与主题 (V3.1): the app theme (暖陶, 雾蓝, 青绿), its light/dark mode or the
 * follow-system pair, and the reading theme (跟随应用 or the reading-only 黑白灰).
 */
/**
 * The reading paper: the page's own colours, a per-device reader setting (the same
 * one as the reader's 外观 sheet), shown here so the whole look is set in one place.
 */
function ReadingPapers({ themeId, settings, onChange }: { themeId: ThemeId; settings: Pick<AppSettings, 'paper' | 'paperFollowsDark'>; onChange(patch: Partial<AppSettings>): void }) {
  const themed = themes[themeId].light;
  const options: Array<{ value: ReaderPaper; label: string; bg: string; ink: string }> = [
    { value: 'theme', label: '跟随主题', bg: themed.bg, ink: themed.ink },
    ...paperIds.map(id => ({ value: id, label: readerPapers[id].name, bg: readerPapers[id].bg, ink: readerPapers[id].ink })),
  ];
  const lightPaper = settings.paper !== 'theme' && !readerPapers[settings.paper].dark;
  return <>
    <div className="theme-papers" role="group" aria-label="阅读纸色">{options.map(option =>
      <button type="button" key={option.value} aria-label={option.label} aria-pressed={settings.paper === option.value} onClick={() => onChange({ paper: option.value })}>
        <span aria-hidden="true" style={{ background: option.bg, color: option.ink }}>Aa</span>{option.label}
      </button>)}</div>
    {lightPaper && <div className="theme-settings-card theme-paper-follow">
      <button type="button" className="theme-follow" aria-label="跟随系统深色模式" aria-pressed={settings.paperFollowsDark} onClick={() => onChange({ paperFollowsDark: !settings.paperFollowsDark })}>
        <span className="theme-follow-text"><strong>跟随系统深色模式</strong><small>应用为深色时，纸色换成主题的深色</small></span>
        <span className="theme-switch" aria-hidden="true" />
      </button>
    </div>}
  </>;
}

export function MediaThemeSettings({ scope, onReaderSettings }: { scope: string; onReaderSettings?: (patch: Partial<AppSettings>) => void }) {
  const { preference, systemDark } = useThemeState(scope);
  const paper = useSettingsStore(state => state.settings.paper);
  const paperFollowsDark = useSettingsStore(state => state.settings.paperFollowsDark);
  const [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const following = preference.mode === 'system';
  const resolved = resolveAppTheme(preference, systemDark);
  function save(patch: Partial<ThemePreference>) {
    setError(''); setSaved(false);
    try { saveThemePreference(scope, patch); setSaved(true); } catch (cause) { setError(cause instanceof Error ? cause.message : '主题保存失败'); }
  }
  // Leaving follow-system keeps what is on screen now, so the switch never makes the page jump.
  const toggleFollow = () => save(following ? { mode: resolved.mode, theme: resolved.theme } : { mode: 'system' });
  const chooseTheme = (id: AppThemeId) => save(following ? { theme: id, system: { light: id, dark: id } } : { theme: id });
  const themePressed = (id: AppThemeId) => following ? preference.system.light === id && preference.system.dark === id : preference.theme === id;
  return <section className="theme-settings">
    <div className="theme-settings-card">
      <button type="button" className="theme-follow" aria-label="跟随系统" aria-pressed={following} onClick={toggleFollow}>
        <span className="theme-follow-icon" aria-hidden="true"><SunMoon size={20} /></span>
        <span className="theme-follow-text"><strong>跟随系统</strong><small>按系统深浅色自动切换</small></span>
        <span className="theme-switch" aria-hidden="true" />
      </button>
      {following ? <>
        <div className="theme-settings-row"><span>浅色时使用</span><Chips label="浅色时使用的主题" labelPrefix="浅色时使用" options={themeOptions} value={preference.system.light} onChange={light => save({ system: { ...preference.system, light } })} /></div>
        <div className="theme-settings-row"><span>深色时使用</span><Chips label="深色时使用的主题" labelPrefix="深色时使用" options={themeOptions} value={preference.system.dark} onChange={dark => save({ system: { ...preference.system, dark } })} /></div>
      </> : <div className="theme-settings-row"><span>明暗</span><Chips label="明暗" options={modeOptions} value={resolved.mode} onChange={mode => save({ mode })} /></div>}
    </div>

    <h2>应用主题</h2>
    <div className="theme-grid" role="group" aria-label="应用主题">
      {appThemes.map(theme => <ThemeCard key={theme.id} id={theme.id} label={theme.name} note="浅色 · 深色" pressed={themePressed(theme.id)} onClick={() => chooseTheme(theme.id)} />)}
    </div>

    <h2>阅读主题</h2>
    <div className="theme-grid" role="group" aria-label="阅读主题">
      <ThemeCard id={resolved.theme} label="跟随应用" note={'与应用一致 · ' + themes[resolved.theme].name} pressed={preference.reading === 'app'} onClick={() => save({ reading: 'app' })} />
      <ThemeCard id="gray" label={themes.gray.name} note="阅读专用 · 浅色 · 深色" pressed={preference.reading === 'gray'} onClick={() => save({ reading: 'gray' })} />
    </div>
    <p className="theme-settings-note">黑白灰只用于阅读器，可以与应用主题分开设置；浅色和夜间跟随应用的明暗。主题偏好按服务器和账号保存在此设备。</p>

    {onReaderSettings && <>
      <h2>阅读纸色</h2>
      <ReadingPapers themeId={resolveReadingTheme(preference, systemDark).theme} settings={{ paper, paperFollowsDark }} onChange={patch => { onReaderSettings(patch); setSaved(true); setError(''); }} />
      <p className="theme-settings-note">纸色只改阅读页的底色和文字，工具栏仍用阅读主题；也可在阅读页的“外观”里切换。纸色按设备保存。</p>
    </>}
    {saved && <p role="status">主题已保存</p>}{error && <p className="media-error" role="alert">{error}</p>}
  </section>;
}
