export const mediaThemes = [
  {id:'sand',name:'暖纸',description:'暖中性底色 · 深林绿',dark:false,colors:['#f6f4ef','#ffffff','#ece9e1','#1b1a17','#66625a','#e4e0d6','#1f5a4a','#ffffff','#dcebe4']},
  {id:'ocean',name:'雾蓝',description:'清透灰白 · 湖水蓝',dark:false,colors:['#f1f5f9','#ffffff','#e4ebf2','#16212b','#566573','#dde5ec','#2a5f86','#ffffff','#d9e7f2']},
  {id:'rose',name:'蔷薇',description:'轻盈粉白 · 梅子红',dark:false,colors:['#faf3f4','#ffffff','#f1e6e9','#2a1b20','#7a5f67','#ebdade','#8a3a57','#ffffff','#f3dce4']},
  {id:'forest',name:'原野',description:'柔和浅绿 · 草木绿',dark:false,colors:['#f3f6ef','#ffffff','#e6ede0','#1d2a1f','#5a6859','#dce5d6','#3f6b34','#ffffff','#e1edd9']},
  {id:'midnight',name:'深夜',description:'暖黑底色 · 薄荷绿',dark:true,colors:['#14130f','#1e1c18','#2a2823','#f1eee6','#a29d90','#34312b','#6fc4a8','#0e1f18','#1f3a31']},
  {id:'graphite',name:'石墨',description:'冷灰深色 · 天蓝',dark:true,colors:['#0f1216','#181c22','#222831','#e8ecf1','#98a2b0','#2c333d','#86aef5','#0b1a33','#1d2b45']},
] as const;
export type MediaThemeId = 'system' | typeof mediaThemes[number]['id'];
const tokens=['background','paper','surface','text','muted','border','accent','on-accent','selection'] as const;
const storageKey=(scope:string)=>'reader.media.theme.v1:'+scope;
const themeChangeEvent='reader-media-theme-change';
export const mediaThemeChangeEvent=themeChangeEvent;
export function validMediaTheme(value:unknown):MediaThemeId{return value==='system'||mediaThemes.some(theme=>theme.id===value)?value as MediaThemeId:'system';}
export function readMediaTheme(scope:string):MediaThemeId{try{return validMediaTheme(localStorage.getItem(storageKey(scope)));}catch{return 'system';}}
export function saveMediaTheme(scope:string,value:MediaThemeId){
  const next=validMediaTheme(value);
  try{localStorage.setItem(storageKey(scope),next);}catch{throw new Error('设备无法保存主题，请检查浏览器存储空间或隐私设置。');}
  // Storage events do not fire in the tab that made the change. Notify the
  // active media shell explicitly so a theme choice is applied immediately.
  if(typeof window!=='undefined') window.dispatchEvent(new CustomEvent(themeChangeEvent,{detail:{scope,value:next}}));
}
/** "跟随系统" means one light theme for a light device and one dark theme for a dark device. */
export type SystemThemePair={light:LightThemeId;dark:DarkThemeId};
export type LightThemeId=Extract<typeof mediaThemes[number],{dark:false}>['id'];
export type DarkThemeId=Extract<typeof mediaThemes[number],{dark:true}>['id'];
export const lightThemes=mediaThemes.filter(theme=>!theme.dark);
export const darkThemes=mediaThemes.filter(theme=>theme.dark);
export const defaultSystemThemePair:SystemThemePair={light:'sand',dark:'midnight'};
const systemPairKey=(scope:string)=>'reader.media.theme.system.v1:'+scope;
export function validSystemThemePair(value:unknown):SystemThemePair{
  const pair=(value&&typeof value==='object'?value:{}) as {light?:unknown;dark?:unknown};
  const light=lightThemes.find(theme=>theme.id===pair.light)?.id??defaultSystemThemePair.light;
  const dark=darkThemes.find(theme=>theme.id===pair.dark)?.id??defaultSystemThemePair.dark;
  return {light,dark} as SystemThemePair;
}
export function readSystemThemePair(scope:string):SystemThemePair{
  try{const raw=localStorage.getItem(systemPairKey(scope));return validSystemThemePair(raw?JSON.parse(raw):undefined);}catch{return {...defaultSystemThemePair};}
}
export function saveSystemThemePair(scope:string,value:Partial<SystemThemePair>){
  const next=validSystemThemePair({...readSystemThemePair(scope),...value});
  try{localStorage.setItem(systemPairKey(scope),JSON.stringify(next));}catch{throw new Error('设备无法保存主题，请检查浏览器存储空间或隐私设置。');}
  // Same notification as a theme choice, so every listener re-reads and re-applies.
  if(typeof window!=='undefined') window.dispatchEvent(new CustomEvent(themeChangeEvent,{detail:{scope,value:readMediaTheme(scope)}}));
  return next;
}
export function mediaThemePalette(id:MediaThemeId,dark=false,pair:SystemThemePair=defaultSystemThemePair){return mediaThemes.find(theme=>theme.id===(id==='system'?(dark?pair.dark:pair.light):id))!;}

/** Only prefixed media variables are placed on the body; reading tokens remain untouched. */
// [ink, soft background] per channel. Ink is used as text on its own soft background, so
// every pair is held to 4.5:1 by test/media-theme-contrast.test.ts.
const lightChannels={read:['#935825','#f3e6d8'],video:['#4b4fd6','#e4e5fa'],music:['#b23656','#f6e0e6'],audio:['#0c7272','#d9eeee']} as const;
const darkChannels={read:['#e0a36a','#33291f'],video:['#9a9dff','#25264a'],music:['#f28ba6','#3c2229'],audio:['#5fd0cb','#17363a']} as const;
export const channelColors={light:lightChannels,dark:darkChannels};

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
  private onStorage=(event:StorageEvent)=>{if(event.key===null||event.key===storageKey(this.scope)||event.key===systemPairKey(this.scope))this.set(readMediaTheme(this.scope));};
  private onThemeChange=(event:Event)=>{
    const detail=(event as CustomEvent<{scope?:unknown;value?:unknown}>).detail;
    if(detail?.scope===this.scope)this.set(validMediaTheme(detail.value));
  };
  private apply(){
    const theme=mediaThemePalette(this.current,this.system?.matches,readSystemThemePair(this.scope));
    document.body.dataset.mediaTheme=this.current;
    tokens.forEach((token,index)=>document.body.style.setProperty('--media-theme-'+token,theme.colors[index]!));
    document.body.style.setProperty('--media-theme-scheme',theme.dark?'dark':'light');
    document.body.style.setProperty('--media-theme-error-ink',theme.dark?'#f4a89d':'#943c32');
    document.body.style.setProperty('--media-theme-error-background',theme.dark?'#f49a8c18':'#a4504515');
    // Channel colours: each content type keeps one hue everywhere (icons, progress, labels).
    const channel=theme.dark?darkChannels:lightChannels;
    for(const [name,[ink,soft]] of Object.entries(channel)){document.body.style.setProperty('--media-theme-ch-'+name,ink);document.body.style.setProperty('--media-theme-ch-'+name+'-soft',soft);}
    document.body.style.setProperty('--media-theme-on-ch',theme.dark?'#0b1a33':'#ffffff');
  }
  dispose(){
    this.system?.removeEventListener('change',this.onSystem);window.removeEventListener('storage',this.onStorage);window.removeEventListener(themeChangeEvent,this.onThemeChange);
    delete document.body.dataset.mediaTheme;
    tokens.forEach(token=>document.body.style.removeProperty('--media-theme-'+token));
    for(const token of ['scheme','error-ink','error-background'])document.body.style.removeProperty('--media-theme-'+token);
    for(const name of Object.keys(lightChannels)){document.body.style.removeProperty('--media-theme-ch-'+name);document.body.style.removeProperty('--media-theme-ch-'+name+'-soft');}
    document.body.style.removeProperty('--media-theme-on-ch');
  }
}
