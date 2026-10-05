export const mediaThemes = [
  {id:'forest',name:'原野',description:'柔和米白 · 橄榄绿',dark:false,colors:['#f8f9f5','#ffffff','#edf0e8','#202b24','#66715f','#dfe5d9','#466638','#ffffff','#e6eddf']},
  {id:'sand',name:'暖砂',description:'暖纸底色 · 赤陶棕',dark:false,colors:['#fbf7ee','#fffdf8','#f0e8dc','#382b21','#796751','#e3d6c4','#865333','#ffffff','#efe0cf']},
  {id:'ocean',name:'雾蓝',description:'清透灰白 · 湖水蓝',dark:false,colors:['#f3f7fa','#ffffff','#e6eff4','#20343d','#5c7380','#d4e1e8','#2b637c','#ffffff','#dbeaf2']},
  {id:'rose',name:'蔷薇',description:'轻盈粉白 · 梅子红',dark:false,colors:['#faf5f7','#ffffff','#f1e5eb','#3b2c34','#7d6470','#e4d5dc','#894d6a','#ffffff','#efdeea']},
  {id:'midnight',name:'深海',description:'静谧深绿 · 苔绿',dark:true,colors:['#141b19','#1d2722','#25312a','#eef2e9','#a3b49f','#354439','#b6ce9d','#23311d','#30402b']},
  {id:'graphite',name:'石墨',description:'纯粹深灰 · 银白',dark:true,colors:['#191c20','#23272c','#2e333a','#f1f3f5','#b0b7c1','#40464f','#c2cedc','#1f2832','#343f4c']},
] as const;
export type MediaThemeId = 'system' | typeof mediaThemes[number]['id'];
const tokens=['background','paper','surface','text','muted','border','accent','on-accent','selection'] as const;
const storageKey=(scope:string)=>'reader.media.theme.v1:'+scope;
const themeChangeEvent='reader-media-theme-change';
export function validMediaTheme(value:unknown):MediaThemeId{return value==='system'||mediaThemes.some(theme=>theme.id===value)?value as MediaThemeId:'system';}
export function readMediaTheme(scope:string):MediaThemeId{try{return validMediaTheme(localStorage.getItem(storageKey(scope)));}catch{return 'system';}}
export function saveMediaTheme(scope:string,value:MediaThemeId){
  const next=validMediaTheme(value);
  try{localStorage.setItem(storageKey(scope),next);}catch{throw new Error('设备无法保存主题，请检查浏览器存储空间或隐私设置。');}
  // Storage events do not fire in the tab that made the change. Notify the
  // active media shell explicitly so a theme choice is applied immediately.
  if(typeof window!=='undefined') window.dispatchEvent(new CustomEvent(themeChangeEvent,{detail:{scope,value:next}}));
}
export function mediaThemePalette(id:MediaThemeId,dark=false){return mediaThemes.find(theme=>theme.id===(id==='system'?(dark?'graphite':'forest'):id))!;}

/** Only prefixed media variables are placed on the body; reading tokens remain untouched. */
export class MediaThemeController {
  current:MediaThemeId;
  private readonly system=typeof window.matchMedia==='function'?window.matchMedia('(prefers-color-scheme: dark)'):undefined;
  constructor(private readonly scope:string,private readonly onChanged:()=>void){
    this.current=readMediaTheme(scope);this.apply();
    this.system?.addEventListener('change',this.onSystem);
    window.addEventListener('storage',this.onStorage);
    window.addEventListener(themeChangeEvent,this.onThemeChange);
  }
  set(value:MediaThemeId){this.current=validMediaTheme(value);this.apply();this.onChanged();}
  private onSystem=()=>{if(this.current==='system'){this.apply();this.onChanged();}};
  private onStorage=(event:StorageEvent)=>{if(event.key===null||event.key===storageKey(this.scope))this.set(readMediaTheme(this.scope));};
  private onThemeChange=(event:Event)=>{
    const detail=(event as CustomEvent<{scope?:unknown;value?:unknown}>).detail;
    if(detail?.scope===this.scope)this.set(validMediaTheme(detail.value));
  };
  private apply(){
    const theme=mediaThemePalette(this.current,this.system?.matches);
    document.body.dataset.mediaTheme=this.current;
    tokens.forEach((token,index)=>document.body.style.setProperty('--media-theme-'+token,theme.colors[index]!));
    document.body.style.setProperty('--media-theme-scheme',theme.dark?'dark':'light');
    document.body.style.setProperty('--media-theme-error-ink',theme.dark?'#f4a89d':'#943c32');
    document.body.style.setProperty('--media-theme-error-background',theme.dark?'#f49a8c18':'#a4504515');
  }
  dispose(){
    this.system?.removeEventListener('change',this.onSystem);window.removeEventListener('storage',this.onStorage);window.removeEventListener(themeChangeEvent,this.onThemeChange);
    delete document.body.dataset.mediaTheme;
    tokens.forEach(token=>document.body.style.removeProperty('--media-theme-'+token));
    for(const token of ['scheme','error-ink','error-background'])document.body.style.removeProperty('--media-theme-'+token);
  }
}
