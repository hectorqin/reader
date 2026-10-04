import { render } from '../../../shared/ui/render-root.ts';
import { BookOpen, Clapperboard, Music2, Headphones, ChevronsUpDown, Check } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

const channels = [
    { id: '', label: '阅读', icon: BookOpen },
    { id: 'video', label: '影视', icon: Clapperboard },
    { id: 'music', label: '音乐', icon: Music2 },
    { id: 'audiobook', label: '有声书', icon: Headphones },
  ];
export function ChannelSwitcher({current,label}:{current:string;label?:string}) {
  const root=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{const close=(event:PointerEvent)=>{if(root.current&&!root.current.contains(event.target as Node))root.current.open=false;};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[]);
  return <details className="media-channel-switcher" ref={root} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();root.current!.open=false;root.current!.querySelector('summary')?.focus();}}}>
    <summary aria-label="切换频道" title="切换频道">{label&&<strong>{label}</strong>}<ChevronsUpDown size={18} aria-hidden="true"/></summary>
    <nav aria-label="切换内容频道">{channels.map(({id,label,icon:Icon})=><a key={id} href={id?'#/media/'+id:'#/shelf'} aria-current={id===current?'page':undefined} onClick={()=>{if(root.current)root.current.open=false;}}><Icon size={18} aria-hidden="true"/><span>{label}</span>{id===current&&<Check size={16} aria-hidden="true"/>}</a>)}</nav>
  </details>;
}
export function MediaChannelEntry({ current }: { current: string }) {
  return <nav className="media-channel-entry" aria-label="内容频道">
    <span className="media-brand" aria-hidden="true">reader.</span>{channels.map(({ id, label, icon: Glyph }) =>
      <Link key={id} to={id ? `/media/${id}` : '/shelf'} aria-current={current === id ? 'page' : undefined}>
        <span className="media-channel-icon"><Glyph size={22} strokeWidth={1.8} aria-hidden="true" /></span>
        <span>{label}</span>
      </Link>)}
  </nav>;
}
export function renderChannelLinks(element: HTMLElement, current: string) {
  render(<><span className="media-brand" aria-hidden="true">reader.</span>{channels.map(({ id, label, icon: Glyph }) =>
    <a key={id} href={id ? '#/media/' + id : '#/shelf'} aria-current={current === id ? 'page' : undefined}>
      <span className="media-channel-icon"><Glyph size={22} strokeWidth={1.8} aria-hidden="true" /></span>
      <span>{label}</span>
    </a>)}</>, element);
}
