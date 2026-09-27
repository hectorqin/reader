export const mediaPages = ['settings', 'settings/browse', 'settings/theme', 'settings/playback', 'settings/plugins', 'settings/account', 'settings/libraries', 'settings/tasks', 'favorites', 'history', 'queue', 'movies', 'series', 'albums', 'artists', 'tracks', 'books', 'narrators', 'movie', 'show', 'season', 'episode', 'album', 'artist', 'track', 'book', 'metadata', 'match', 'chapters', 'search', 'folders', 'file', 'narrator', 'narrator-work', 'library-new', 'library-edit', 'library-permissions', 'player', 'player/lyrics', 'player/queue', 'player/chapters'] as const;
export type MediaPage = typeof mediaPages[number];
export type MediaRoute = {name:'media';channel:'video'|'music'|'audiobook';itemId:string;page?:MediaPage;fromSettings?:boolean;params?:Record<string,string>;returnTo?:string};
export const categoryKinds:Partial<Record<MediaPage,string>>={movies:'movie',series:'series',albums:'album',artists:'artist',tracks:'track',books:'audiobook',narrators:'narrator'};
export const detailPages:Record<string,MediaPage>={movie:'movie',series:'show',season:'season',episode:'episode',album:'album',artist:'artist',track:'track',audiobook:'book'};
export const detailKinds:Partial<Record<MediaPage,string>>=Object.fromEntries(Object.entries(detailPages).map(([kind,page])=>[page,kind]));
export const isPlayerPage=(page?:MediaPage)=>!!page&&(page==='player'||page.startsWith('player/'));
export const isItemPage=(page?:MediaPage)=>!!page&&(!!detailKinds[page]||['metadata','match','chapters'].includes(page));
const paramKeys=['library','path','asset','offset','sort','artist','album','q','scope','kind','edition','narrator','work','job','part'];
export function readMediaParams(query:URLSearchParams){const params:Record<string,string>={};for(const key of paramKeys){const value=query.get(key);if(value)params[key]=value;}return params;}
export function mediaPath(route:MediaRoute){
  const page=route.page,enc=encodeURIComponent,p=route.params??{};
  if(isPlayerPage(page)&&route.itemId&&p.part)return 'player/'+enc(route.itemId)+'/'+enc(p.part)+(page==='player'?'':'/'+page!.slice(7));
  if(page&&detailKinds[page])return page+'/'+enc(route.itemId);
  if(page&&['metadata','match','chapters'].includes(page))return 'items/'+enc(route.itemId)+'/'+page;
  if(page==='library-new')return 'settings/libraries/new';
  if(page==='library-edit'||page==='library-permissions')return 'settings/libraries/'+enc(p.library??'')+'/'+(page==='library-edit'?'edit':'permissions');
  if(page==='file')return 'files/'+enc(p.asset??'');
  if(page==='narrator'||page==='narrator-work')return 'narrators/'+enc(p.narrator??'')+(page==='narrator-work'?'/works/'+enc(p.work??''):'');
  return page??(route.itemId?enc(route.itemId):'');
}
export function parseMediaPath(parts:string[]):{page?:MediaPage;itemId:string;params?:Record<string,string>} {
  const decode=(v:string)=>{try{return decodeURIComponent(v);}catch{return v;}};
  const path=parts.join('/'),first=parts[0]??'';
  if(first==='player'&&(parts.length===3||parts.length===4&&['lyrics','queue','chapters'].includes(parts[3]!)))return {page:parts[3]?('player/'+parts[3]) as MediaPage:'player',itemId:decode(parts[1]!),params:{part:decode(parts[2]!)}};
  if(isMediaPage(first)&&detailKinds[first]&&parts.length===2)return {page:first,itemId:decode(parts[1]!)};
  if(first==='items'&&parts.length===3&&['metadata','match','chapters'].includes(parts[2]!))return {page:parts[2] as MediaPage,itemId:decode(parts[1]!)};
  if(path==='settings/libraries/new')return {page:'library-new',itemId:''};
  if(parts[0]==='settings'&&parts[1]==='libraries'&&parts.length===4&&['edit','permissions'].includes(parts[3]!))return {page:parts[3]==='edit'?'library-edit':'library-permissions',itemId:'',params:{library:decode(parts[2]!)}};
  if(first==='files'&&parts.length===2)return {page:'file',itemId:'',params:{asset:decode(parts[1]!)}};
  if(first==='narrators'&&(parts.length===2||parts.length===4&&parts[2]==='works'))return {page:parts.length===2?'narrator':'narrator-work',itemId:'',params:{narrator:decode(parts[1]!),...(parts[3]?{work:decode(parts[3])}:{})}};
  if(isMediaPage(path)&&!detailKinds[path])return {page:path,itemId:''};
  return {itemId:decode(first)};
}
export function safeMediaReturn(value:string|null|undefined){return value&&value.length<=8000&&/^#\/media\/(video|music|audiobook|search|favorites)(?:[/?]|$)/.test(value)?value:undefined;}
export type SettingsPanel = 'home' | 'theme' | 'browse' | 'playback' | 'plugins' | 'account';
export function isMediaPage(value:string):value is MediaPage {return (mediaPages as readonly string[]).includes(value);}
export function settingsPanel(page?:MediaPage):SettingsPanel|null {
  if(page==='settings')return 'home';
  const panel=page?.split('/')[1];
  return panel==='theme'||panel==='browse'||panel==='playback'||panel==='plugins'||panel==='account'?panel:null;
}
export function mediaParentPage(page?:MediaPage,fromSettings=false):MediaPage|undefined {
  if(page==='library-edit'||page==='library-new'||page==='library-permissions')return 'settings/libraries';
  if(page==='narrator-work')return 'narrator';
  if(page==='narrator')return 'narrators';
  if(page==='file')return 'folders';
  if(page?.startsWith('player/'))return 'player';
  if(page&&detailKinds[page])return ({movie:'movies',show:'series',season:'series',episode:'series',album:'albums',artist:'artists',track:'tracks',book:'books'} as Partial<Record<MediaPage,MediaPage>>)[page];
  return page?.startsWith('settings/')||fromSettings?'settings':undefined;
}
