import {FloatingConfirm} from '../ui/floating-confirm.tsx';
import { FloatingNotice } from '../ui/floating-notice.tsx';
import {combineAbortSignals} from '../core/abort.ts';
import {MediaSelect} from './select.tsx';
import {ApiError} from '../api/errors.ts';
import {MissingEdition} from './missing-edition.tsx';
import {ArtistTracks} from './artist-tracks.tsx';
import {restorePlaybackEntries} from './restore-playback.ts';
import {MediaThemeController} from './theme.ts';
import {ResourcePanel} from './resource-panel.tsx';
import { itemLabel } from './item-label.ts';
import { historyDay, historyPosition } from './history-labels.ts';
import { EmptyMediaLibrary } from './empty-library.tsx';
import { ChevronLeft, Folder, Ellipsis, Plus, RefreshCw, Play, Clock3, Heart, ListMusic, SlidersHorizontal } from 'lucide-preact';
import { MediaSettings } from './settings.tsx';
import {MediaFavorites,favoriteChannel,favoriteScope,type FavoriteScope} from './favorites.tsx';
import {ChannelSwitcher} from './channel-navigation.tsx';
import {mediaParentPage,settingsPanel,categoryKinds,detailPages,isItemPage,isPlayerPage,type MediaPage,type MediaRoute} from './page-route.ts';
import {routeHash} from '../ui/router.ts';
import { MediaScreenError } from './screen-error.tsx';
import { MediaLoading } from './loading.tsx';
import { ArtistInfo } from './artist-info.tsx';
import { MediaDetailHeading, mediaDetailLabel } from './detail-heading.tsx';
import { MediaLibraryList, type LibraryListPosition } from './library-list.tsx';
import { MediaLibraryEditor } from './library-editor.tsx';
import { MediaLibraryCreate } from './library-create.tsx';
import { MusicParentEditor } from './parent-editor.tsx';
import { VideoHierarchyEditor } from './video-hierarchy-editor.tsx';
import { ScanJobs } from './scan-jobs.tsx';
import { AiScanJobs } from './ai-scan-jobs.tsx';
import { SavedQueue } from './saved-queue.tsx';
import { MediaChildList } from './child-list.tsx';
import { readMediaPreferences, type MediaPreferences } from './preferences.ts';
import { AlbumPlayback } from './album-playback.tsx';
import { MediaFolders, type FolderLocation } from './folders.tsx';
import { Narrators, type NarratorLocation } from './narrators.tsx';
import { SeasonPlayback, SeriesSeasons, seasonQueue, type SeasonEpisode } from './season-playback.tsx';
import { PlaybackControls, type PlaybackPanel } from './playback-controls.tsx';
import {VideoControls} from './video-controls.tsx';
import { ContinuePlaying } from './continue-playing.tsx';
import { ScrapeJobs } from './scrape-jobs.tsx';
import { EditionDetails, EditionTools, type EditionDetailsProps, type ChapterPosition } from './edition-details.tsx';
import { AudiobookChapters } from './audiobook-chapters.tsx';
import { MetadataSources } from './metadata-sources.tsx';
import { MediaMetadataPage, type MetadataView } from './metadata-page.tsx';
import { MediaPermissions } from './permissions.tsx';
import { MediaSearch, searchReturnFor, clearSearchReturn, restoreSearchReturn, restoreSearchHistory } from './search.tsx';
import { render, Fragment } from '../ui/vendor/preact.ts';
import { MediaCover } from './cover.tsx';
import { MediaApi } from './api.ts';
import type { AiScanJob, Detail, Item, Library, MediaChannel, ScanJob } from './api.ts';
import type { MediaPlayer } from './player.ts';

const labels={video:'影视',music:'音乐',audiobook:'有声书'};
const kinds:Record<MediaChannel,Array<[string,string]>>={video:[['video','首页'],['movie','电影'],['series','剧集']],music:[['album','专辑'],['artist','歌手'],['track','曲目']],audiobook:[['audiobook','作品'],['narrator','演播者']]};
interface Activity {id:string;libraryId:string;itemId:string;partId:string;assetId:string;title:string;partTitle:string;start:number;end:number|null;available:number;position?:number;completed?:number;editionLabel?:string;updatedAt?:number}
interface PersonalReturn {fromSettings?:boolean;scope:string;channel:MediaChannel;itemId:string;originItemId:string|undefined;view:'favorites'|'history';offset:number;scroll:number;windowY:number}
const personalReturns=new WeakMap<MediaApi,PersonalReturn>();
const narratorReturns=new WeakMap<MediaApi,{scope:string;location:NarratorLocation}>();
interface TrackReturn {scope:string;itemId:string;libraryId:string;offset:number;sort:string;filters:{artist:string;album:string};filterOpen:boolean;scroll:number;windowY:number}
const trackReturns=new WeakMap<MediaApi,TrackReturn>();
const folderReturns=new WeakMap<MediaApi,{scope:string;channel:MediaChannel;libraryId:string;itemId:string;location:FolderLocation;restore:boolean}>();

export class MediaScreen {
  readonly element=document.createElement('section');
  private libraries:Library[]=[];
  private allLibraries:Library[]=[];
  private createReturnToManager=false;
  private creatingLibrary=false;
  private librariesLoaded=false;
  private libraryId='';
  private kind:string;
  private items:Item[]=[];
  private catalogLoading=false;
  private catalogFailed=false;
  private catalogRequest=0;
  private catalogAbort:AbortController|null=null;
  private detail:Detail|null=null;
  private selectedEditionId='';
  private readonly theme:MediaThemeController;
  private albumAssetId='';
  private albumAssets:Array<{id:string;title:string}>=[];
  private chaptersOpen=false;
  private chapterNotice='';
  private chapterPosition:ChapterPosition={query:'',page:0};
  private detailScroll=0;
  private metadataView:MetadataView|null=null;
  private metadataScroll=0;
  private error='';
  private errorCause:unknown;
  private busy=false;
  private query='';
  private searchOpen=false;
  private foldersOpen=false;
  private folderLocation:FolderLocation|undefined;
  private settingsOpen=false;
  private page:MediaPage|undefined;
  private location:MediaRoute|undefined;
  private routeRequest=0;
  private fromSettings=false;
  private catalogScroll=0;
  private preferences:MediaPreferences;
  private offset=0;
  private trackSort='default';
  private trackFilters={artist:'',album:''};
  private total=0;
  private personal:'favorites'|'history'|'queue'|null=null;
  private personalRequest:{view:'favorites'|'history'|'queue';offset:number}|null=null;
  private personalLoading=false;
  private personalFailed=false;
  private personalSequence=0;
  private personalAbort:AbortController|null=null;
  private favorites:Item[]=[];
  private favoriteOffset=0;
  private favoriteTotal=0;
  private favoriteScope:FavoriteScope='all';
  private historyOffset=0;
  private historyTotal=0;
  private activity:Activity[]=[];
  private clearQueueIds:string[]|null=null;
  private favorite=false;
  private managing=false;
  private managerTab:'libraries'|'tasks'='libraries';
  private taskTab:'media'|'ai'|'scrape'='media';
  private jobs:ScanJob[]=[];
  private aiJobs:AiScanJob[]=[];
  private jobLibraryId='';
  private scanNotice='';
  private scanActionError='';
  private libraryManagerPosition:LibraryListPosition={query:'',page:0};
  private jobRequest=0;
  private jobState:'idle'|'loading'|'ready'|'error'='idle';
  private jobError='';
  private renaming:Library|null=null;
  private permissionLibrary:Library|null=null;
  private disposed=false;
  private playbackView=false;
  private playbackRestore:AbortController|null=null;
  private playbackRestoring=false;
  private playbackRestoreError:unknown=null;
  private onPlayerChanged=()=>{
    this.draw();
    const source=this.location;
    if(this.playbackRestoring||!this.playbackView||!source||!isPlayerPage(source.page)||!this.player.active||!this.player.currentItemId||!this.player.currentPartId)return;
    const next={...source,itemId:this.player.currentItemId,params:{part:this.player.currentPartId}};
    if(routeHash(next)!==routeHash(source))queueMicrotask(()=>{if(!this.disposed&&this.location===source)this.routing?.navigateRoute?.(next,true);});
  };
  private playbackPanel:PlaybackPanel='main';
  private browseScroll=0;
  private narratorLocation:NarratorLocation|undefined;
  private layoutFrame=0;
  private playerSize:ResizeObserver|null=null;
  private updateAudioLayout=()=>{
    cancelAnimationFrame(this.layoutFrame);
    this.layoutFrame=requestAnimationFrame(()=>{
      if(this.disposed)return;
      if(this.playbackView&&this.player.isVideo&&!this.player.isWebVideo&&!this.player.element.hidden){
        const playerTop=this.player.element.getBoundingClientRect().top,screenTop=this.element.getBoundingClientRect().top;
        this.element.style.maxHeight=Math.max(100,playerTop-screenTop-8)+'px';
      }else this.element.style.removeProperty('max-height');
    });
  };
  private openPlayback=async()=>{
    if(this.routing?.navigateRoute){
      const itemId=this.player.currentItemId,part=this.player.currentPartId;if(!itemId||!part)return;
      let channel=this.player.isVideo?'video' as const:this.channel;
      if(!this.player.isVideo)try{const item=await this.api.detail(itemId,this.abort.signal);channel=item.kind==='audiobook'?'audiobook':'music';}catch{/* Playback controls remain available when optional metadata cannot load. */}
      if(this.disposed||this.player.currentPartId!==part)return;
      if(this.playbackView&&this.location?.itemId===itemId&&this.location.params?.part===part)return;
      this.routing.navigateRoute({name:'media',channel,itemId,page:'player',params:{part},...(this.location?{returnTo:routeHash(this.location)}:{})});return;
    }
    if(this.playbackView)return;this.browseScroll=this.element.scrollTop;this.playbackView=true;this.playbackPanel='main';this.player.setControlsExpanded(true);this.draw();this.element.scrollTop=0;
  };
  private onPlaybackFavorite=(id:string,favorite:boolean)=>{if(this.detail?.id===id)this.favorite=favorite;};
  private closePlayback=()=>{if(this.routing?.back){this.routing.back();return;}this.playbackPanel='main';this.playbackView=false;this.player.setControlsExpanded(false);this.draw();this.element.scrollTop=this.browseScroll;this.player.focusControlsEntry();};
  private onKeyDown=(event:KeyboardEvent)=>{if(event.key!=='Escape'||event.defaultPrevented||document.fullscreenElement||this.element.querySelector('dialog[open]'))return;if(this.playbackView){event.preventDefault();event.stopPropagation();this.backFromPlayback();}else if(this.settingsOpen||this.permissionLibrary||this.renaming||this.creatingLibrary){event.preventDefault();event.stopPropagation();this.element.querySelector<HTMLButtonElement>('[data-media-back]')?.click();}else if(this.metadataView){event.preventDefault();event.stopPropagation();this.element.querySelector<HTMLButtonElement>('[aria-label="返回作品详情"]')?.click();}else if(this.chaptersOpen){event.preventDefault();event.stopPropagation();this.closeChapters();}else if(this.page&&!categoryKinds[this.page]){event.preventDefault();event.stopPropagation();this.backPage();}};
  private backFromPlayback=()=>{if(this.routing?.back){this.routing.back();return;}if(this.playbackPanel!=='main'){this.playbackPanel='main';this.draw();this.element.scrollTop=0;}else this.closePlayback();};
  private dismissMenus=(event:Event)=>{
    const target=event.target;
    for(const menu of this.element.querySelectorAll<HTMLDetailsElement>('details.media-actions[open],details.media-browse-filters[open],details.media-library-actions[open]')){
      if(event instanceof KeyboardEvent&&event.key==='Escape'){menu.open=false;event.preventDefault();event.stopImmediatePropagation();menu.querySelector<HTMLElement>('summary')?.focus();}
      else if(target instanceof Node&&!menu.contains(target))menu.open=false;
      else if(target instanceof Element&&target.closest('nav button'))menu.open=false;
    }
  };
  private abort=new AbortController();
  private poll:ReturnType<typeof setTimeout>|null=null;
  constructor(private readonly api:MediaApi,private readonly player:MediaPlayer,private readonly channel:MediaChannel,
    private readonly admin:boolean,private readonly navigate:(channel:MediaChannel,id?:string)=>void,private itemId?:string,
    private readonly routing?:{route?:MediaRoute;page?:MediaPage|undefined;fromSettings?:boolean|undefined;navigate:(page?:MediaPage,fromSettings?:boolean,replace?:boolean)=>void;navigateRoute?:(route:MediaRoute,replace?:boolean)=>void;back?:()=>void}) {
    this.location=routing?.route;
    this.page=routing?.page;this.fromSettings=!!routing?.fromSettings;this.settingsOpen=settingsPanel(this.page)!==null;this.personal=this.page==='favorites'||this.page==='history'||this.page==='queue'?this.page:null;this.personalLoading=!!this.personal;
    this.preferences=readMediaPreferences(this.api.preferenceScope());this.trackSort=this.preferences.sort??'default';this.kind=kinds[channel][0]![0];this.element.className='media-screen';this.theme=new MediaThemeController(this.api.preferenceScope(),()=>this.draw());
    document.addEventListener('keydown',this.dismissMenus,true);document.addEventListener('click',this.dismissMenus,true);document.addEventListener('keydown',this.onKeyDown);
    window.addEventListener('resize',this.updateAudioLayout);
    if(typeof ResizeObserver!=='undefined'){this.playerSize=new ResizeObserver(this.updateAudioLayout);this.playerSize.observe(this.player.element);}
    this.player.addEventListener('change',this.onPlayerChanged);this.player.addEventListener('open-controls',this.openPlayback);this.draw();
  }
  async show(){await this.run(async()=>{
    restoreSearchHistory(this.api,this.channel,this.itemId);
    this.allLibraries=(await this.api.libraries(this.abort.signal)).items;
    this.libraries=this.allLibraries.filter(l=>l.kind===this.channel);
    this.librariesLoaded=true;
    this.libraryId=this.libraries.length===1?this.libraries[0]!.id:'';
    if(this.location){await this.showRoute(this.location);return;}
    if(this.page){await this.showPage(this.page,this.fromSettings);return;}
    if(this.itemId){this.detail=await this.api.detail(this.itemId,this.abort.signal);this.libraryId=this.detail.libraryId;this.favorite=(await this.api.request<{favorite:boolean}>(`items/${this.itemId}/favorite`,'GET',undefined,this.abort.signal)).favorite;}
    else {
      const search=searchReturnFor(this.api);
      if(search?.channel===this.channel&&search.restore)this.searchOpen=true;
      else clearSearchReturn(this.api);
      const track=this.trackReturn();
      if(track){this.kind='track';this.libraryId=track.libraryId&&this.libraries.some(lib=>lib.id===track.libraryId)?track.libraryId:'';this.offset=this.libraryId===track.libraryId?track.offset:0;this.trackSort=track.sort;this.trackFilters={...track.filters};}
      const narrator=narratorReturns.get(this.api);
      if(this.channel==='audiobook'&&narrator?.scope===this.api.preferenceScope()){
        if(!narrator.location.libraryId||this.libraries.some(lib=>lib.id===narrator.location.libraryId)){this.kind='narrator';this.libraryId=narrator.location.libraryId;this.narratorLocation=narrator.location;}
        narratorReturns.delete(this.api);
      }
      const folder=this.folderReturn();
      if(folder?.restore){if(this.libraries.some(library=>library.id===folder.libraryId)){this.foldersOpen=true;this.libraryId=folder.libraryId;this.folderLocation=folder.location;}folderReturns.delete(this.api);}
      else if(folder)folderReturns.delete(this.api);
      await this.load();
    }
    const saved=this.personalReturn();if(saved&&saved.originItemId===this.itemId)await this.loadPersonal(saved.view,saved.offset);
  });if(this.error&&!this.librariesLoaded&&this.personal){this.personalFailed=true;this.personalLoading=false;this.draw();}if(!this.error){const saved=this.personalReturn();if(saved&&saved.originItemId===this.itemId){this.element.scrollTop=saved.scroll;window.scrollTo(0,saved.windowY);personalReturns.delete(this.api);}else if(!this.itemId){const track=this.trackReturn();if(track){const panel=this.element.querySelector<HTMLDetailsElement>('.media-track-filters');if(panel)panel.open=track.filterOpen;this.element.scrollTop=track.scroll;window.scrollTo(0,track.windowY);trackReturns.delete(this.api);}}}}
  private goPage=(page?:MediaPage,fromSettings=false,replace=false)=>{
    if(this.routing?.navigateRoute){this.openRoute(page,{},isItemPage(page)?this.itemId:undefined,replace,fromSettings);return;}
    this.element.querySelector<HTMLDetailsElement>('.media-actions')?.removeAttribute('open');
    if(!this.page)this.catalogScroll=this.element.scrollTop;
    if(this.routing)this.routing.navigate(page,fromSettings,replace);else void this.showPage(page,fromSettings);
  };
  private backPage=()=>{if(this.routing?.back){this.routing.back();return;}this.goPage(mediaParentPage(this.page,this.fromSettings),false,true);};
  private openRoute(page?:MediaPage,params:Record<string,string>={},itemId?:string,replace=false,fromSettings=false){
    if(!this.routing?.navigateRoute)return;
    if(isPlayerPage(page)){itemId=this.player.currentItemId||this.location?.itemId;params={part:this.player.currentPartId||this.location?.params?.part||''};}
    const category=!!page&&!!categoryKinds[page];
    const returnTo=replace?this.location?.returnTo:this.location?routeHash(this.location):undefined;
    const next:MediaRoute={name:'media',channel:page==='search'||page==='favorites'?'video':this.channel,itemId:itemId??'',...(page?{page}:{}),...(Object.keys(params).length?{params}:{}),...(fromSettings?{fromSettings:true}:{}),...(!category&&returnTo?{returnTo}:{})};
    if(!next.returnTo)delete next.returnTo;
    this.routing.navigateRoute(next,replace);
  }
  private syncLocation(page:MediaPage,params:Record<string,string>,itemId='',replace=false){
    if(!this.routing?.navigateRoute||!this.location)return;
    const changedPage=page!==this.location.page||(params.path??'')!==(this.location.params?.path??'')||(params.narrator??'')!==(this.location.params?.narrator??'');
    const next:MediaRoute={...this.location,page,itemId,params,...(changedPage&&!replace?{returnTo:routeHash(this.location)}:{})};
    const source=routeHash(this.location);
    if(routeHash(next)!==source)queueMicrotask(()=>{
      // Child effects may report a location during Preact's commit. Navigate after
      // that commit, and discard reports from a page the user has already left.
      if(!this.disposed&&this.location&&routeHash(this.location)===source)this.routing?.navigateRoute?.(next,replace);
    });
  }
  async showRoute(route:MediaRoute){
    const changed=this.location&&routeHash(this.location)!==routeHash(route);if(changed)this.element.scrollTop=0;
    this.location=route;this.page=route.page;this.fromSettings=!!route.fromSettings;
    const page=route.page,p=route.params??{},request=++this.routeRequest;
    if(isPlayerPage(page)){
      this.playbackView=true;this.playbackPanel=page==='player/lyrics'?'lyrics':page==='player/queue'?'queue':page==='player/chapters'?'chapters':'main';
      this.player.setControlsExpanded(true);
      this.playbackRestore?.abort();this.playbackRestore=null;this.playbackRestoring=false;this.playbackRestoreError=null;
      if(route.itemId&&p.part&&(!this.player.active||this.player.currentItemId!==route.itemId||this.player.currentPartId!==p.part)){
        const controller=new AbortController();this.playbackRestore=controller;this.playbackRestoring=true;this.player.pause();this.player.setVisible(false);this.draw();
        try{
          const {entries,index}=await restorePlaybackEntries(this.api,route.itemId,p.part,controller.signal);
          if(controller.signal.aborted||request!==this.routeRequest)return;
          await this.player.play(entries,index,false,{autoplay:false,signal:controller.signal,openControls:false});
        }catch(error){if(!controller.signal.aborted)this.playbackRestoreError=error;}
        finally{if(!controller.signal.aborted){this.playbackRestoring=false;this.player.setVisible(!this.playbackRestoreError);this.draw();}}
      }else {this.player.setVisible(true);this.draw();this.onPlayerChanged();}
      return;
    }
    this.playbackRestore?.abort();this.playbackRestore=null;this.playbackRestoring=false;this.playbackRestoreError=null;
    this.playbackView=false;this.player.setVisible(true);this.player.setControlsExpanded(false);
    this.itemId=route.itemId||undefined;if(this.detail?.id!==route.itemId){this.detail=null;this.albumAssetId='';this.albumAssets=[];}
    this.settingsOpen=settingsPanel(page)!==null;this.managing=page==='settings/libraries'||page==='settings/tasks';this.managerTab=page==='settings/tasks'?'tasks':'libraries';
    this.personal=page==='favorites'||page==='history'||page==='queue'?page:null;this.personalSequence++;this.personalAbort?.abort();this.personalLoading=!!this.personal;this.personalFailed=false;
    this.searchOpen=page==='search';this.foldersOpen=page==='folders'||page==='file';this.creatingLibrary=page==='library-new';this.renaming=null;this.permissionLibrary=null;
    this.chaptersOpen=page==='chapters';this.chapterPosition={query:p.q??'',page:Math.max(0,Number(p.offset)||0)};this.metadataView=page==='metadata'?'edit':page==='match'?'match':null;
    this.kind=page&&categoryKinds[page]||(['narrator','narrator-work'].includes(page??'')?'narrator':kinds[this.channel][0]![0]);
    this.offset=Math.max(0,Number(p.offset)||0);this.trackSort=p.sort||this.preferences.sort||'default';this.trackFilters={artist:p.artist||'',album:p.album||''};this.selectedEditionId=p.edition||this.selectedEditionId;
    this.error='';this.errorCause=undefined;
    if(!this.librariesLoaded){this.draw();if(!this.busy)await this.show();return;}
    this.libraryId=p.library&&this.libraries.some(l=>l.id===p.library)?p.library:this.libraries.length===1?this.libraries[0]!.id:'';
    if(this.kind==='narrator')this.narratorLocation={libraryId:this.libraryId,name:p.narrator||null,search:p.q??'',offset:this.offset,workId:p.work??'',editionId:p.edition??''};
    if(this.foldersOpen)this.folderLocation={path:p.path??'',offset:this.offset,assetId:p.asset??null,editions:{},chapters:{}};
    if(page==='library-edit'||page==='library-permissions'){
      const library=this.allLibraries.find(l=>l.id===p.library);if(library){if(page==='library-edit')this.renaming=library;else this.permissionLibrary=library;}else this.error='媒体库不存在或不可访问。';
    }
    const adminPage=this.managing||this.creatingLibrary||page==='library-edit'||page==='library-permissions'||!!this.metadataView;
    if(adminPage&&!this.admin){this.openRoute('settings',{},undefined,true);return;}
    this.draw();
    await this.run(async()=>{
      if(route.itemId&&(isItemPage(page)||!page)){
        if(this.detail?.id!==route.itemId){const detail=await this.api.detail(route.itemId,this.abort.signal);if(request!==this.routeRequest)return;this.detail=detail;this.libraryId=detail.libraryId;this.favorite=(await this.api.request<{favorite:boolean}>(`items/${detail.id}/favorite`,'GET',undefined,this.abort.signal)).favorite;}
        if(!page&&this.detail&&this.routing?.navigateRoute){this.routing.navigateRoute({...route,page:detailPages[this.detail.kind]!},true);return;}
      }else if(this.personal)await this.loadPersonal(this.personal,this.offset);
      else if(this.managing&&this.managerTab==='tasks')await this.loadJobs(p.job||'');
      else if(!page||!!categoryKinds[page])await this.load();
    });
  }
  async showPage(page?:MediaPage,fromSettings=false){
    this.page=page;this.fromSettings=fromSettings;
    this.personalSequence++;this.personalAbort?.abort();this.personalLoading=false;this.personalFailed=false;this.personal=null;
    this.settingsOpen=settingsPanel(page)!==null;this.managing=false;this.permissionLibrary=null;this.renaming=null;this.creatingLibrary=false;
    this.searchOpen=false;this.chaptersOpen=false;this.metadataView=null;this.error='';this.errorCause=undefined;
    if(this.playbackView){this.playbackView=false;this.playbackPanel='main';this.player.setControlsExpanded(false);}
    if(page==='settings/libraries'||page==='settings/tasks'){
      if(this.admin){this.managing=true;this.managerTab=page==='settings/tasks'?'tasks':'libraries';}
      else {if(this.routing){this.routing.navigate('settings',false,true);return;}this.settingsOpen=true;this.page='settings';}
    }
    this.draw();this.element.scrollTop=page?0:this.catalogScroll;
    if(!this.librariesLoaded){this.personal=page==='favorites'||page==='history'||page==='queue'?page:null;this.personalLoading=!!this.personal;this.draw();if(!this.busy)await this.show();return;}
    if(page==='favorites'||page==='history'||page==='queue'){
      const saved=this.personalReturn();
      await this.run(()=>this.loadPersonal(page,saved?.view===page?saved.offset:0));
      if(saved?.view===page&&!this.error){this.element.scrollTop=saved.scroll;personalReturns.delete(this.api);}
    }else if(this.managing&&this.managerTab==='tasks')await this.run(()=>this.loadJobs(this.jobLibraryId));
    else if(!page)await this.run(()=>this.load());
  }
  private trackReturn(){const saved=trackReturns.get(this.api);return this.channel==='music'&&saved?.scope===this.api.preferenceScope()?saved:undefined;}
  private openTrack(id:string){trackReturns.set(this.api,{scope:this.api.preferenceScope(),itemId:id,libraryId:this.libraryId,offset:this.offset,sort:this.trackSort,filters:{...this.trackFilters},filterOpen:this.element.querySelector<HTMLDetailsElement>('.media-track-filters')?.open??false,scroll:this.element.scrollTop,windowY:window.scrollY});this.navigate(this.channel,id);}
  private openNarratorDetail(id:string){if(this.narratorLocation)narratorReturns.set(this.api,{scope:this.api.preferenceScope(),location:this.narratorLocation});this.navigate(this.channel,id);}
  private folderReturn(){const saved=folderReturns.get(this.api);return saved?.scope===this.api.preferenceScope()&&saved.channel===this.channel?saved:undefined;}
  private openFolderDetail(id:string,location:FolderLocation){folderReturns.set(this.api,{scope:this.api.preferenceScope(),channel:this.channel,libraryId:this.libraryId,itemId:id,location,restore:false});this.navigate(this.channel,id);}
  private backToFolder(){const saved=this.folderReturn();if(!saved||saved.itemId!==this.itemId)return false;saved.restore=true;this.navigate(this.channel);return true;}
  private personalReturn(){const saved=personalReturns.get(this.api);return saved?.scope===this.api.preferenceScope()&&saved.channel===this.channel?saved:undefined;}
  private openPersonalItem(id:string,channel=this.channel){
    if(this.personal==='favorites'||this.personal==='history')personalReturns.set(this.api,{scope:this.api.preferenceScope(),channel:this.channel,itemId:id,originItemId:this.itemId,fromSettings:this.fromSettings,view:this.personal,offset:this.personal==='favorites'?this.favoriteOffset:this.historyOffset,scroll:this.element.scrollTop,windowY:window.scrollY});
    if(id===this.itemId){this.personal=null;this.draw();this.element.scrollTop=0;return;}
    this.navigate(channel,id);
  }
  private backFromDetail(detail:Detail){if(this.routing?.back){this.routing.back();return;}const personalOrigin=this.personalReturn();if(this.routing&&personalOrigin?.itemId===detail.id){this.goPage(personalOrigin.view,personalOrigin.fromSettings);return;}if(this.backToFolder())return;const search=searchReturnFor(this.api);if(search?.itemId===detail.id&&search.targetChannel===this.channel){restoreSearchReturn(this.api);this.navigate(search.channel);return;}const saved=this.personalReturn();if(saved?.itemId===detail.id){if(saved.originItemId===this.itemId){void this.run(()=>this.loadPersonal(saved.view,saved.offset)).then(()=>{if(!this.error&&!this.disposed){this.element.scrollTop=saved.scroll;window.scrollTo(0,saved.windowY);personalReturns.delete(this.api);}});}else this.navigate(this.channel,saved.originItemId);}else this.navigate(this.channel,this.trackReturn()?.itemId===detail.id?undefined:detail.parentId||undefined);}
  private async run(action:()=>Promise<void>){this.busy=true;this.error='';this.errorCause=undefined;this.draw();try{await action();}catch(error){if(!this.disposed){this.error=error instanceof Error?error.message:'操作失败';this.errorCause=error;}}finally{this.busy=false;this.draw();}}
  private async load(){
    if(this.foldersOpen||this.kind==='narrator')return;
    if(this.routing?.navigateRoute&&this.location&&!this.foldersOpen&&(!this.page||categoryKinds[this.page])){
      const page=Object.entries(categoryKinds).find(([,kind])=>kind===this.kind)?.[0] as MediaPage|undefined;
      const params={library:this.libraryId,offset:String(this.offset),sort:this.trackSort,artist:this.trackFilters.artist,album:this.trackFilters.album};
      const next={...this.location,...(page?{page}:{}),params};
      if(routeHash(next)!==routeHash(this.location)){this.routing.navigateRoute(next,true);return;}
    }
    const request=++this.catalogRequest;
    this.catalogAbort?.abort();this.catalogAbort=new AbortController();
    if(!this.libraries.length){this.items=[];this.total=0;this.offset=0;this.catalogLoading=false;this.catalogFailed=false;return;}
    const {signal,dispose}=combineAbortSignals([this.abort.signal,this.catalogAbort.signal]);
    const {libraryId,kind,query,trackSort}=this,filters=kind==='track'?this.trackFilters:undefined;
    let offset=this.offset;const current=()=>!this.disposed&&request===this.catalogRequest;
    const read=()=>libraryId?this.api.items(libraryId,kind,query,offset,signal,trackSort,filters):this.api.browse(this.channel,kind,offset,signal,trackSort,filters);
    this.catalogLoading=true;this.catalogFailed=false;this.draw();
    try{
      let result=await read();if(!current())return;
      if(offset>0&&offset>=result.total){
        this.offset=offset=Math.max(0,Math.floor((result.total-1)/60)*60);result=await read();if(!current())return;
        if(offset>0&&offset>=result.total){this.offset=offset=0;result=await read();if(!current())return;}
      }
      this.items=result.items;this.total=result.total;
    }catch(error){if(current()){this.catalogFailed=true;throw error;}}
    finally{dispose();if(current()){this.catalogLoading=false;this.draw();}}
  }
  private async personalPage<T>(view:'favorites'|'history',offset:number,signal=this.abort.signal){
    const scope=favoriteScope(this.location?.params?.scope??this.favoriteScope),channel=view==='favorites'?(scope==='all'?'':scope):this.channel;
    const read=(start:number)=>this.api.request<{items:T[];total:number}>(`${view}?${channel?'channel='+channel+'&':''}offset=${start}&limit=60`,'GET',undefined,signal);
    let result=await read(offset);
    if(offset>0&&offset>=result.total){
      offset=Math.max(0,Math.floor((result.total-1)/60)*60);result=await read(offset);
      // A second concurrent shrink falls back to the first page without an unbounded retry loop.
      if(offset>0&&offset>=result.total){offset=0;result=await read(0);}
    }
    return {...result,offset};
  }
  private async loadPersonal(view:'favorites'|'history'|'queue',offset=0){
    if(this.location?.page===view&&Number(this.location.params?.offset??0)!==offset){this.syncLocation(view,{...this.location.params,offset:String(offset)},'',true);return;}
    const sequence=++this.personalSequence,current=()=>!this.disposed&&sequence===this.personalSequence;
    this.personalAbort?.abort();this.personalAbort=new AbortController();
    const {signal,dispose}=combineAbortSignals([this.abort.signal,this.personalAbort.signal]);
    this.personalRequest={view,offset};
    if(this.personal!==view){this.favorites=[];this.activity=[];this.favoriteTotal=0;this.historyTotal=0;}
    this.personal=view;this.clearQueueIds=null;this.personalLoading=true;this.personalFailed=false;this.draw();
    try{
      if(view==='favorites'){const result=await this.personalPage<Item>(view,offset,signal);if(!current())return;this.favorites=result.items;this.favoriteOffset=result.offset;this.favoriteTotal=result.total;}
      else if(view==='history'){const result=await this.personalPage<Activity>(view,offset,signal);if(!current())return;this.activity=result.items;this.historyOffset=result.offset;this.historyTotal=result.total;}
      else{const allowed=new Set(this.libraries.map(l=>l.id)),result=await this.api.request<{items:Activity[]}>(view,'GET',undefined,signal);if(!current())return;this.activity=result.items.filter(i=>allowed.has(i.libraryId));}
    }catch(error){if(current()){this.personalFailed=true;throw error;}}
    finally{dispose();if(current()){this.personalLoading=false;this.draw();}}
  }
  private leavePersonal(){if(this.routing){personalReturns.delete(this.api);this.backPage();return;}this.personalSequence++;this.personalAbort?.abort();this.personalLoading=false;this.personalFailed=false;this.personal=null;this.error='';this.errorCause=undefined;this.draw();}
  private retryScreen(){
    if(this.personal&&this.personalRequest?.view===this.personal){const {view,offset}=this.personalRequest;void this.run(()=>this.loadPersonal(view,offset));}
    else if(this.librariesLoaded&&!this.itemId&&!this.managing&&!this.settingsOpen&&!this.permissionLibrary)void this.run(()=>this.load());
    else void this.show();
  }
  private favoritePages(){return <MediaFavorites api={this.api} items={this.favorites} total={this.favoriteTotal} offset={this.favoriteOffset} scope={favoriteScope(this.location?.params?.scope??this.favoriteScope)} busy={this.busy} onOpen={item=>this.openPersonalItem(item.id,favoriteChannel(item))} onPage={offset=>void this.run(()=>this.loadPersonal('favorites',offset))} onScope={scope=>{if(this.location&&this.routing?.navigateRoute){this.syncLocation('favorites',{scope},'',true);return;}this.favoriteScope=scope;void this.run(()=>this.loadPersonal('favorites'));}}/>;}
  private async toggleFavorite(){if(!this.detail)return;this.favorite=(await this.api.request<{favorite:boolean}>(`items/${this.detail.id}/favorite`,'PUT',{favorite:!this.favorite})).favorite;}
  private historyPages(){return <nav className="media-toolbar" aria-label="历史分页"><button disabled={this.busy||this.historyOffset===0} onClick={()=>void this.run(()=>this.loadPersonal('history',Math.max(0,this.historyOffset-60)))}>上一页</button><span>{this.historyTotal} 项 · 第 {Math.floor(this.historyOffset/60)+1} 页</span><button disabled={this.busy||this.historyOffset+60>=this.historyTotal} onClick={()=>void this.run(()=>this.loadPersonal('history',this.historyOffset+60))}>下一页</button></nav>;}
  private async enqueue(parts:string[]){await this.api.request('queue','POST',{partIds:parts});}
  private personalEmpty(message:string){const Icon=this.personal==='favorites'?Heart:this.personal==='history'?Clock3:ListMusic;return this.busy||this.error?null:<div className="media-personal-empty"><Icon size={32} strokeWidth={1.4} aria-hidden="true"/><p>{message}</p></div>;}
  private savedQueueView(){return <>
    {this.clearQueueIds&&<FloatingConfirm theme="media" title="清空队列" text={`移除当前${labels[this.channel]}队列中的 ${this.clearQueueIds.length} 条记录？不会删除文件或停止当前播放。`} confirmText="确认清空" cancelText="保留队列" onCancel={()=>{this.clearQueueIds=null;this.draw();}} onConfirm={()=>{const entryIds=this.clearQueueIds;this.clearQueueIds=null;void this.run(async()=>{await this.api.request('queue/clear','POST',{channel:this.channel,entryIds});await this.loadPersonal('queue');});}}/>}
    {this.activity.length?<SavedQueue entries={this.activity} busy={this.busy}
      onClear={()=>{this.clearQueueIds=this.activity.map(row=>row.id);this.draw();}}
      onDetail={id=>this.openPersonalItem(id)}
      onPlay={index=>void this.run(()=>this.player.play(this.activity.filter(row=>row.available).map(row=>({part:{id:row.partId,assetId:row.assetId,title:row.partTitle,start:row.start,end:row.end,available:true},title:row.title,video:this.channel==='video'})),this.activity.slice(0,index).filter(row=>row.available).length))}
      onMove={(index,direction)=>void this.run(async()=>{try{await this.api.request('queue/'+this.activity[index]!.id+'/move','POST',{direction,neighborId:this.activity[index+(direction==='up'?-1:1)]!.id});}finally{await this.loadPersonal('queue');}})}
      onRemove={id=>void this.run(async()=>{await this.api.request('queue/'+id,'DELETE');await this.loadPersonal('queue');})}/>:this.personalEmpty('暂无记录。')}
  </>;}
  private personalView(){
    if(this.personal==='queue')return <>{this.personalLoading&&(this.activity.length?<p className="media-loading" role="status">正在更新待播队列…</p>:<MediaLoading label="正在读取待播队列…" layout="list"/>)}<div key="saved-queue" hidden={this.personalFailed}>{this.savedQueueView()}</div></>;
    if(this.personalLoading)return <MediaLoading label={this.personal==='favorites'?'正在读取收藏…':this.personal==='history'?'正在读取播放历史…':'正在读取待播队列…'} layout="list" square={this.channel==='music'}/>;
    if(this.personalFailed)return null;
    if(this.personal==='favorites')return this.favoritePages();
    return <>{this.activity.length?this.activity.map((row,index)=><Fragment key={row.id||row.partId}>
      {(index===0||historyDay(row.updatedAt)!==historyDay(this.activity[index-1]?.updatedAt))&&<h2 className="media-history-date">{historyDay(row.updatedAt)}</h2>}
      <div className="media-row media-history-row"><button onClick={()=>this.openPersonalItem(row.itemId)} title={row.title}><span className="media-personal-title">{row.title}</span><small>{[row.partTitle,row.editionLabel].filter(Boolean).join(' · ')}{row.completed?' · 已完成':row.position!==undefined?' · '+historyPosition(row.position,row.start):''}</small>{!row.available&&<small className="media-history-unavailable">资源不可用</small>}</button>
      <button className="media-history-play" aria-label="播放" title={row.available?'播放':'资源不可用'} disabled={!row.available||this.busy} onClick={()=>void this.run(()=>this.playHistory(row))}><Play size={18} aria-hidden="true"/></button></div>
    </Fragment>):this.personalEmpty('暂无记录。')}{this.historyTotal>60&&this.historyPages()}</>;
  }
  private async playHistory(row:Activity){
    const detail=await this.api.detail(row.itemId,this.abort.signal);
    const parts=detail.editions.find(edition=>edition.parts.some(part=>part.id===row.partId))?.parts.filter(part=>part.available)??[];
    const index=parts.findIndex(part=>part.id===row.partId);
    if(index<0)throw new Error('这条播放记录对应的资源已不可用，请打开作品详情选择其他版本。');
    await this.player.play(parts.map(part=>({part,title:detail.title,video:this.channel==='video'})),index);
  }
  private async scan(id:string){await this.run(async()=>{await this.api.request(`libraries/${id}/scan`,'POST');await this.loadJobs(id);});}
  private async scanAll(){await this.run(async()=>{
    this.scanNotice='';this.scanActionError='';let failure:unknown;
    try{const result=await this.api.request<{items:ScanJob[];skipped:string[]}>('scan-jobs','POST',{});this.scanNotice='已提交 '+result.items.length+' 个媒体库扫描'+(result.skipped.length?'，跳过 '+result.skipped.length+' 个已有任务':'')+'。最多同时扫描 2 个媒体库。';}catch(error){failure=error;}
    try{await this.loadJobs('');}catch(error){if(!failure)throw error;}
    if(failure)this.scanActionError='批量扫描请求未确认，请核对当前任务状态后再操作。'+(failure instanceof Error?failure.message:'');
  });}
  private async startAiScan(libraryId?:string,path=''){await this.run(async()=>{await this.api.startAiScan(libraryId,path);this.scanNotice='AI 扫描任务已创建，可在下方查看每批返回结果。';await this.loadAiJobs();});}
  private async loadAiJobs(){try{this.aiJobs=(await this.api.aiScanJobs(this.jobLibraryId||undefined)).items;this.draw();}catch{/* 普通扫描任务仍可用。 */}}
  private async loadJobs(id:string,background=false){
    if(this.poll){clearTimeout(this.poll);this.poll=null;}
    if(this.jobLibraryId!==id)this.jobs=[];
    const request=++this.jobRequest;this.jobLibraryId=id;
    if(!background){this.jobState='loading';this.jobError='';this.draw();}
    let result:{items:ScanJob[]};
    try {result=await this.api.request<{items:ScanJob[]}>(id?`libraries/${encodeURIComponent(id)}/jobs`:'scan-jobs','GET',undefined,this.abort.signal);}
    catch(error){
      if(this.disposed||request!==this.jobRequest)return;
      this.jobState='error';this.jobError=error instanceof Error?error.message:'扫描任务读取失败';this.draw();
      throw error;
    }
    if(this.disposed||request!==this.jobRequest)return;
    this.jobs=result.items;this.jobState='ready';
    // 普通扫描任务的状态更新不应依赖 AI 任务刷新；这样局部轮询在精简上下文或 AI 接口不可用时仍能稳定呈现。
    if(typeof this.loadAiJobs==='function')void this.loadAiJobs();
    this.draw();
    if(this.jobs.some(j=>j.state==='running'||j.state==='queued'))this.poll=setTimeout(()=>{void this.loadJobs(id,true).catch(()=>{});},1500);
    else if(!this.itemId)await this.load();
  }
  private cover(item:Item,retryable=false){return <MediaCover api={this.api} item={item} square={['album','artist','track'].includes(item.kind)} retryable={retryable}/>;}
  private async playTrack(id:string){
    const detail=await this.api.detail(id,this.abort.signal);
    if(this.disposed)return;
    const available=detail.editions.filter(edition=>edition.parts.length&&edition.parts.every(part=>part.available));
    if(available.length!==1){this.openTrack(id);return;}
    await this.player.play(available[0]!.parts.map(part=>({part,title:detail.title,video:false})),0);
  }
  private trackList(items:Item[]){return <div className="media-track-list" aria-label="音乐曲目">{items.map((item,index)=><div key={item.id} className="media-track-entry"><span className="media-track-number" aria-hidden="true">{String(this.offset+index+1).padStart(2,'0')}</span><button className="media-track-copy" disabled={this.busy} aria-label={'播放 '+item.title} aria-current={this.player.currentItemId===item.id?'true':undefined} onClick={()=>void this.run(()=>this.playTrack(item.id))}><strong title={item.title}>{item.title}</strong><small>{itemLabel(item)||'未知艺人'}</small></button><button className="media-track-detail" aria-label={'查看 '+item.title+' 详情'} title="曲目详情与版本" onClick={()=>this.openTrack(item.id)}><Ellipsis size={18} aria-hidden="true"/></button></div>)}</div>;}
  private grid(items:Item[],compactSeasons=false){return <div className={compactSeasons?"media-grid media-season-picker":items.length&&items.every(item=>item.kind==='artist')?"media-grid media-people-grid":"media-grid"}>{items.map(item=><button key={item.id} className="media-tile" onClick={()=>this.navigate(this.channel,item.id)}>{this.cover(item)}<strong title={item.title}>{item.title}</strong><small>{itemLabel(item)}</small></button>)}</div>;}
  private detailMenu(){const person=this.detail?.kind==='artist';return <details className="media-actions media-item-actions"><summary aria-label={person?'歌手操作':'作品操作'}><Ellipsis size={20} aria-hidden="true"/></summary><nav aria-label={person?'歌手操作':'作品操作'}><button disabled={this.busy} onClick={()=>void this.run(()=>this.toggleFavorite())}>{this.favorite?'取消收藏':person?'收藏歌手':'收藏作品'}</button>{!person&&<button onClick={event=>{const menu=event.currentTarget.closest('details');if(menu)menu.open=false;this.element.querySelector<HTMLDetailsElement>('[aria-label="资源信息操作"]')?.querySelector('summary')?.click();}}>资源信息与来源</button>}{this.admin&&<><button aria-label="管理元数据" onClick={()=>this.openMetadata('edit')}>{person?'编辑歌手资料':'编辑资料'}</button><button onClick={()=>this.openMetadata('match')}>{person?'匹配歌手资料':'匹配元数据'}</button></>}</nav></details>;}
  private detailView(detail:Detail){
    const edition=detail.editions.find(entry=>entry.id===this.selectedEditionId)||detail.editions[0];
    const playable=edition?.parts.filter(part=>part.available)||[];
    const plot=String(detail.overrides.plot??detail.metadata.plot??'').trim();
    const favorite=<button className="media-detail-favorite" disabled={this.busy} aria-pressed={this.favorite} onClick={()=>void this.run(()=>this.toggleFavorite())}><Heart size={17} fill={this.favorite?'currentColor':'none'} aria-hidden="true"/><span className="media-visually-hidden">{this.favorite?'取消收藏':'收藏'}</span></button>;
    const editionOptions:EditionDetailsProps|undefined=edition?{api:this.api,item:detail,edition,busy:this.busy,...(detail.editions.length>1?{onChooseVersion:()=>{this.element.querySelector<HTMLDetailsElement>('[aria-label="资源信息操作"]')?.querySelector('summary')?.click();}}:{}),onRefresh:()=>void this.run(async()=>{this.detail=await this.api.detail(detail.id,this.abort.signal);}),...(this.admin?{onUpdated:(updated:Detail)=>{this.detail=updated;this.draw();},onAssigned:(target:Detail)=>this.navigate(this.channel,target.id),onRename:(label:string)=>{edition.label=label;this.draw();}}:{}),onQueue:ids=>void this.run(()=>this.enqueue(ids)),onPlay:(parts,index)=>void this.run(()=>this.player.play(parts.map(part=>({part,title:detail.title+' · '+part.title,video:this.channel==='video'})),index))}:undefined;
    const resourceAside=<aside className="media-detail-sidebar" hidden={detail.kind==='artist'}>
      {detail.kind!=='artist'&&<ResourcePanel key={detail.id+'-'+(edition?.id??'album')} api={this.api} assets={edition?edition.parts.map(part=>({id:part.assetId,title:part.title})):detail.kind==='album'?this.albumAssets:[]} versionPicker={detail.editions.length>1&&<label className="media-edition-picker">版本<MediaSelect aria-label="播放版本" disabled={this.busy} value={edition?.id} onChange={event=>{this.selectedEditionId=event.currentTarget.value;if(this.location?.page)this.syncLocation(this.location.page,{...this.location.params,edition:this.selectedEditionId},this.detail?.id,true);this.draw();}}>{detail.editions.map(entry=><option key={entry.id} value={entry.id}>{entry.label}</option>)}</MediaSelect></label>} summary={edition?new Set(edition.parts.map(part=>part.assetId)).size+' 个文件 · '+edition.label:detail.children.length+(detail.kind==='album'?' 首曲目':detail.kind==='series'?' 季 · 资源见单集详情':' 项内容')} sourceInfo={<MetadataSources item={detail}/>} editionOptions={editionOptions}/>}
      {detail.kind==='album'&&plot&&<section className="media-detail-description"><h2>关于这张专辑</h2><p>{plot}</p></section>}
    </aside>;
    if(edition?.parts.length&&!playable.length)return <><MissingEdition title={detail.title} label={edition.label} busy={this.busy} onRefresh={editionOptions?.onRefresh} onChooseVersion={editionOptions?.onChooseVersion} {...(this.admin?{onManage:()=>this.goPage('settings/libraries')}:{})}/><div className="media-missing-resources">{resourceAside}</div></>;
    return <article className={'media-detail-page'+(detail.kind==='artist'?' media-person-detail':'')}>
      <div className="media-hero">{this.cover(detail,true)}{detail.kind==='artist'?<div className="media-person-copy"><MediaDetailHeading item={detail} libraryName={this.allLibraries?.find(library=>library.id===detail.libraryId)?.name} edition={edition}/><span className="media-person-count">{detail.children.filter(item=>item.kind==='album').length} 张专辑</span></div>:<div className="media-detail-hero-copy"><MediaDetailHeading {...(detail.kind==='series'?{seasonCount:detail.children.length}:{})} {...(detail.kind==='album'?{trackCount:detail.children.length}:{})} item={detail} libraryName={this.allLibraries?.find(library=>library.id===detail.libraryId)?.name} edition={edition}/></div>}</div>
      <div className="media-detail-actions">
        {detail.kind==='series'&&<button className="media-primary" disabled={this.busy||!detail.children.length} onClick={()=>void this.run(async()=>{const result=await this.api.request<{episodes:SeasonEpisode[]}>('items/'+encodeURIComponent(detail.id)+'/series-playback');const queue=seasonQueue(result.episodes,0,{});if(queue.entries.length)await this.player.play(queue.entries);else if(result.episodes[0])this.navigate(this.channel,result.episodes[0].id);})}><Play size={17} aria-hidden="true"/>播放剧集</button>}
        {edition&&<button className="media-primary" disabled={this.busy||!playable.length} onClick={()=>void this.run(()=>this.player.play(playable.map(part=>({part,title:detail.title+' · '+part.title,video:this.channel==='video'})),0))}><Play size={17} aria-hidden="true"/>{detail.kind==='movie'?'播放电影':detail.kind==='track'?'播放音频':detail.kind==='audiobook'?'开始收听':'播放此版本'}</button>}
        {detail.kind!=='album'&&favorite}

      </div>


      {detail.kind==='artist'&&plot&&<p className="media-person-bio">{plot}</p>}
      <div className={'media-detail-columns'+(detail.kind==='album'?' media-album-detail':'')}><div className="media-detail-main">
      {! ['artist','album'].includes(detail.kind)&&plot&&<section className="media-detail-description"><h2>{['movie','series','season','episode'].includes(detail.kind)?'剧情简介':'内容简介'}</h2><p>{plot}</p></section>}
      {detail.kind==='series'&&<SeriesSeasons currentPartId={this.player.currentPartId} key={detail.id+'-seasons'} api={this.api} seasons={detail.children} onPlay={entries=>this.player.play(entries)} onDetail={id=>this.navigate(this.channel,id)}/>}
      {detail.kind==='album'&&<AlbumPlayback sidebar={resourceAside} key={detail.id} api={this.api} id={detail.id} onTracksRead={tracks=>{const asset=tracks[0]?.editions[0]?.parts[0]?.assetId??'';const assets=tracks.flatMap(track=>track.editions.flatMap(version=>version.parts.map(part=>({id:part.assetId,title:part.title}))));if(this.albumAssetId!==asset||JSON.stringify(this.albumAssets)!==JSON.stringify(assets)){this.albumAssetId=asset;this.albumAssets=assets;this.draw();}}} credit={String(detail.overrides.artist??detail.metadata.artist??detail.overrides.albumArtist??detail.metadata.albumArtist??'')} actions={favorite} onPlay={entries=>this.player.play(entries)} onQueue={async ids=>{await this.api.request('queue','POST',{partIds:ids});}} onDetail={id=>this.navigate(this.channel,id)}/>}
      {editionOptions&&!(detail.kind==='movie'&&editionOptions.edition.parts.length===1&&playable.length>0)&&<EditionDetails key={editionOptions.edition.id} {...editionOptions} showTools={false} currentPartId={this.player.currentPartId} {...(detail.kind==='audiobook'?{onShowAll:()=>this.openChapters()}: {})}/>}
      {!['album','series'].includes(detail.kind)&&detail.children.length>0&&<section className="media-detail-children"><h2>{detail.kind==='season'?'选集':detail.kind==='artist'?'全部专辑':'全部内容'}</h2>{detail.kind==='season'?<SeasonPlayback key={detail.id} api={this.api} id={detail.id} onPlay={entries=>this.player.play(entries)} onDetail={id=>this.navigate(this.channel,id)}/>:<MediaChildList key={detail.id} items={detail.children} label={detail.kind==='artist'?'专辑':'季'} renderItems={items=>this.grid(items)}/>}</section>}
      {detail.kind==='artist'&&<ArtistTracks key={detail.id} api={this.api} artist={detail} onPlay={id=>this.playTrack(id)} onDetail={id=>this.openTrack(id)}/>}
      </div>{detail.kind!=='album'&&resourceAside}</div>
    </article>;
  }
  private metadataPage(hidden=false){return this.metadataView&&this.detail&&this.admin?<div key="metadata-page" className="media-metadata-host" hidden={hidden}><MediaMetadataPage key={this.detail.id} api={this.api} item={this.detail} initialView={this.metadataView} onViewChange={view=>this.openRoute(view==='edit'?'metadata':'match',{},this.detail?.id,true)} onUpdated={updated=>{this.detail=updated;this.draw();}} onBack={()=>this.closeMetadata()}/>{this.metadataView==='edit'&&<>{this.metadataEditionTools()}<ArtistInfo item={this.detail}/><VideoHierarchyEditor api={this.api} item={this.detail} onUpdated={updated=>{this.detail=updated;this.draw();}}/><MusicParentEditor api={this.api} item={this.detail} onUpdated={updated=>{this.detail=updated;this.draw();}}/></>}</div>:null;}
  private metadataEditionTools(){
    const item=this.detail,edition=item?.editions.find(entry=>entry.id===this.selectedEditionId)||item?.editions[0];
    return item&&edition?<EditionTools key={edition.id} api={this.api} item={item} edition={edition} busy={this.busy} onPlay={parts=>void this.run(()=>this.player.play(parts.map(part=>({part,title:item.title+' · '+part.title,video:this.channel==='video'})),0))} onQueue={ids=>void this.run(()=>this.enqueue(ids))} onUpdated={updated=>{this.detail=updated;this.draw();}} onAssigned={target=>this.navigate(this.channel,target.id)} onRename={label=>{edition.label=label;this.draw();}}/>:null;
  }
  private openMetadata(view:MetadataView){if(this.routing?.navigateRoute){this.openRoute(view==='edit'?'metadata':'match',{},this.detail?.id);return;}this.metadataScroll=this.element.scrollTop;this.metadataView=view;this.draw();this.element.scrollTop=0;this.element.querySelector<HTMLButtonElement>('.media-back-button')?.focus({preventScroll:true});}
  private closeMetadata(){if(this.routing?.back){this.routing.back();return;}const view=this.metadataView;this.metadataView=null;this.draw();this.element.scrollTop=this.metadataScroll;this.element.querySelector<HTMLButtonElement>(view==='edit'?'[aria-label="管理元数据"]':'.media-metadata-entries button:last-child')?.focus({preventScroll:true});}
  private openChapters(){if(this.routing?.navigateRoute){this.openRoute('chapters',{edition:this.selectedEditionId},this.detail?.id);return;}this.chapterNotice='';this.detailScroll=this.element.scrollTop;this.chaptersOpen=true;this.chapterPosition={query:'',page:0};this.draw();this.element.scrollTop=0;this.element.querySelector<HTMLButtonElement>('.media-back-button')?.focus({preventScroll:true});}
  private closeChapters(){if(this.routing?.back){this.routing.back();return;}this.chaptersOpen=false;this.draw();this.element.scrollTop=this.detailScroll;this.element.querySelector<HTMLButtonElement>('[aria-label="全部章节"]')?.focus({preventScroll:true});}
  private chaptersView(detail:Detail){return <><header className="media-heading"><div className="media-page-heading"><button className="media-back-button" aria-label="返回作品详情" onClick={()=>this.closeChapters()}><ChevronLeft size={20} aria-hidden="true"/></button><h1>章节列表</h1></div></header><AudiobookChapters api={this.api} item={detail} editionId={this.selectedEditionId} currentPartId={this.player.currentPartId} busy={this.busy} onEditionChange={id=>{this.selectedEditionId=id;this.chapterPosition={query:'',page:0};if(this.routing?.navigateRoute){this.syncLocation('chapters',{edition:id},this.detail?.id,true);return;}this.draw();}} onPlay={(parts,index)=>void this.run(()=>this.player.play(parts.map(part=>({part,title:detail.title+' · '+part.title,video:false})),index))} onQueue={ids=>void this.run(async()=>{this.chapterNotice='';try{await this.api.request('queue','POST',{partIds:ids});this.chapterNotice='已加入待播队列。';}catch(error){throw new Error((error instanceof Error?error.message:'添加失败')+' 请先核对待播队列再重新添加。');}})} onRefresh={()=>void this.run(async()=>{this.detail=await this.api.detail(detail.id,this.abort.signal);})} position={this.chapterPosition} onPositionChange={position=>{this.chapterPosition=position;if(this.routing?.navigateRoute){this.syncLocation('chapters',{edition:this.selectedEditionId,q:position.query,offset:String(position.page)},this.detail?.id,true);return;}this.draw();}}/>{this.chapterNotice&&<p role="status">{this.chapterNotice}</p>}{this.error&&<MediaScreenError error={this.errorCause} message={this.error} busy={this.busy} onRetry={()=>void this.run(async()=>{this.detail=await this.api.detail(detail.id,this.abort.signal);})}/>}</>;}
  private openManagerTasks(id=this.jobLibraryId){if(this.routing?.navigateRoute){this.openRoute('settings/tasks',{job:id},undefined,this.page==='settings/tasks');return;}if(this.routing&&this.page!=='settings/tasks'){this.jobLibraryId=id;this.goPage('settings/tasks');return;}this.managing=true;this.managerTab='tasks';this.settingsOpen=false;this.draw();void this.run(()=>this.loadJobs(id));}
  private manager(){return <section className="media-manager">

    {this.managerTab==='libraries'?<>
        <div className="media-manager-toolbar"><span>本地媒体库 · {this.allLibraries.length} 个</span><button className="media-primary" onClick={()=>{if(this.routing?.navigateRoute){this.openRoute('library-new');return;}this.createReturnToManager=true;this.managing=false;this.creatingLibrary=true;this.draw();}}><Plus size={16} aria-hidden="true"/>新建媒体库</button></div>
        <MediaLibraryList api={this.api} libraries={this.allLibraries} busy={this.busy} position={this.libraryManagerPosition} onPosition={position=>{this.libraryManagerPosition=position;this.draw();}} onEdit={library=>{if(this.routing?.navigateRoute){this.openRoute('library-edit',{library:library.id});return;}this.renaming=library;this.draw();}} onScan={id=>{this.goPage('settings/tasks');void this.scan(id);}} onJobs={id=>this.openManagerTasks(id)} onPermissions={library=>void this.permissions(library)}/>
        {!this.allLibraries.length&&<p className="media-manager-note">尚未添加媒体库，从上方新建并连接服务器目录。</p>}
        <p className="media-manager-note">扫描只读取原始目录。封面、索引和刮削缓存保存在应用数据目录。</p>
    </>:<>
      <nav className="media-task-tabs" aria-label="任务类型"><button aria-current={this.taskTab==='media'?'page':undefined} onClick={()=>{this.taskTab='media';this.draw();}}>媒体库扫描</button><button aria-current={this.taskTab==='ai'?'page':undefined} onClick={()=>{this.taskTab='ai';this.draw();}}>AI 扫描</button><button aria-current={this.taskTab==='scrape'?'page':undefined} onClick={()=>{this.taskTab='scrape';this.draw();}}>刮削</button></nav>
      {this.taskTab==='media'?<>
        <div className="media-manager-toolbar"><span>扫描所有媒体库并建立索引</span><button disabled={this.busy||!this.allLibraries.length||this.jobState!=='ready'} onClick={()=>void this.scanAll()}>扫描所有媒体库</button></div>{this.scanNotice&&<p className="media-manager-note" role="status">{this.scanNotice}</p>}
        {this.scanActionError&&<div className="media-error" role="alert"><p>{this.scanActionError}</p><button disabled={this.busy} onClick={()=>void this.run(async()=>{await this.loadJobs(this.jobLibraryId);this.scanActionError='';})}>重新核对任务</button></div>}
        <div className="media-task-library"><label>媒体库<MediaSelect aria-label="扫描媒体库" value={this.jobLibraryId} disabled={this.busy||!this.allLibraries.length} onChange={event=>this.openManagerTasks(event.currentTarget.value)}><option value="">全部媒体库 · 最新任务</option>{this.allLibraries.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</MediaSelect></label><button disabled={this.busy||!this.jobLibraryId} onClick={()=>void this.scan(this.jobLibraryId)}><RefreshCw size={16} aria-hidden="true"/>扫描当前库</button><button disabled={this.busy} onClick={()=>void this.run(()=>this.loadJobs(this.jobLibraryId))} aria-label="刷新扫描任务" title="刷新扫描任务"><RefreshCw size={16} aria-hidden="true"/></button></div>
        <h2 className="media-task-section-title">媒体库扫描历史{this.jobLibraryId?' · '+this.allLibraries.find(l=>l.id===this.jobLibraryId)?.name:''}</h2>
        {this.jobState==='loading'&&!this.busy&&<FloatingNotice message="正在读取扫描任务…" busy/>}{this.jobState==='error'&&<div className="media-error" role="alert"><p>{this.jobError}</p><button disabled={this.busy} onClick={()=>void this.run(()=>this.loadJobs(this.jobLibraryId))}>重试读取扫描任务</button></div>}{this.jobState==='ready'&&this.jobs.length===0&&<p>暂无媒体库扫描历史。</p>}
        <ScanJobs key={this.jobLibraryId} jobs={this.jobs} libraries={this.allLibraries} libraryName={this.allLibraries.find(l=>l.id===this.jobLibraryId)?.name||'媒体库'} busy={this.busy||this.jobState!=='ready'} onRetry={id=>void this.scan(id||this.jobLibraryId)} onCancel={id=>void this.run(async()=>{await this.api.request('jobs/'+id+'/cancel','POST');await this.loadJobs(this.jobLibraryId);})} onDelete={id=>void this.run(async()=>{await this.api.request('scan-jobs/'+id,'DELETE');await this.loadJobs(this.jobLibraryId);})}/>
      </>:this.taskTab==='ai'?<>
        <div className="media-manager-toolbar"><span>AI 识别媒体类型</span><button disabled={this.busy||!this.jobLibraryId} onClick={()=>void this.startAiScan(this.jobLibraryId)}>AI 扫描当前库</button><button disabled={this.busy||!this.allLibraries.length} onClick={()=>void this.startAiScan()}>AI 扫描所有媒体库</button></div>{this.scanNotice&&<p className="media-manager-note" role="status">{this.scanNotice}</p>}
        <div className="media-task-library"><label>媒体库<MediaSelect aria-label="AI 扫描媒体库" value={this.jobLibraryId} disabled={this.busy||!this.allLibraries.length} onChange={event=>{this.jobLibraryId=event.currentTarget.value;void this.loadAiJobs();}}><option value="">全部媒体库</option>{this.allLibraries.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</MediaSelect></label></div>
        <h2 className="media-task-section-title">AI 扫描历史</h2><AiScanJobs api={this.api} jobs={this.aiJobs} libraries={this.allLibraries} busy={this.busy} onRefresh={()=>void this.loadAiJobs()} onDelete={id=>void this.run(async()=>{await this.api.deleteAiScanJob(id);await this.loadAiJobs();})}/>
      </>:<>
        <div className="media-manager-toolbar"><span>在线匹配媒体信息</span></div>
        <div className="media-manager-scraping"><ScrapeJobs api={this.api} libraries={this.allLibraries} navigate={this.navigate}/></div>
      </>}
      {this.taskTab!=='scrape'&&<p className="media-manager-note">目录不可访问时保留原有资料。扫描与在线匹配分开执行，匹配失败不影响本地播放。</p>}
    </>}
  </section>;}
  private async permissions(lib:Library){if(this.routing?.navigateRoute){this.openRoute('library-permissions',{library:lib.id});return;}this.permissionLibrary=lib;this.draw();}
  private permissionsView(){const lib=this.permissionLibrary!;return <MediaPermissions key={lib.id} api={this.api} library={lib} onSaved={access=>{lib.access=access;this.permissionLibrary=null;if(this.routing?.back){this.routing.back();return;}this.draw();}} onCancel={()=>{this.permissionLibrary=null;if(this.routing?.back){this.routing.back();return;}this.draw();}}/>;}
  private utilityPage(hidden=false){
    const content=this.settingsOpen?<MediaSettings theme={this.theme.current} onThemeChange={value=>this.theme.set(value)} panel={settingsPanel(this.page)??'home'} onPanelChange={panel=>{if(panel==='home'&&this.routing?.back){this.backPage();return;}this.goPage(panel==='home'?'settings':`settings/${panel}`,false,panel==='home');}} channelLabel={labels[this.channel]} scope={this.api.preferenceScope()} preferences={this.preferences} player={this.player} admin={this.admin} api={this.api} account={this.api.accountInfo?.()} onSaved={value=>{this.preferences=value;this.draw();}} onBack={this.backPage} onPersonal={view=>this.goPage(view,true)} onTasks={()=>this.goPage('settings/tasks')} onManage={()=>this.goPage('settings/libraries')} onPlayback={this.openPlayback}/>:this.permissionLibrary?this.permissionsView():this.renaming?<MediaLibraryEditor key={this.renaming.id} api={this.api} library={this.renaming} onSaved={updated=>{const library=this.allLibraries.find(item=>item.id===updated.id);if(library)Object.assign(library,updated);this.renaming=null;if(this.routing?.back){this.routing.back();return;}this.draw();}} onCancel={()=>{this.renaming=null;if(this.routing?.back){this.routing.back();return;}this.draw();}}/>:this.creatingLibrary?this.createLibraryView():null;
    return content?<div key="media-utility" className="media-utility-host" hidden={hidden}>{content}</div>:null;
  }
  private emptyLibrary(){if(this.libraries.length&&this.kind==='track'&&(this.trackFilters.artist||this.trackFilters.album))return <section className="media-library-empty" aria-label="曲目筛选无结果"><SlidersHorizontal size={30} aria-hidden="true"/><h2>没有符合筛选的曲目</h2><p>调整艺人或专辑条件后再试。</p><button onClick={()=>{const panel=this.element.querySelector<HTMLDetailsElement>('.media-track-filters');if(panel){panel.open=true;panel.querySelector<HTMLInputElement>('input')?.focus();}}}>调整筛选</button></section>;return <EmptyMediaLibrary channel={this.channel} hasLibraries={this.libraries.length>0} admin={this.admin} category={this.kind==='video'?'影视内容':kinds[this.channel].find(([kind])=>kind===this.kind)?.[1]||'内容'} onCreate={()=>{if(this.routing?.navigateRoute){this.openRoute('library-new');return;}this.createReturnToManager=false;this.creatingLibrary=true;this.draw();}} onManage={()=>this.goPage('settings/libraries')}/>;}
  private librarySelector(){return <label className="media-library-filter"><MediaSelect variant="plain" aria-label="媒体库" disabled={this.busy} value={this.libraryId} onChange={e=>{this.libraryId=e.currentTarget.value;if(this.routing?.navigateRoute&&this.page){this.syncLocation(this.page,{library:this.libraryId},'',true);return;}this.folderLocation=undefined;if(!this.libraryId)this.foldersOpen=false;this.offset=0;void this.run(()=>this.load());}}><option value="">全部媒体库</option>{this.libraries.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</MediaSelect></label>;}
  private createLibraryView(){return <section className="media-library-onboarding"><MediaLibraryCreate api={this.api} channel={this.channel} disabled={this.busy} onCancel={()=>{if(this.routing?.back){this.routing.back();return;}this.creatingLibrary=false;this.managing=this.createReturnToManager;this.draw();}} onCreated={library=>{this.allLibraries.push(library);if(library.kind===this.channel){this.libraries.push(library);this.libraryId=library.id;}this.draw();}} onJobs={async id=>{this.jobLibraryId=id;this.creatingLibrary=false;this.goPage('settings/tasks');}}/></section>;}
  private browseView(){if(!this.libraries.length)return !this.busy&&!this.error?this.emptyLibrary():null;return <>
    {!this.catalogLoading&&!this.catalogFailed&&this.preferences.showContinue&&!this.player.active&&!this.foldersOpen&&['video','album','audiobook'].includes(this.kind)&&this.offset===0&&<ContinuePlaying key={this.libraryId} api={this.api} libraryId={this.libraryId} libraryIds={this.libraries.map(l=>l.id)} onPlay={(parts,index,title)=>this.player.play(parts.map(part=>({part,title:title+' · '+part.title,video:this.channel==='video'})),index)}/>}
    {this.kind!=='narrator'&&(!this.foldersOpen||this.libraries.length>1)&&<div className="media-toolbar media-browse-tools">{this.librarySelector()}{!this.foldersOpen&&<span>{this.catalogLoading?'读取中…':this.catalogFailed?'':this.total+' '+({track:'首曲目',album:'张专辑',artist:'位歌手',audiobook:'部有声书',series:'部剧集',movie:'部电影'}[this.kind]||'项')}</span>}<div className="media-browse-actions">{!this.foldersOpen&&<><button aria-label="文件夹" title="按文件夹浏览" onClick={()=>{if(this.routing?.navigateRoute){this.openRoute('folders',{library:this.libraryId});return;}this.folderLocation=undefined;this.foldersOpen=true;void this.run(()=>this.load());}}><Folder size={18} aria-hidden="true"/></button>
      <details className={this.kind==='track'?'media-browse-filters media-track-filters':'media-browse-filters'}><summary aria-label="筛选与排序" title="筛选与排序"><SlidersHorizontal size={18} aria-hidden="true"/>{(this.trackSort!=='default'||this.kind==='track'&&(this.trackFilters.artist||this.trackFilters.album))&&<i aria-label="已应用筛选"/>}</summary><div className="media-browse-filter-panel"><label>{this.kind==='track'?'曲目排序':'排序'}<MediaSelect aria-label={this.kind==='track'?'曲目排序':'内容排序'} value={this.trackSort} disabled={this.busy} onChange={event=>{this.trackSort=event.currentTarget.value;this.offset=0;void this.run(()=>this.load());}}><option value="default">默认顺序</option><option value="title-asc">名称升序</option><option value="title-desc">名称降序</option></MediaSelect></label>
      {this.kind==='track'&&<form className="media-form" onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);this.trackFilters={artist:String(data.get('artist')||'').trim(),album:String(data.get('album')||'').trim()};this.offset=0;void this.run(()=>this.load());}}><label>艺人包含<input name="artist" maxLength={200} defaultValue={this.trackFilters.artist} disabled={this.busy}/></label><label>专辑包含<input name="album" maxLength={200} defaultValue={this.trackFilters.album} disabled={this.busy}/></label><div><button disabled={this.busy}>应用筛选</button><button type="button" disabled={this.busy} onClick={event=>{this.trackFilters={artist:'',album:''};const form=event.currentTarget.form;if(form){(form.elements.namedItem('artist') as HTMLInputElement).value='';(form.elements.namedItem('album') as HTMLInputElement).value='';}this.offset=0;void this.run(()=>this.load());}}>清除筛选</button></div></form>}</div></details>
    </>}</div></div>}
    {this.foldersOpen&&this.libraryId?<MediaFolders video={this.channel==='video'} admin={this.admin} {...(this.routing?.back?{onBack:this.routing.back}:{})} key={this.location?routeHash(this.location):this.libraryId} onLocationChange={location=>{this.folderLocation=location;this.syncLocation(location.assetId?'file':'folders',{library:this.libraryId,path:location.path,offset:String(location.offset),asset:location.assetId??''},'',true);}} api={this.api} libraryId={this.libraryId} initialLocation={this.folderLocation} onDetail={(id,location)=>this.openFolderDetail(id,location)} onPlay={(parts,index,title)=>this.player.play(parts.map(part=>({part,title:title+' · '+part.title,video:this.channel==='video'})),index)} onQueue={async ids=>{await this.api.request('queue','POST',{partIds:ids});}}/>:this.foldersOpen?<section aria-label="选择文件夹媒体库"><p>选择要浏览的媒体库</p>{this.libraries.map(l=><div className="media-row" key={l.id}><button onClick={()=>{this.libraryId=l.id;if(this.routing?.navigateRoute){this.syncLocation('folders',{library:l.id},'',true);return;}this.draw();}}>{l.name}</button></div>)}</section>:this.kind==='narrator'&&this.libraries.length>0?<Narrators {...(this.routing?.back?{onBack:this.routing.back}:{})} key={this.location?routeHash(this.location):this.libraryId} {...(this.narratorLocation?{initialLocation:this.narratorLocation}:{})} onLocationChange={location=>{this.narratorLocation=location;this.syncLocation(location.workId?'narrator-work':location.name?'narrator':'narrators',{library:location.libraryId,narrator:location.name??'',q:location.search,offset:String(location.offset),work:location.workId,edition:location.editionId});}} libraryControl={this.librarySelector()} showLibraryName={this.preferences.showLibraryName} api={this.api} libraryId={this.libraryId} onDetail={id=>this.openNarratorDetail(id)} onPlay={(parts,index,title)=>this.player.play(parts.map(part=>({part,title:title+' · '+part.title,video:false})),index)} onQueue={async ids=>{await this.api.request('queue','POST',{partIds:ids});}}/>:<>{this.catalogLoading?<MediaLoading layout={this.kind==='track'?'list':'grid'} square={this.channel==='music'}/>:this.catalogFailed?null:this.items.length?(this.channel=== 'music' &&this.kind=== 'track' ?this.trackList(this.items):this.grid(this.items)):!this.busy&&!this.error&&this.emptyLibrary()}
    {!this.catalogLoading&&!this.catalogFailed&&this.total>60&&<div className="media-toolbar"><button disabled={this.offset===0||this.busy} onClick={()=>{this.offset=Math.max(0,this.offset-60);void this.run(()=>this.load());}}>上一页</button><span>{Math.floor(this.offset/60)+1} / {Math.ceil(this.total/60)}</span><button disabled={this.offset+60>=this.total||this.busy} onClick={()=>{this.offset+=60;void this.run(()=>this.load());}}>下一页</button></div>}
    </>}
  </>;}
  private closeSearch(){if(this.routing?.back){this.routing.back();return;}clearSearchReturn(this.api);this.searchOpen=false;this.query='';this.offset=0;void this.run(()=>this.load());}
  private draw=()=>{if(this.disposed)return;if(this.player.videoControlsHost)render(this.playbackView&&this.player.active&&this.player.isWebVideo?<VideoControls player={this.player} api={this.api} onBack={this.closePlayback}/>:null,this.player.videoControlsHost);this.updateAudioLayout();this.element.classList.toggle('media-density-comfortable',this.preferences.density==='comfortable');if(this.playbackView&&!this.player.active&&!this.routing?.navigateRoute){this.closePlayback();return;}this.element.classList.toggle('media-secondary-page',!!(this.page&&!categoryKinds[this.page]||this.personal||this.managing||this.foldersOpen||this.itemId||this.searchOpen));this.element.classList.toggle('media-manager-workspace',this.managing&&!this.settingsOpen&&!this.permissionLibrary&&!this.renaming&&!this.creatingLibrary&&!this.playbackView);this.element.classList.toggle('media-utility-workspace',!!(this.settingsOpen||this.permissionLibrary||this.renaming||this.creatingLibrary)&&!this.playbackView);this.element.classList.toggle('media-metadata-workspace',!!this.metadataView&&!this.playbackView);this.element.classList.toggle('media-chapters-page',this.chaptersOpen&&!this.playbackView);this.element.classList.toggle('media-playback-page',this.playbackView);this.element.classList.toggle('media-video-page',this.playbackView&&this.player.isWebVideo);if(this.playbackView){render(<>{this.metadataPage(true)}{this.utilityPage(true)}{this.player.isWebVideo&&<header className="media-heading"><button className="media-back-button" aria-label={this.playbackPanel==='main'?'← 返回浏览':'← 返回播放'} title={this.playbackPanel==='main'?'返回浏览':'返回播放'} onClick={this.backFromPlayback}><ChevronLeft size={20} aria-hidden="true"/></button><strong>视频播放</strong></header>}{this.playbackRestoring?<MediaLoading label="正在恢复播放…" layout="detail"/>:this.playbackRestoreError?<MediaScreenError fullPage error={this.playbackRestoreError} message={this.playbackRestoreError instanceof Error?this.playbackRestoreError.message:'无法恢复播放'} busy={false} onRetry={()=>{if(this.location)void this.showRoute(this.location);}} onBack={this.closePlayback} backLabel="返回浏览"/>:this.player.active&&this.player.isWebVideo?null:this.player.active?<PlaybackControls player={this.player} api={this.api} onBack={this.backFromPlayback} onFavoriteChange={this.onPlaybackFavorite} panel={this.playbackPanel} onPanelChange={panel=>{if(this.routing?.navigateRoute){this.openRoute(panel==='main'?'player':`player/${panel}`,{},this.itemId);return;}this.playbackPanel=panel;this.draw();this.element.scrollTop=0;}}/>:<div className="media-empty"><p>当前没有播放内容。</p><button onClick={this.closePlayback}>选择作品</button></div>}</>,this.element);return;}if(this.chaptersOpen&&this.detail){render(this.chaptersView(this.detail),this.element);return;}if(this.metadataView&&this.detail&&this.admin){render(<>{this.metadataPage()}</>,this.element);return;}if(this.settingsOpen||this.permissionLibrary||this.renaming||this.creatingLibrary){render(<>{this.utilityPage()}</>,this.element);return;}const pageLoading=this.busy&&!this.personal&&!this.managing&&(!this.librariesLoaded||!!this.itemId&&!this.detail);const fullError=!!this.error&&(this.personal?this.personalFailed:!this.managing&&(!this.librariesLoaded||!!this.itemId&&!this.detail||this.catalogFailed));const browsing=!this.itemId&&!this.settingsOpen&&!this.personal&&!this.permissionLibrary&&!this.managing&&!this.detail&&!this.creatingLibrary&&!this.foldersOpen;render(<><header className="media-heading">{browsing&&!this.searchOpen&&<span className="media-mobile-title"><ChannelSwitcher current={this.channel} label={labels[this.channel]}/></span>}{browsing&&!this.searchOpen?<nav hidden={(!this.libraries.length&&this.librariesLoaded)||fullError} className="media-tabs" aria-label={labels[this.channel]+'分类'}>{kinds[this.channel].map(([kind,label])=><button key={kind} aria-current={kind===this.kind?'page':undefined} disabled={this.busy} onClick={()=>{if(this.routing?.navigateRoute){this.openRoute(Object.entries(categoryKinds).find(([,value])=>value===kind)?.[0] as MediaPage|undefined,{library:this.libraryId});return;}this.kind=kind;this.foldersOpen=false;this.offset=0;void this.run(()=>this.load());}}>{label}</button>)}</nav>:this.personal?<div className="media-page-heading"><button className="media-back-button" title={this.fromSettings?'返回影音设置':'返回'+labels[this.channel]} aria-label="← 返回" onClick={()=>this.leavePersonal()}><ChevronLeft size={20} aria-hidden="true"/></button><h1>{this.personal==='favorites'?'我的收藏':this.personal==='history'?'播放历史':'待播队列'}</h1>{this.personal!=='favorites'&&<span className="media-page-context">{labels[this.channel]}</span>}</div>:this.managing?<div className="media-page-heading"><button className="media-back-button" aria-label="返回影音设置" onClick={this.backPage}><ChevronLeft size={20} aria-hidden="true"/></button><h1>{this.managerTab==='tasks'?'扫描与刮削':'媒体库管理'}</h1></div>:this.creatingLibrary?<div className="media-page-heading"><button className="media-back-button" aria-label="← 返回内容" onClick={()=>{this.creatingLibrary=false;void this.run(()=>this.load());}}><ChevronLeft size={20} aria-hidden="true"/></button><h1>新建{labels[this.channel]}媒体库</h1></div>:this.foldersOpen?<div className="media-page-heading"><button className="media-back-button" aria-label="返回分类" onClick={()=>{if(this.routing?.back){this.routing.back();return;}this.foldersOpen=false;void this.run(()=>this.load());}}><ChevronLeft size={20} aria-hidden="true"/></button><h1>文件夹浏览</h1></div>:this.itemId&&!this.detail&&fullError?<div className="media-page-heading"><button className="media-back-button" aria-label="返回频道" onClick={()=>this.navigate(this.channel)}><ChevronLeft size={20} aria-hidden="true"/></button><h1>{this.errorCause instanceof ApiError&&this.errorCause.kind==='forbidden'?'无访问权限':'内容不可用'}</h1></div>:this.detail?<div className="media-page-heading"><button className="media-back-button" aria-label="← 返回" onClick={()=>this.backFromDetail(this.detail!)}><ChevronLeft size={20} aria-hidden="true"/></button><h2>{this.detail.editions.length>0&&this.detail.editions.every(e=>e.parts.length>0&&e.parts.every(p=>!p.available))?'文件暂不可用':mediaDetailLabel(this.detail.kind)}</h2></div>:this.searchOpen?<div className="media-page-heading"><button className="media-back-button" aria-label="返回搜索来源" onClick={()=>this.closeSearch()}><ChevronLeft size={20} aria-hidden="true"/></button><h1>搜索</h1></div>:<strong>{labels[this.channel]}</strong>}<div className="media-heading-actions" hidden={!!(this.personal||this.managing)}>{browsing&&!this.searchOpen&&<button className="media-icon-button" aria-label="搜索影音" title="搜索" onClick={()=>{if(this.routing?.navigateRoute){this.openRoute('search');return;}this.searchOpen=true;this.error='';this.errorCause=undefined;this.draw();this.element.querySelector<HTMLInputElement>('.media-search input')?.focus();}}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg></button>}{this.searchOpen?null:this.detail?this.detailMenu():browsing?<details className="media-actions"><summary aria-label="更多影音操作"><Ellipsis size={20} aria-hidden="true"/></summary><nav aria-label="影音操作"><button onClick={()=>this.goPage('settings')}>影音设置</button>{(['favorites','history','queue'] as const).map(view=><button key={view} disabled={this.busy} onClick={()=>this.goPage(view)}>{{favorites:'收藏',history:'历史',queue:'队列'}[view]}</button>)}{this.admin&&<button onClick={()=>this.goPage('settings/libraries')}>{this.managing?'返回内容':'媒体库管理'}</button>}</nav></details>:null}</div></header>{this.error&&<MediaScreenError fullPage={fullError} error={this.errorCause} message={this.error} busy={this.busy} onRetry={()=>this.retryScreen()} backLabel={this.folderReturn()?.itemId===this.itemId?'返回文件列表':'返回'+labels[this.channel]} onBack={this.itemId&&!this.detail?()=>{if(!this.backToFolder())this.navigate(this.channel);}:undefined}/>}{pageLoading?<MediaLoading layout={this.itemId?'detail':'grid'} square={this.channel==='music'} label={this.itemId?'正在读取作品资料…':'正在读取媒体库…'}/>:this.busy&&!this.catalogLoading&&!this.personalLoading&&<FloatingNotice message="正在处理…" busy/>}{this.personal?this.personalView():this.managing?this.manager():this.detail?this.detailView(this.detail):this.itemId||!this.librariesLoaded||fullError?null:<>{this.searchOpen?<MediaSearch key={this.location?routeHash(this.location):undefined} initialLocation={this.location?this.location.params??{}:undefined} onLocationChange={params=>this.syncLocation('search',params,'',true)} api={this.api} channel={this.channel} navigate={this.navigate}/>:this.browseView()}</>}
    </>,this.element);
  };
  dispose(){this.disposed=true;this.playbackRestore?.abort();this.theme.dispose();cancelAnimationFrame(this.layoutFrame);this.playerSize?.disconnect();window.removeEventListener('resize',this.updateAudioLayout);document.removeEventListener('keydown',this.dismissMenus,true);document.removeEventListener('click',this.dismissMenus,true);document.removeEventListener('keydown',this.onKeyDown);this.abort.abort();if(this.poll)clearTimeout(this.poll);this.player.removeEventListener('change',this.onPlayerChanged);this.player.removeEventListener('open-controls',this.openPlayback);this.player.setControlsExpanded(false);if(this.player.videoControlsHost)render(null,this.player.videoControlsHost);render(null,this.element);}
}
