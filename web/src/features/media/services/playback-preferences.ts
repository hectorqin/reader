export interface PlaybackPreferences {defaultRate:number;continuous:boolean}
export const playbackRates=[0.5,0.75,1,1.25,1.5,1.75,2,2.5,3];
const key=(scope:string)=>'reader.media.playback-preferences.v1:'+scope;
export function readPlaybackPreferences(scope:string):PlaybackPreferences {
  try {const value=JSON.parse(localStorage.getItem(key(scope))??'null');return {defaultRate:playbackRates.includes(value?.defaultRate)?value.defaultRate:1,continuous:typeof value?.continuous==='boolean'?value.continuous:true};}
  catch{return {defaultRate:1,continuous:true};}
}
export function savePlaybackPreferences(scope:string,value:PlaybackPreferences){
  localStorage.setItem(key(scope),JSON.stringify(value));
}
