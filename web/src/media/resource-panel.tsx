import {useEffect,useRef,useState,type ComponentChildren} from '../ui/vendor/preact.ts';
import {Ellipsis,FileText,Layers} from 'lucide-preact';
import {Modal} from '../ui/modal.tsx';
import {ResourceInfo} from './resource-info.tsx';
import {EditionTools,type EditionDetailsProps} from './edition-details.tsx';
import type {MediaApi} from './api.ts';

export function ResourcePanel({api,assets,summary,editionOptions,versionPicker}:{api:MediaApi;assets:Array<{id:string;title:string}>;summary:string;versionPicker?:ComponentChildren;editionOptions?:EditionDetailsProps|undefined}){
  const [panel,setPanel]=useState<'files'|'versions'|null>(null),menu=useRef<HTMLDetailsElement>(null);
  const files=[...new Map(assets.map(asset=>[asset.id,asset])).values()];
  const manage=!!(editionOptions?.onUpdated||editionOptions?.onAssigned||editionOptions?.onRename);
  useEffect(()=>{const close=(event:PointerEvent)=>{if(menu.current&&!menu.current.contains(event.target as Node))menu.current.open=false;};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[]);
  function open(value:'files'|'versions'){if(menu.current){menu.current.open=false;menu.current.querySelector('summary')?.focus();}setPanel(value);}
  function close(){setPanel(null);menu.current?.querySelector('summary')?.focus();}
  return <section className="media-resource-panel" onClick={event=>{if(event.target instanceof HTMLDialogElement&&!editionOptions?.busy){const rect=event.target.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();}}}><header><h2>资源信息</h2>{(files.length>0||manage||versionPicker)&&<details className="media-actions" ref={menu} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();menu.current!.open=false;menu.current!.querySelector('summary')?.focus();}}}><summary aria-label="资源信息操作" title="资源信息操作"><Ellipsis size={19} aria-hidden="true"/></summary><nav aria-label="资源信息操作">{files.length>0&&<button onClick={()=>open('files')}><FileText size={16} aria-hidden="true"/>文件与技术信息</button>}{(manage||versionPicker)&&<button data-media-versions onClick={()=>open('versions')}><Layers size={16} aria-hidden="true"/>{manage?'版本管理':'播放版本'}</button>}</nav></details>}</header>
    <p>{summary}</p>
    {panel&&<Modal title={panel==='files'?'文件与技术信息':manage?'版本管理':'播放版本'} busy={!!editionOptions?.busy} onClose={close}><div className="media-resource-dialog">{panel==='files'?files.map(asset=><ResourceInfo key={asset.id} api={api} assetId={asset.id} title={asset.title} expanded/>):<>{versionPicker}{manage&&editionOptions&&<EditionTools {...editionOptions} managementOnly/>}</>}</div></Modal>}
  </section>;
}
