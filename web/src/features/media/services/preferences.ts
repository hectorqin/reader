export interface MediaPreferences {density:'compact'|'comfortable';showContinue:boolean;showLibraryName:boolean;sort?:'default'|'title-asc'|'title-desc'}
export const defaultMediaPreferences:MediaPreferences={density:'compact',showContinue:true,showLibraryName:true};
const key=(scope:string)=>'reader.media.preferences.v1:'+scope;
function validated(value:unknown):MediaPreferences {
  const raw=value&&typeof value==='object'?value as Partial<MediaPreferences>:{};
  return {density:raw.density==='comfortable'?'comfortable':'compact',showContinue:typeof raw.showContinue==='boolean'?raw.showContinue:true,showLibraryName:typeof raw.showLibraryName==='boolean'?raw.showLibraryName:true,...(raw.sort==='title-asc'||raw.sort==='title-desc'?{sort:raw.sort}:{})};
}
export function readMediaPreferences(scope:string):MediaPreferences {
  try{return validated(JSON.parse(localStorage.getItem(key(scope))??'null'));}catch{return {...defaultMediaPreferences};}
}
export function saveMediaPreferences(scope:string,value:MediaPreferences):MediaPreferences {
  const settings=validated(value);
  try{localStorage.setItem(key(scope),JSON.stringify(settings));}catch{throw new Error('设备无法保存影音偏好，请检查浏览器存储空间或隐私设置。');}
  return settings;
}
