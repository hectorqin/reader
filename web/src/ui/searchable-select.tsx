import {useEffect,useMemo,useRef,useState} from './vendor/preact.ts';
import type {JSX} from './vendor/preact.ts';
import {ChevronDown,Check,Search} from 'lucide-preact';

export interface SearchableSelectOption { value:string; label:string }
export function SearchableSelect({label,value,options,disabled,onChange}:{label:string;value:string;options:SearchableSelectOption[];disabled?:boolean;onChange:(value:string)=>void}):JSX.Element {
  const [open,setOpen]=useState(false),[query,setQuery]=useState('');
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!open)return;const close=(event:MouseEvent)=>{if(!ref.current?.contains(event.target as Node))setOpen(false)};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[open]);
  const selected=options.find(option=>option.value===value), filtered=useMemo(()=>{const text=query.trim().toLocaleLowerCase();return text?options.filter(option=>option.label.toLocaleLowerCase().includes(text)):options},[options,query]);
  return <div className="searchable-select" ref={ref}>
    <span className="searchable-select-label">{label}</span>
    <select aria-label={label} className="searchable-select-native" value={value} disabled={disabled} onChange={event=>onChange(event.currentTarget.value)}>{!options.some(option=>option.value==='')&&<option value="" disabled>请选择一个来源</option>}{options.map(option=><option value={option.value}>{option.label}</option>)}</select>
    <button type="button" className="searchable-select-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={()=>{setOpen(!open);setQuery('')}}>
      <span>{selected?.label??label}</span><ChevronDown size={16} aria-hidden="true"/>
    </button>
    {open&&<div className="searchable-select-menu" role="listbox" aria-label={label}>
      <label className="searchable-select-search"><Search size={14} aria-hidden="true"/><input autoFocus type="search" value={query} placeholder="搜索选项" aria-label={`搜索${label}`} onInput={event=>setQuery(event.currentTarget.value)}/></label>
      <div className="searchable-select-options">{filtered.length?filtered.map(option=><button type="button" role="option" aria-selected={option.value===value} key={option.value} onClick={()=>{onChange(option.value);setOpen(false)}}><span>{option.label}</span>{option.value===value&&<Check size={15} aria-hidden="true"/>}</button>):<p>没有匹配选项</p>}</div>
    </div>}
  </div>;
}
