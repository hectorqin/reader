import {FloatingConfirm} from '../ui/floating-confirm.tsx';
import {useEffect,useRef,useState} from '../ui/vendor/preact.ts';
import {ChevronLeft} from 'lucide-preact';
import type {Detail,MediaApi} from './api.ts';
import {MetadataEditor,type MetadataEditState} from './metadata-editor.tsx';
import {MetadataMatcher} from './metadata-matcher.tsx';

export type MetadataView='edit'|'match';
export function MediaMetadataPage({api,item,initialView,onViewChange,onUpdated,onBack}:{api:MediaApi;item:Detail;initialView:MetadataView;onViewChange?:(view:MetadataView)=>void;onUpdated:(item:Detail)=>void;onBack:()=>void}){
  const [view,setView]=useState(initialView),[editState,setEditState]=useState<MetadataEditState>({dirty:false,busy:false}),[matching,setMatching]=useState(false);
  const [destination,setDestination]=useState<MetadataView|'back'|null>(null),[notice,setNotice]=useState('');
  const page=useRef<HTMLElement>(null),leaveNotice=useRef<HTMLElement>(null);
  useEffect(()=>{const screen=page.current?.closest('.media-screen');if(screen)screen.scrollTop=0;},[view]);
  useEffect(()=>{if(destination){leaveNotice.current?.scrollIntoView?.({block:'nearest'});leaveNotice.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});}},[destination]);
  useEffect(()=>setView(initialView),[initialView]);
  const busy=editState.busy||matching;
  const navigate=(next:MetadataView|'back')=>{setDestination(null);setNotice('');setEditState({dirty:false,busy:false});if(next==='back')onBack();else {setView(next);onViewChange?.(next);}};
  const requestLeave=(next:MetadataView|'back')=>{if(busy)return;if(view==='edit'&&editState.dirty)setDestination(next);else navigate(next);};
  return <><header className="media-heading"><div className="media-page-heading"><button className="media-back-button" aria-label="返回作品详情" disabled={busy} onClick={()=>requestLeave('back')}><ChevronLeft size={20} aria-hidden="true"/></button><h1>{view==='edit'?'元数据':'匹配作品'}</h1></div><button className="media-metadata-mode" disabled={busy} onClick={()=>requestLeave(view==='edit'?'match':'edit')}>{view==='edit'?'在线匹配':'手动编辑'}</button></header>
    <article className="media-metadata-page" data-view={view} ref={page}>
      {destination&&<FloatingConfirm theme="media" title="放弃未保存的修改？" text="离开后本次修改会丢失，已保存的资料不受影响。" confirmText="放弃修改并离开" cancelText="继续编辑" onCancel={()=>setDestination(null)} onConfirm={()=>navigate(destination)}/>}
      {notice&&<p role="status" className="media-metadata-notice">{notice}</p>}
      {view==='edit'?<MetadataEditor api={api} item={item} onStateChange={setEditState} onUpdated={updated=>{setNotice('已保存修改。');onUpdated(updated);}}/>:<MetadataMatcher api={api} item={item} layout="page" onBusyChange={setMatching} onUpdated={updated=>{setNotice('在线匹配已更新，人工修正已保留。');onUpdated(updated);}}/>}
    </article>
  </>;
}
