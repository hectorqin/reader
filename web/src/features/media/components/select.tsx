import type { SelectHTMLAttributes, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import {Check,ChevronDown} from 'lucide-react';
import './select.css';

type Choice={value:string;label:string;disabled:boolean;group:string};
type Props=Omit<SelectHTMLAttributes<HTMLSelectElement>,'ref'|'multiple'|'size'> & {
  variant?:'field'|'plain';
  controlRef?:{current:HTMLButtonElement|null};
};
let nextId=0;

/** Native form semantics with one themed, keyboard-accessible visual control. */
export function MediaSelect({variant='field',controlRef,...props}:Props){
  const native=useRef<HTMLSelectElement>(null),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),host=useRef<HTMLSpanElement>(null);
  const id=useRef('media-select-'+ ++nextId).current;
  const [choices,setChoices]=useState<Choice[]>([]),[selected,setSelected]=useState(''),[open,setOpen]=useState(false),[active,setActive]=useState(-1),[label,setLabel]=useState(''),[validation,setValidation]=useState('');
  const search=useRef({text:'',at:0});
  const defaultApplied=useRef(false);
  const {children,className,id:fieldId,onChange,onFocus,onInvalid,onClick,...attributes}=props;
  const supportsPopover=typeof HTMLElement!=='undefined'&&'showPopover' in HTMLElement.prototype;

  function sync(){
    const select=native.current;if(!select)return;
    const values=Array.from(select.options).filter(option=>!option.hidden).map(option=>({value:option.value,label:option.label,disabled:option.disabled||Boolean(option.closest('optgroup')?.disabled),group:option.closest('optgroup')?.label||''}));
    setChoices(current=>JSON.stringify(current)===JSON.stringify(values)?current:values);setSelected(select.value);
    if(!props['aria-label']&&!props['aria-labelledby']){
      const enclosing=host.current?.closest('label')?.cloneNode(true) as HTMLLabelElement|undefined;
      enclosing?.querySelector('.media-select-control')?.remove();setLabel(enclosing?.textContent?.trim()||String(props.name||'选择选项'));
    }
  }
  useLayoutEffect(()=>{
    const select=native.current;
    if(select&&!defaultApplied.current&&props.value===undefined&&props.defaultValue!==undefined&&select.options.length){
      for(const option of select.options)option.defaultSelected=option.value===String(props.defaultValue);
      select.value=String(props.defaultValue);defaultApplied.current=true;
    }
    sync();
  },[children,props.value,props.defaultValue]);
  useLayoutEffect(()=>{if(controlRef)controlRef.current=trigger.current;return()=>{if(controlRef)controlRef.current=null;};},[controlRef]);
  useLayoutEffect(()=>{if(props.disabled)setOpen(false);},[props.disabled]);

  function position(){
    const button=trigger.current,menu=panel.current;if(!button||!menu)return;
    const rect=button.getBoundingClientRect(),viewport=window.visualViewport;
    const left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0,width=viewport?.width||window.innerWidth,height=viewport?.height||window.innerHeight;
    const gap=6,edge=8,menuWidth=Math.min(Math.max(rect.width,192),width-edge*2);
    const below=top+height-rect.bottom-gap-edge,above=rect.top-top-gap-edge;
    const upwards=below<180&&above>below,space=Math.max(44,upwards?above:below);
    menu.style.width=menuWidth+'px';menu.style.maxHeight=Math.min(320,space)+'px';
    menu.style.left=Math.max(left+edge,Math.min(rect.left,left+width-menuWidth-edge))+'px';
    menu.style.top=(upwards?Math.max(top+edge,rect.top-gap-Math.min(menu.scrollHeight,320,space)):rect.bottom+gap)+'px';
  }
  useLayoutEffect(()=>{
    if(!open)return;
    const menu=panel.current;if(!menu)return;
    if(supportsPopover)menu.showPopover();position();
    const outside=(event:Event)=>{if(!host.current?.contains(event.target as Node))setOpen(false);};
    const close=()=>setOpen(false);
    document.addEventListener('pointerdown',outside,true);document.addEventListener('focusin',outside,true);
    window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
    window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);
    native.current?.form?.addEventListener('reset',close);
    return()=>{
      if(supportsPopover&&menu.matches(':popover-open'))menu.hidePopover();
      document.removeEventListener('pointerdown',outside,true);document.removeEventListener('focusin',outside,true);
      window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);
      window.visualViewport?.removeEventListener('resize',position);window.visualViewport?.removeEventListener('scroll',position);
      native.current?.form?.removeEventListener('reset',close);
    };
  },[open,choices]);
  useLayoutEffect(()=>{if(open&&active>=0)panel.current?.querySelector<HTMLElement>('[data-index="'+active+'"]')?.scrollIntoView?.({block:'nearest'});},[open,active]);
  useLayoutEffect(()=>{
    const form=native.current?.form;if(!form)return;
    const reset=()=>{setValidation('');queueMicrotask(sync);};form.addEventListener('reset',reset);return()=>form.removeEventListener('reset',reset);
  },[]);

  function show(){
    if(props.disabled)return;
    const current=choices.findIndex(choice=>choice.value===selected&&!choice.disabled);
    setActive(current>=0?current:choices.findIndex(choice=>!choice.disabled));setOpen(true);search.current={text:'',at:0};
  }
  function choose(index:number){
    const choice=choices[index],select=native.current;if(!choice||choice.disabled||!select)return;
    if(select.value!==choice.value){select.value=choice.value;select.dispatchEvent(new Event('change',{bubbles:true}));}
    setOpen(false);trigger.current?.focus();
  }
  function keyboard(event:ReactKeyboardEvent<HTMLButtonElement>){
    if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();setOpen(false);return;}
    if(event.key==='Tab'){setOpen(false);return;}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();if(!open){show();if(event.key!=='Home'&&event.key!=='End')return;}
      const enabled=choices.map((choice,index)=>choice.disabled?-1:index).filter(index=>index>=0);
      const offset=enabled.indexOf(active),step=event.key==='ArrowUp'?-1:1;
      setActive(event.key==='Home'?enabled[0]??-1:event.key==='End'?enabled.at(-1)??-1:enabled[Math.max(0,Math.min(enabled.length-1,offset+step))]??-1);return;
    }
    if(event.key==='Enter'||event.key===' '){event.preventDefault();if(open)choose(active);else show();return;}
    if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
      event.preventDefault();if(!open)show();
      const at=Date.now(),previous=at-search.current.at<600?search.current.text:'';
      const text=(previous+event.key).toLocaleLowerCase();search.current={text,at};
      const match=choices.findIndex(choice=>!choice.disabled&&choice.label.toLocaleLowerCase().startsWith(text));if(match>=0)setActive(match);
    }
  }
  return <span ref={host} className={'media-select-control '+(className||'')} data-variant={variant} data-open={open||undefined}>
    <select {...attributes} id={fieldId?String(fieldId)+'-native':undefined} className="media-select-native" ref={native} aria-hidden="true" tabIndex={-1} onClick={event=>{event.preventDefault();trigger.current?.focus();show();onClick?.(event);}} onFocus={event=>{trigger.current?.focus();onFocus?.(event);}} onInvalid={event=>{event.preventDefault();setValidation(event.currentTarget.validationMessage||'请选择一项');trigger.current?.focus();onInvalid?.(event);}} onChange={event=>{setValidation('');sync();onChange?.(event);}}>{children}</select>
    <button ref={trigger} id={fieldId} type="button" className="media-select-trigger" role="combobox" aria-label={props['aria-label']||label||undefined} aria-labelledby={props['aria-labelledby']} aria-describedby={[props['aria-describedby'],validation?id+'-error':''].filter(Boolean).join(' ')||undefined} aria-invalid={props['aria-invalid']||(validation?true:undefined)} aria-required={props.required?true:undefined} aria-haspopup="listbox" aria-expanded={open} aria-controls={id} aria-activedescendant={open&&active>=0?id+'-'+active:undefined} disabled={props.disabled} title={props.title} onClick={()=>open?setOpen(false):show()} onKeyDown={keyboard}>
      <span>{choices.find(choice=>choice.value===selected)?.label||'请选择'}</span><ChevronDown size={16} strokeWidth={1.7} aria-hidden="true"/>
    </button>
    {validation&&<span id={id+'-error'} className="media-select-error" role="alert">{validation}</span>}
    {open&&<div ref={panel} id={id} className="media-select-menu" role="listbox" aria-label={props['aria-label']||label||undefined} aria-labelledby={props['aria-labelledby']} {...(supportsPopover?{popover:'manual' as const}:{})} onPointerDown={event=>event.preventDefault()}>
      {choices.map((choice,index)=><div key={`${choice.group}\u0000${choice.value}\u0000${choice.label}`} id={id+'-'+index} data-index={index} className="media-select-option" role="option" aria-selected={choice.value===selected} aria-disabled={choice.disabled||undefined} data-active={index===active||undefined} onPointerMove={()=>!choice.disabled&&setActive(index)} onClick={event=>{event.preventDefault();event.stopPropagation();choose(index);}}><span>{choice.group&&<small>{choice.group}</small>}{choice.label}</span>{choice.value===selected&&<Check size={16} strokeWidth={1.9} aria-hidden="true"/>}</div>)}
    </div>}
  </span>;
}
