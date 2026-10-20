import { useState } from 'react';
import {Check,Monitor} from 'lucide-react';
import {darkThemes,lightThemes,mediaThemes,readSystemThemePair,saveMediaTheme,saveSystemThemePair,type MediaThemeId,type SystemThemePair} from '../services/theme.ts';

export function MediaThemeSettings({scope,selected,onChange}:{scope:string;selected:MediaThemeId;onChange:(theme:MediaThemeId)=>void}){
  const [error,setError]=useState(''),[saved,setSaved]=useState(false),[pair,setPair]=useState<SystemThemePair>(()=>readSystemThemePair(scope));
  function choosePair(patch:Partial<SystemThemePair>){setError('');setSaved(false);try{setPair(saveSystemThemePair(scope,patch));setSaved(true);}catch(error){setError(error instanceof Error?error.message:'主题保存失败');}}
  function choose(theme:MediaThemeId){setError('');setSaved(false);try{saveMediaTheme(scope,theme);onChange(theme);setSaved(true);}catch(error){setError(error instanceof Error?error.message:'主题保存失败');}}
  return <section className="media-theme-settings">
    <button className="media-theme-system" aria-pressed={selected==='system'} onClick={()=>choose('system')}><Monitor size={21} aria-hidden="true"/><span><strong>跟随系统</strong><small>按系统深浅色自动切换</small></span>{selected==='system'&&<Check size={19} aria-hidden="true"/>}</button>
    <div className="media-theme-pair" role="group" aria-label="跟随系统时使用的主题">
      <div className="media-theme-pair-row"><span id="media-theme-pair-light">浅色时使用</span><div role="group" aria-labelledby="media-theme-pair-light">{lightThemes.map(theme=><button key={theme.id} aria-label={'浅色时使用 '+theme.name} aria-pressed={pair.light===theme.id} onClick={()=>choosePair({light:theme.id})}>{theme.name}</button>)}</div></div>
      <div className="media-theme-pair-row"><span id="media-theme-pair-dark">深色时使用</span><div role="group" aria-labelledby="media-theme-pair-dark">{darkThemes.map(theme=><button key={theme.id} aria-label={'深色时使用 '+theme.name} aria-pressed={pair.dark===theme.id} onClick={()=>choosePair({dark:theme.id})}>{theme.name}</button>)}</div></div>
    </div>
    <h2>内置主题</h2>
    <div className="media-theme-grid" role="group" aria-label="内置主题">{mediaThemes.map(theme=><button key={theme.id} className="media-theme-card" aria-label={theme.name} aria-pressed={selected===theme.id} onClick={()=>choose(theme.id)}>
      <span className="media-theme-preview" aria-hidden="true" style={{background:theme.colors[0],color:theme.colors[6]}}><span className="media-theme-preview-heading"><i style={{background:theme.colors[3]}}/><i style={{background:theme.colors[6]}}/></span><span className="media-theme-preview-covers">{[6,8,2].map(index=><i key={index} style={{background:theme.colors[index]}}/>)}</span><span className="media-theme-preview-line" style={{background:theme.colors[5]}}/></span>
      <span className="media-theme-card-label"><strong>{theme.name}</strong>{selected===theme.id&&<Check size={17} aria-hidden="true"/>}</span><small>{theme.description}</small>
    </button>)}</div>
    <p className="media-theme-note">选择后立即生效，阅读与影音共用同一套主题。在此设备按服务器和账号保存。</p>
    {saved&&<p role="status">主题已保存</p>}{error&&<p className="media-error" role="alert">{error}</p>}
  </section>;
}
