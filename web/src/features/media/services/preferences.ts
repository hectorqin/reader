export interface MediaPreferences {density:'compact'|'comfortable';showContinue:boolean;showLibraryName:boolean;sort?:'default'|'title-asc'|'title-desc'}
export const defaultMediaPreferences:MediaPreferences={density:'compact',showContinue:true,showLibraryName:true};
const prefix='reader.media.preferences.v1:';
const key=(scope:string)=>prefix+scope;
function validated(value:unknown):MediaPreferences {
  const raw=value&&typeof value==='object'?value as Partial<MediaPreferences>:{};
  return {density:raw.density==='comfortable'?'comfortable':'compact',showContinue:typeof raw.showContinue==='boolean'?raw.showContinue:true,showLibraryName:typeof raw.showLibraryName==='boolean'?raw.showLibraryName:true,...(raw.sort==='title-asc'||raw.sort==='title-desc'?{sort:raw.sort}:{})};
}
function stored(scope:string):string|null {
  try{return localStorage.getItem(key(scope));}catch{return null;}
}
function parse(raw:string|null):MediaPreferences {
  try{return validated(JSON.parse(raw??'null'));}catch{return {...defaultMediaPreferences};}
}
export function readMediaPreferences(scope:string):MediaPreferences {
  return parse(stored(scope));
}

const listeners=new Set<()=>void>();
export function saveMediaPreferences(scope:string,value:MediaPreferences):MediaPreferences {
  const settings=validated(value);
  try{localStorage.setItem(key(scope),JSON.stringify(settings));}catch{throw new Error('设备无法保存影音偏好，请检查浏览器存储空间或隐私设置。');}
  for(const listener of listeners)listener();
  return settings;
}

/**
 * Change notifications for the media screens that apply these preferences: a save in
 * this window, or one in another tab (the `storage` event). Readers re-read on notify,
 * so nothing holds a stale copy for the session.
 */
export function subscribeMediaPreferences(listener:()=>void):()=>void {
  listeners.add(listener);
  const onStorage=(event:StorageEvent)=>{if(event.key===null||event.key.startsWith(prefix))listener();};
  if(typeof window!=='undefined')window.addEventListener('storage',onStorage);
  return ()=>{listeners.delete(listener);if(typeof window!=='undefined')window.removeEventListener('storage',onStorage);};
}

// A stable snapshot per stored string, as useSyncExternalStore requires.
const snapshots=new Map<string,{raw:string|null;value:MediaPreferences}>();
export function mediaPreferencesSnapshot(scope:string):MediaPreferences {
  const raw=stored(scope),cached=snapshots.get(scope);
  if(cached&&cached.raw===raw)return cached.value;
  const value=parse(raw);snapshots.set(scope,{raw,value});
  return value;
}
