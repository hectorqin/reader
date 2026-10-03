import { useState } from 'react';
import {Check,Monitor} from 'lucide-react';
import {mediaThemes,saveMediaTheme,type MediaThemeId} from './theme.ts';

export function MediaThemeSettings({scope,selected,onChange}:{scope:string;selected:MediaThemeId;onChange:(theme:MediaThemeId)=>void}){
  const [error,setError]=useState(''),[saved,setSaved]=useState(false);
  function choose(theme:MediaThemeId){setError('');setSaved(false);try{saveMediaTheme(scope,theme);onChange(theme);setSaved(true);}catch(error){setError(error instanceof Error?error.message:'主题保存失败');}}
  return <section className="media-theme-settings">
    <button className="media-theme-system" aria-pressed={selected==='system'} onClick={()=>choose('system')}><Monitor size={21} aria-hidden="true"/><span><strong>跟随系统</strong><small>随设备自动切换浅色与深色</small></span>{selected==='system'&&<Check size={19} aria-hidden="true"/>}</button>
    <h2>内置主题</h2>
    <div className="media-theme-grid" role="group" aria-label="内置主题">{mediaThemes.map(theme=><button key={theme.id} className="media-theme-card" aria-label={theme.name} aria-pressed={selected===theme.id} onClick={()=>choose(theme.id)}>
      <span className="media-theme-preview" aria-hidden="true" style={{background:theme.colors[0],color:theme.colors[6]}}><span className="media-theme-preview-heading"><i style={{background:theme.colors[3]}}/><i style={{background:theme.colors[6]}}/></span><span className="media-theme-preview-covers">{[6,8,2].map(index=><i key={index} style={{background:theme.colors[index]}}/>)}</span><span className="media-theme-preview-line" style={{background:theme.colors[5]}}/></span>
      <span className="media-theme-card-label"><strong>{theme.name}</strong>{selected===theme.id&&<Check size={17} aria-hidden="true"/>}</span><small>{theme.description}</small>
    </button>)}</div>
    <p className="media-theme-note">选择后立即生效，仅应用于影音。在此设备按服务器和账号保存。</p>
    {saved&&<p role="status">主题已保存</p>}{error&&<p className="media-error" role="alert">{error}</p>}
  </section>;
}
