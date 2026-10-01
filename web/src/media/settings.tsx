import {FloatingConfirm} from '../ui/floating-confirm.tsx';
import {MediaSelect} from './select.tsx';
import {PlaybackSettings} from './playback-settings.tsx';
import {MediaThemeSettings} from './theme-settings.tsx';
import {readMediaTheme,mediaThemes,type MediaThemeId} from './theme.ts';
import type {SettingsPanel} from './page-route.ts';
import {useState} from '../ui/vendor/preact.ts';
import {ChevronLeft,ChevronRight,Clock3,Heart,Headphones,FolderOpen,SlidersHorizontal,RefreshCw,UserRound,Blocks,Palette} from 'lucide-preact';
import type {MediaPlayer} from './player.ts';
import type {MediaApi,MediaAccount} from './api.ts';
import {MediaProviderSettings} from './provider-settings.tsx';
import {defaultMediaPreferences,saveMediaPreferences,type MediaPreferences} from './preferences.ts';

export function MediaSettings({scope,preferences,player,admin,api,account,onSaved,onBack,onPersonal,onManage,onTasks,onPlayback,panel:routePanel,onPanelChange,theme,onThemeChange}:{scope:string;preferences:MediaPreferences;player:MediaPlayer;admin:boolean;api?:MediaApi;account?:MediaAccount|null;onSaved:(value:MediaPreferences)=>void;onBack:()=>void;onPersonal:(view:'favorites'|'history'|'queue')=>void;onManage:()=>void;onTasks?:()=>void;onPlayback?:()=>void;panel?:SettingsPanel;onPanelChange?:(panel:SettingsPanel)=>void;channelLabel?:string;theme?:MediaThemeId;onThemeChange?:(theme:MediaThemeId)=>void}){
  const [localTheme,setLocalTheme]=useState(()=>readMediaTheme(scope));
  const selectedTheme=theme??localTheme;
  const [localPanel,setLocalPanel]=useState<SettingsPanel>('home');
  const panel=routePanel??localPanel;
  function setPanel(value:SettingsPanel){if(onPanelChange)onPanelChange(value);else setLocalPanel(value);}
  const [draft,setDraft]=useState({...preferences}),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  const [leaving,setLeaving]=useState(false);
  const dirty=draft.density!==preferences.density||draft.showContinue!==preferences.showContinue||draft.showLibraryName!==preferences.showLibraryName||(draft.sort??'default')!==(preferences.sort??'default');
  function back(){if(panel==='browse'&&dirty){setLeaving(true);return;}setLeaving(false);if(panel==='home')onBack();else setPanel('home');}
  function save(){setError('');setSaved(false);try{const value=saveMediaPreferences(scope,draft);onSaved(value);setSaved(true);}catch(error){setError(error instanceof Error?error.message:'保存失败');}}
  function change(patch:Partial<MediaPreferences>){setDraft({...draft,...patch});setSaved(false);}
  function openBrowse(){if(!dirty)setDraft({...preferences});setError('');setSaved(false);setPanel('browse');}
  const title=panel==='theme'?'主题外观':panel==='browse'?'浏览偏好':panel==='playback'?'播放设置':panel==='plugins'?'来源与刮削':panel==='account'?'账号':'影音设置';
  const link=(Icon:typeof Clock3,label:string,description:string,onClick:()=>void)=><button className="media-setting-row" onClick={onClick}><Icon size={19} strokeWidth={1.6} aria-hidden="true"/><span>{label}</span><small>{description}</small><ChevronRight size={16} aria-hidden="true"/></button>;
  return <section className="media-settings" aria-label="影音设置">
    <div className="media-settings-heading"><button className="media-back-button" data-media-back aria-label={panel==='home'?'← 返回影音':'返回影音设置'} title={panel==='home'?'返回影音':'返回影音设置'} onClick={back}><ChevronLeft size={20} aria-hidden="true"/></button><h1>{title}</h1></div>
    {leaving&&<FloatingConfirm theme="media" title="放弃浏览偏好修改？" text="浏览偏好尚未保存，离开后将丢弃本次修改。" confirmText="放弃修改" cancelText="继续编辑" onCancel={()=>setLeaving(false)} onConfirm={()=>{setLeaving(false);setDraft({...preferences});setPanel('home');}}/>}
    {panel==='home'?<>
      {account&&<div className="media-settings-intro"><div className="media-account-avatar" aria-hidden="true">{Array.from(account.displayName||account.username)[0]}</div><div><strong>{account.displayName||account.username}</strong><small>{account.role==='admin'?'管理员':'普通用户'} · 当前服务器</small></div></div>}
      <section className="media-settings-group"><h2>我的内容</h2>
        {link(Heart,'我的收藏','',()=>onPersonal('favorites'))}
        {link(Clock3,'播放历史','',()=>onPersonal('history'))}
      </section><section className="media-settings-group"><h2>偏好</h2>
        {link(Palette,'主题外观',selectedTheme==='system'?'跟随系统':mediaThemes.find(theme=>theme.id===selectedTheme)!.name,()=>setPanel('theme'))}
        {link(SlidersHorizontal,'浏览偏好',preferences.density==='compact'?'紧凑':'宽松',openBrowse)}
        {link(Headphones,'播放设置','倍速与连续播放',()=>setPanel('playback'))}
      </section>
      {admin&&<section className="media-settings-group"><h2>管理员</h2>{link(FolderOpen,'媒体库管理','全部影音媒体库',onManage)}{onTasks&&link(RefreshCw,'扫描与刮削','任务与匹配结果',onTasks)}{api&&link(Blocks,'来源与刮削','在线来源与本地资料',()=>setPanel('plugins'))}</section>}
      {account&&<section className="media-settings-group"><h2>账号</h2>{link(UserRound,'账号与连接','',()=>setPanel('account'))}</section>}
    </>:panel==='theme'?<MediaThemeSettings scope={scope} selected={selectedTheme} onChange={value=>{setLocalTheme(value);onThemeChange?.(value);}}/>:panel==='browse'?<form className="media-form media-settings-panel" onSubmit={event=>{event.preventDefault();save();}}>
      <p>仅影响影音页面，在当前设备为此服务器和账号保存。</p>
      <label className="media-setting-field">封面密度<MediaSelect aria-label="封面密度" value={draft.density} onChange={event=>change({density:event.currentTarget.value as MediaPreferences['density']})}><option value="compact">紧凑（手机三列）</option><option value="comfortable">宽松（手机两列）</option></MediaSelect></label>
      <label className="media-setting-field">默认排序<MediaSelect aria-label="默认排序" value={draft.sort??'default'} onChange={event=>change({sort:event.currentTarget.value as NonNullable<MediaPreferences['sort']>})}><option value="default">默认顺序</option><option value="title-asc">名称升序</option><option value="title-desc">名称降序</option></MediaSelect></label>
      <label className="media-settings-check"><span>首页显示最近续播</span><input type="checkbox" checked={draft.showContinue} onChange={event=>change({showContinue:event.currentTarget.checked})}/></label>
      <label className="media-settings-check"><span>列表工具栏显示来源库</span><input type="checkbox" checked={draft.showLibraryName} onChange={event=>change({showLibraryName:event.currentTarget.checked})}/></label>
      <div className="media-settings-footer"><button type="button" onClick={()=>{setDraft({...defaultMediaPreferences});setSaved(false);}}>恢复默认值</button><button className="media-primary" type="submit">保存偏好</button></div>
      {saved&&<p role="status">影音偏好已保存</p>}{error&&<p role="alert">{error}</p>}
    </form>:panel==='plugins'?admin&&api?<MediaProviderSettings api={api}/>:<section className="media-settings-panel" role="alert"><h2>需要管理员权限</h2><p>请返回影音设置查看可用功能。</p></section>:panel==='account'&&account?<section className="media-account-panel"><div className="media-account-avatar" aria-hidden="true">{Array.from(account.displayName||account.username)[0]}</div><h2>{account.displayName||account.username}</h2><p>@{account.username} · {account.role==='admin'?'管理员':'普通用户'}</p><p className="media-manager-note">共享作品资料，收藏、队列和播放进度按账号隔离。</p><dl><dt>当前服务器</dt><dd>{account.server||window.location.origin}</dd></dl></section>:<PlaybackSettings scope={scope} player={player} {...(onPlayback?{onPlayback}:{})}/>}
  </section>;
}
