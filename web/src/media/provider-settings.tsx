import {useEffect,useState} from '../ui/vendor/preact.ts';
import {ChevronRight,FileText,Search} from 'lucide-preact';
import type {MediaApi} from './api.ts';
import {MediaLoading} from './loading.tsx';
import {MediaScreenError} from './screen-error.tsx';
import {BusinessSettings} from '../ui/business-settings.tsx';

interface Provider {id:string;label:string;kinds:string[];configured:boolean}
const kinds:Record<string,string>={movie:'电影',series:'剧集',season:'季',episode:'单集',artist:'艺人',album:'专辑',track:'曲目',audiobook:'有声书'};
export function MediaProviderSettings({api}:{api:MediaApi}){
  const [providers,setProviders]=useState<Provider[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0),[selected,setSelected]=useState('');
  const [cause,setCause]=useState<unknown>();
  useEffect(()=>{const abort=new AbortController();setLoading(true);setError('');setCause(undefined);void api.request<{items:Provider[]}>('metadata/providers','GET',undefined,abort.signal).then(result=>{if(!abort.signal.aborted)setProviders(result.items);}).catch(error=>{if(!abort.signal.aborted){setError(error instanceof Error?error.message:'来源状态读取失败');setCause(error);}}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});return ()=>abort.abort();},[api,retry]);
  const provider=providers.find(value=>value.id===selected);
  return <div className="media-provider-settings">
    <h2>元数据刮削</h2>
    {loading&&<MediaLoading layout="list" square label="正在读取来源状态…" count={2}/>} {error&&<MediaScreenError error={cause} message={error} busy={loading} retryLabel="重试读取来源" onRetry={()=>setRetry(value=>value+1)}/>}
    {!loading&&!error&&providers.map(value=><button key={value.id} className="media-provider-row" aria-expanded={selected===value.id} onClick={()=>setSelected(selected===value.id?'':value.id)}><Search size={20} aria-hidden="true"/><span><strong>{value.label}</strong><small>{value.kinds.map(kind=>kinds[kind]||kind).join('、')}</small></span><small className="media-status-badge" data-configured={value.configured}>{value.configured?'已配置':'未配置'}</small><ChevronRight size={16} aria-hidden="true"/></button>)}
    {!loading&&!error&&!providers.length&&<p>服务器尚未提供在线元数据来源。</p>}
    {provider&&!loading&&!error&&<section className="media-provider-note" aria-label={provider.label+'配置说明'}><h3>{provider.label}</h3><p>{provider.configured?'服务器已配置此来源，可以从作品详情搜索候选，或从扫描与刮削页面发起匹配。':'此来源尚未配置，配置完成后才能搜索和匹配元数据。'}</p>
      {['tmdb','musicbrainz'].includes(provider.id)?<BusinessSettings api={api} group={provider.id} onSaved={()=>setRetry(value=>value+1)}/>:<p>配置方式由服务器提供此来源的适配器决定。</p>}
      <button onClick={()=>{setSelected('');setRetry(value=>value+1);}}>刷新配置状态</button></section>}
    <button className="media-provider-row" aria-expanded={selected==='local'} onClick={()=>setSelected(selected==='local'?'':'local')}><FileText size={20} aria-hidden="true"/><span><strong>本地资料</strong><small>NFO、内嵌标签、同目录图片</small></span><small className="media-status-badge">内置</small><ChevronRight size={16} aria-hidden="true"/></button>
    {selected==='local'&&<p className="media-provider-note">扫描时读取本地资料，人工覆盖优先于资料源。在线匹配不会修改原始媒体文件。</p>}
    <h2>内容来源</h2><p className="media-manager-note">阅读书源保持独立管理。TVBox 兼容由后续影音来源插件提供，当前没有配置入口。</p>
    <p className="media-source-attribution">TMDB 数据来源于 TMDB，本应用未经 TMDB 认可或认证。MusicBrainz 数据来源于 MetaBrainz 社区。</p>
  </div>;
}
