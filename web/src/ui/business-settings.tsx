import {useEffect,useLayoutEffect,useState} from './vendor/preact.ts';
import {FloatingNotice} from './floating-notice.tsx';
import {FloatingConfirm} from './floating-confirm.tsx';
import '../styles/business-settings.css';
import type {JSX} from './vendor/preact.ts';

export interface SettingsTransport {
  businessSettingsRequest<T>(path?:string,method?:string,body?:unknown,signal?:AbortSignal):Promise<T>;
  businessTtsPreview(values:Record<string,unknown>,voice:string):Promise<Blob>;
  businessAiModels?(values?:{baseUrl?:string;apiKey?:string}):Promise<string[]>;
}
interface SettingsView {
  group:string;label:string;revision:number;values:Record<string,string|number|boolean>;secrets:Record<string,boolean>;
  fields:Array<{key:string;label:string;type:'text'|'textarea'|'password'|'number'|'checkbox'|'url'|'select';min?:number;max?:number;help?:string;options?:Array<{value:string;label:string}>}>;
}
export function BusinessSettings({api,group,onSaved,selectControl}:{api:SettingsTransport;group?:string;onSaved?:()=>void;selectControl?:any}){
  const Select=selectControl??'select';
  const [groups,setGroups]=useState<SettingsView[]>([]),[selected,setSelected]=useState(group||'tts');
  const [values,setValues]=useState<Record<string,string|number|boolean>>({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[retry,setRetry]=useState(0);
  const [voices,setVoices]=useState<Array<{id:string;name:string}>>([]),[voice,setVoice]=useState(''),[audio,setAudio]=useState('');
  const [models,setModels]=useState<string[]>([]);
  const [directory,setDirectory]=useState(''),[name,setName]=useState('reader-backup.zip'),[clear,setClear]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();setBusy(true);setError('');
    void api.businessSettingsRequest<{groups:SettingsView[]}>('','GET',undefined,controller.signal).then(result=>{if(!controller.signal.aborted)setGroups(result.groups);}).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'读取配置失败');}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return ()=>controller.abort();
  },[api,retry]);
  useEffect(()=>{if(group)setSelected(group);},[group]);
  const current=groups.find(item=>item.group===selected);
  useLayoutEffect(()=>{setValues(current?.values||{});setVoices([]);setVoice('');setAudio('');setModels([]);},[current]);
  useEffect(()=>()=>{if(audio)URL.revokeObjectURL(audio);},[audio]);
  async function work(action:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setMessage('');try{await action();}catch(error){setError(error instanceof Error?error.message:'操作失败');}finally{setBusy(false);}}
  return <section className="business-settings" aria-label={current?.label||'业务配置'}>
    <FloatingNotice message={busy?'正在处理…':error||message} busy={busy} error={!!error} kind="success"/>
    {!group&&<label className="user-manager-mode">配置分类<Select aria-label="配置分类" value={selected} disabled={busy} onChange={(event:JSX.TargetedEvent<HTMLSelectElement>)=>setSelected(event.currentTarget.value)}>{groups.map(item=><option key={item.group} value={item.group}>{item.label}</option>)}</Select></label>}
    {!current&&!busy&&<button onClick={()=>setRetry(value=>value+1)}>重新读取配置</button>}
    {current&&<>
      <p className="muted">保存后生效，无需重启。进行中的任务保留原配置，新任务使用更新后的配置。</p>
      <form className="user-manager-form" onSubmit={event=>{event.preventDefault();void work(async()=>{
        const result=await api.businessSettingsRequest<SettingsView>(selected,'PATCH',{values,revision:current.revision});
        setGroups(items=>items.map(item=>item.group===selected?result:item));setMessage('配置已保存');onSaved?.();
      });}}>
        {current.fields.map(field=><label key={field.key} className={field.type==='checkbox'?'business-setting-toggle':undefined}>{field.label}
          {field.type==='checkbox'?<input type="checkbox" checked={!!values[field.key]} disabled={busy} onChange={event=>setValues({...values,[field.key]:event.currentTarget.checked})}/>:
          selected==='ai'&&field.key==='model'?<Select aria-label={field.label} value={String(values.model||'')} disabled={busy} onChange={(event:JSX.TargetedEvent<HTMLSelectElement>)=>setValues({...values,model:event.currentTarget.value})}><option value="">请获取并选择模型</option>{Array.from(new Set([String(values.model||''),...models])).filter(Boolean).map(model=><option key={model} value={model}>{model}</option>)}</Select>:
          field.type==='select'?<Select aria-label={field.label} value={String(values[field.key]??'')} disabled={busy} onChange={(event:JSX.TargetedEvent<HTMLSelectElement>)=>setValues({...values,[field.key]:event.currentTarget.value})}>{field.options?.map(option=><option value={option.value}>{option.label}</option>)}</Select>:
          field.type==='textarea'?<textarea aria-label={field.label} value={String(values[field.key]??'')} disabled={busy} maxLength={4096} rows={5} onInput={event=>setValues({...values,[field.key]:event.currentTarget.value})}/>:<input aria-label={field.label} list={selected==='ai'&&field.key==='model'?'ai-models':undefined} type={field.type} value={String(values[field.key]??'')} disabled={busy} min={field.min} max={field.max} step={field.type==='number'?1:undefined} maxLength={4096} autoComplete={field.type==='password'?'new-password':'off'} placeholder={field.type==='password'&&current.secrets[field.key]?'已保存，留空不修改':undefined} onInput={event=>setValues({...values,[field.key]:field.type==='number'?Number(event.currentTarget.value):event.currentTarget.value})}/>}
          {field.help&&<small className="muted">{field.help}</small>}
          {field.type==='password'&&<><small className="muted">{values[field.key]===''?'保存时将清除凭据':current.secrets[field.key]?'已有凭据，仅替换时填写':'尚未配置凭据'}</small><button className="button business-secret-clear" type="button" disabled={busy} onClick={()=>setValues({...values,[field.key]:''})}>清除{field.label}</button></>}
        </label>)}
        {selected==='ai'&&<datalist id="ai-models">{models.map(model=><option key={model} value={model}/>)}</datalist>}
        <div className="user-manager-actions"><button className="button primary" disabled={busy}>保存配置</button>
          {selected==='ai'&&api.businessAiModels&&<button type="button" className="button" disabled={busy} onClick={()=>void work(async()=>{const result=await api.businessAiModels!({baseUrl:String(values.baseUrl||''),apiKey:String(values.apiKey||'')});setModels(result);setMessage(`已获取 ${result.length} 个模型`);})}>获取模型</button>}
          {['tmdb','musicbrainz','tts','webdav'].includes(selected)&&<button type="button" className="button" disabled={busy} onClick={()=>void work(async()=>{
            const result=await api.businessSettingsRequest<{elapsedMs:number;voices?:Array<{id:string;name:string}>}>(selected+'/test','POST',{values});setVoices(result.voices||[]);setMessage(`连接成功，耗时 ${result.elapsedMs} 毫秒（尚未保存表单）`);
          })}>{selected==='tts'?'检测连接并获取音色':'测试连接'}</button>}
          <button type="button" className="button" disabled={busy} onClick={()=>setRetry(value=>value+1)}>重新加载</button>
        </div>
      </form>
      {selected==='ai'&&models.length>0&&<p className="muted">可用模型：{models.join('、')}</p>}
      {selected==='tts'&&<div className="user-manager-form"><label>试听音色<input list="business-tts-voices" value={voice} onInput={event=>setVoice(event.currentTarget.value)}/><datalist id="business-tts-voices">{voices.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</datalist></label>
        <button className="button" disabled={busy} onClick={()=>void work(async()=>{setAudio(URL.createObjectURL(await api.businessTtsPreview(values,voice)));setMessage('试听音频已就绪');})}>生成试听音频</button>
        {audio&&<audio controls src={audio} aria-label="HTTP 朗读试听"/>}
        <button className="button" disabled={busy} onClick={()=>setClear(true)}>清理音频缓存</button>
      </div>}
      {clear&&<FloatingConfirm text="清理服务器音频缓存？下次朗读将重新合成。" onCancel={()=>setClear(false)} onConfirm={()=>{setClear(false);void work(async()=>{await api.businessSettingsRequest('tts/clear-cache','POST');setMessage('音频缓存已清理');});}}/>}
      {selected==='webdav'&&<details><summary>上传已验证的离线备份</summary><p>先停服制作完整备份，再启动服务上传。这里不会在线复制运行中的数据库。目录须能从服务器内访问；上传使用已保存的 WebDAV 配置。</p>
        <form className="user-manager-form" onSubmit={event=>{event.preventDefault();void work(async()=>{await api.businessSettingsRequest('webdav/upload','POST',{directory,name});setMessage('备份已上传并验证');});}}>
          <label>服务器上的备份目录<input required value={directory} onInput={event=>setDirectory(event.currentTarget.value)}/></label>
          <label>远端文件名（.zip）<input required pattern="[a-zA-Z0-9][a-zA-Z0-9._-]*\.zip" value={name} onInput={event=>setName(event.currentTarget.value)}/></label>
          <button className="button" disabled={busy}>验证并上传备份</button>
        </form>
      </details>}
    </>}
  </section>;
}
