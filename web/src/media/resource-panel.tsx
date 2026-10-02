import {useEffect,useRef,useState,type ComponentChildren} from '../ui/vendor/preact.ts';
import {Ellipsis,FileText,Layers} from 'lucide-preact';
import {Modal} from '../ui/modal.tsx';
import {ResourceInfo} from './resource-info.tsx';
import {EditionTools,type EditionDetailsProps} from './edition-details.tsx';
import type {MediaApi} from './api.ts';

export function ResourcePanel({api,assets,summary,editionOptions,versionPicker,sourceInfo,openPanel,onPanelChange}:{api:MediaApi;assets:Array<{id:string;title:string}>;summary:string;versionPicker?:ComponentChildren;sourceInfo?:ComponentChildren;openPanel?:'files'|'source'|null;onPanelChange?:(panel:'files'|'source'|null)=>void;editionOptions?:EditionDetailsProps|undefined}){
  const [panel,setPanel]=useState<'files'|'versions'|'source'|null>(null),menu=useRef<HTMLDetailsElement>(null);
  const files=[...new Map(assets.map(asset=>[asset.id,asset])).values()];
  const manage=!!(editionOptions?.onUpdated||editionOptions?.onAssigned||editionOptions?.onRename);
  useEffect(()=>{if(openPanel)setPanel(openPanel);},[openPanel]);
  useEffect(()=>{const close=(event:PointerEvent)=>{if(menu.current&&!menu.current.contains(event.target as Node))menu.current.open=false;};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[]);
  function open(value:'files'|'versions'|'source'){if(menu.current){menu.current.open=false;menu.current.querySelector('summary')?.focus();}setPanel(value);}
  function close(){setPanel(null);onPanelChange?.(null);menu.current?.querySelector('summary')?.focus();}
  return <>{panel&&<Modal className="media-modal" title={panel==='files'?'资源信息':panel==='source'?'来源':manage?'版本管理':'播放版本'} busy={!!editionOptions?.busy} onClose={close}><div className="media-resource-dialog">{panel==='files'?files.map(asset=><ResourceInfo key={asset.id} api={api} assetId={asset.id} title={asset.title} expanded/>):panel==='source'?sourceInfo:<>{versionPicker}{manage&&editionOptions&&<EditionTools {...editionOptions} managementOnly/>}</>}</div></Modal>}<section className="media-resource-panel media-resource-trigger media-resource-hidden" aria-hidden="true" onClick={event=>{if(event.target instanceof HTMLDialogElement&&!editionOptions?.busy){const rect=event.target.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();}}}><header><h2>资源信息</h2>{(files.length>0||manage||versionPicker||sourceInfo)&&<details className="media-actions" ref={menu} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();menu.current!.open=false;menu.current!.querySelector('summary')?.focus();}}}><summary aria-label="资源信息操作" title="资源信息操作"><Ellipsis size={19} aria-hidden="true"/></summary><nav aria-label="资源信息操作">{files.length>0&&<button onClick={()=>open('files')}><FileText size={16} aria-hidden="true"/>资源信息</button>}{(manage||versionPicker)&&<button data-media-versions onClick={()=>open('versions')}><Layers size={16} aria-hidden="true"/>{manage?'版本管理':'播放版本'}</button>}{sourceInfo&&<button onClick={()=>open('source')}><FileText size={16} aria-hidden="true"/>来源</button>}</nav></details>}</header><p>{summary}</p></section></> ;
}

