import {MediaSelect} from './select.tsx';
import { useEffect, useRef, useState } from 'react';
import type { Detail, MediaApi } from '../api/media-api.ts';
import {Search} from 'lucide-react';
import {MediaLoading} from './loading.tsx';
import {MediaScreenError} from './screen-error.tsx';
import {ApiError} from '../../../api/errors.ts';
import {Modal} from '../../../ui/modal.tsx';
import {FloatingNotice} from '../../../ui/floating-notice.tsx';

interface Provider { id: string; label: string; kinds: string[]; configured: boolean }
interface Candidate { candidateId: string; provider: string; externalId: string; title: string; year?: number; artist?: string; description?: string; evidence?:{level:'strong'|'review'|'conflict';reasons:string[]} }

/** Matching stays explicit; searching never applies a candidate by itself. */
export function MetadataMatcher({ api, item, onUpdated,layout='inline',onBusyChange }: { api: MediaApi; item: Detail; onUpdated: (item: Detail) => void;layout?:'inline'|'page';onBusyChange?:(busy:boolean)=>void }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState('');
  const [query, setQuery] = useState(item.title);
  const [artist,setArtist]=useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError,setLoadError]=useState('');
  const [loadCause,setLoadCause]=useState<unknown>();
  const [loadRetry,setLoadRetry]=useState(0);
  const [loading,setLoading]=useState(true);
  const [jobNotice,setJobNotice]=useState('');
  const abort = useRef<AbortController | null>(null);
  const previewGeneration=useRef(0);
  useEffect(()=>{onBusyChange?.(busy);},[busy,onBusyChange]);

  useEffect(()=>{setQuery(item.title);setArtist('');},[item.id,item.kind]);

  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    const generation=++previewGeneration.current;
    setProvider(''); setCandidates([]); setSelected(null); setSearched(false);
    setProviders([]); setError(''); setLoadError('');setLoadCause(undefined); setBusy(false); setJobNotice('');setLoading(true);
    const available = api.request<{ items: Provider[] }>('metadata/providers', 'GET', undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return [];
      const supported = result.items.filter(p => p.kinds.includes(item.kind));
      setProviders(supported);
      if (generation === previewGeneration.current) setProvider(supported.find(p => p.configured)?.id || '');
      return supported;
    }).catch(error => {
      if (!controller.signal.aborted&&generation===previewGeneration.current){setLoadError('无法读取匹配来源，已存候选暂时无法恢复。');setLoadCause(error);}
      return [];
    });
    const savedRead=api.request<{items:Candidate[]}>(`items/${item.id}/matches`,'GET',undefined,controller.signal).then(async result=>{
      const supported = await available;
      if(controller.signal.aborted||generation!==previewGeneration.current)return;
      const saved=result.items.filter(candidate=>typeof candidate.candidateId==='string'&&typeof candidate.title==='string'&&supported.some(p=>p.id===candidate.provider&&p.configured));
      if(saved.length){setProvider(saved[0]!.provider);setCandidates(saved);setSelected(saved[0]!);setSearched(true);}
    }).catch(error=>{
      if(!controller.signal.aborted&&generation===previewGeneration.current){setLoadError('读取已存候选失败，请重试；服务器中的候选未被修改。');setLoadCause(error);}
    });
    void Promise.all([available,savedRead]).finally(()=>{if(!controller.signal.aborted&&generation===previewGeneration.current)setLoading(false);});
    return () => controller.abort();
  }, [api, item.id, item.kind,loadRetry]);

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    const signal = abort.current?.signal;
    if (!signal || signal.aborted || busy) return;
    ++previewGeneration.current;
    setBusy(true); setError(''); setLoadError('');setLoading(false);
    try { await action(signal); }
    catch (reason) { if (!signal.aborted) setError(reason instanceof ApiError&&reason.kind==='offline'?'无法连接服务器，请检查连接后重试。':reason instanceof Error ? reason.message : '刮削失败，请重试'); }
    finally { if (!signal.aborted) setBusy(false); }
  }

  const match = item.metadata.onlineMatch as { provider: string; externalId: string } | undefined;
  const child=provider==='tmdb'&&['season','episode'].includes(item.kind);
  const supportsArtist=provider==='musicbrainz'&&['track','album'].includes(item.kind);
  const Wrapper=layout==='page'?'section':'details';
  return <Wrapper className="media-metadata-matcher" data-layout={layout}>{layout==='inline'?<summary>在线匹配元数据{candidates.length > 0 && ` · ${candidates.length} 个候选待核对`}{loadError&&' · 读取失败'}</summary>:<div className="media-match-intro"><p>在线匹配元数据{candidates.length > 0 && ` · ${candidates.length} 个候选待核对`}{loadError&&' · 读取失败'}</p><h1>{item.title}</h1></div>}
    {loadError&&<MediaScreenError error={loadCause} message={loadError} busy={busy} retryLabel="重试读取来源与候选" onRetry={()=>setLoadRetry(value=>value+1)}/>}
    {item.kind==='series'&&match?.provider==='tmdb'&&<p>更换或移除父剧匹配时，依赖旧匹配的季集在线资料也会清除；人工修改、版本和播放进度保留。</p>}
    {item.kind==='series'&&match?.provider==='tmdb'&&<><button disabled={busy} onClick={()=>void run(async signal=>{
      setJobNotice('');
      await api.request(`items/${item.id}/child-scrape-job`,'POST',{},signal);
      if(!signal.aborted)setJobNotice('季集候选任务已创建，可在媒体库管理的批量刮削中查看进度。季集编号可能与来源不同，需逐项核对确认。');
    })}>批量获取季集候选</button>{jobNotice&&<p role="status">{jobNotice}</p>}</>}
    {match && <p>当前来源：{match.provider} · {match.externalId} <button disabled={busy} onClick={() => void run(async signal => {
      const detail = await api.request<Detail>(`items/${item.id}/match`, 'DELETE', undefined, signal);
      if (!signal.aborted) { onUpdated(detail); setCandidates([]); setSelected(null); setSearched(false); }
    })}>移除在线匹配</button></p>}
    <p>{child?'按所属剧集已确认的 TMDB 匹配和本地季集编号获取资料，请先核对编号。':'搜索会将关键词发送给所选来源。'}确认匹配后更新作品资料，保留人工修改、播放进度及版本关系。</p>
    <form className="media-form media-match-search" onSubmit={event => {
      event.preventDefault();
      void run(async signal => {
        setSelected(null); setCandidates([]); setSearched(false);
        const result = await api.request<{ items: Candidate[] }>(`items/${item.id}/matches`, 'POST', { provider, query,...(supportsArtist&&artist.trim()?{artist:artist.trim()}:{}) }, signal);
        if (!signal.aborted) { setCandidates(result.items); setSelected(result.items[0] ?? null); setSearched(true); }
      });
    }}>
      <label>来源<MediaSelect aria-label="刮削来源" value={provider} disabled={busy} onChange={e => { ++previewGeneration.current;setLoading(false); setProvider(e.currentTarget.value); setCandidates([]); setSelected(null); setSearched(false); setError(''); }}>
        {!provider && <option key="empty" value="">请选择已配置来源</option>}
        {providers.map(p => <option key={p.id} value={p.id} disabled={!p.configured}>{p.label}{p.configured ? '' : '（未配置）'}</option>)}
      </MediaSelect></label>
      {!child&&<label>搜索词<input aria-label="刮削搜索词" value={query} required maxLength={200} disabled={busy} onInput={e => setQuery(e.currentTarget.value)}/></label>}
      {supportsArtist&&<label>艺人限定（可选）<input aria-label="刮削艺人限定" value={artist} maxLength={200} disabled={busy} onInput={event=>setArtist(event.currentTarget.value)}/><small>与搜索词一同发送给 MusicBrainz，仅用于“搜索候选”。没有结果时可清空重搜，不会修改作品标签。</small></label>}
      <button className="media-primary" disabled={busy || !provider || !query.trim()} type="submit">{child?'获取季集候选':'搜索候选'}</button>
      {!child&&<details className="media-auto-match"><summary>自动匹配</summary><button disabled={busy||!provider||!!match} type="button" onClick={()=>void run(async signal=>{
        setSelected(null);setCandidates([]);setSearched(false);
        const result=await api.request<{status:string;item?:Detail;items?:Candidate[]}>(`items/${item.id}/auto-match`,'POST',{provider},signal);
        if(signal.aborted)return;
        if(result.item)onUpdated(result.item);
        else{const next=result.items||[];setCandidates(next);setSelected(next[0]??null);setSearched(true);setError(result.status==='unmatched'?'':'未满足唯一且一致的匹配条件，请核对候选后确认。');}
      })}>按作品信息自动匹配</button>
      <small>使用当前标题搜索，仅唯一较强候选且详情复核一致时保存；已有在线匹配不会覆盖。</small></details>}
    </form>
    {!loading&&!loadError&&!provider&&<div className="media-match-unavailable" role="status"><Search size={26} strokeWidth={1.4} aria-hidden="true"/><strong>{providers.length?'尚未配置可用来源':'当前作品暂无支持的在线来源。'}</strong><p>{providers.length?'请由服务器管理员设置访问凭证或联系信息，再重新读取。':'可以返回手动编辑，本地资料和播放不受影响。'}</p>{providers.length>0&&<button type="button" disabled={busy} onClick={()=>setLoadRetry(value=>value+1)}>重新检查来源</button>}</div>}
    {loading&&<MediaLoading layout="list" label="正在读取来源与候选…" count={2}/>}
    {error && <p className="media-error" role="alert">{error}</p>}
    {busy && <FloatingNotice message="正在处理元数据…" busy />}
    {searched && candidates.length === 0 && <p>未找到候选，请修改关键词后重试。</p>}
    {layout==='page'&&<h2>候选作品</h2>}
    {candidates.map(candidate => <div className="media-row media-match-candidate" key={candidate.candidateId}>
      {layout==='page'&&<div className="media-match-placeholder" aria-hidden="true"><Search size={21} strokeWidth={1.4}/></div>}
      <div className="media-match-copy"><strong>{candidate.title}</strong><small>{candidate.year || ''} {candidate.artist || ''} · {candidate.provider} / {candidate.externalId}</small>{candidate.evidence&&<small>{({strong:'较强匹配',review:'需要核对',conflict:'存在冲突'})[candidate.evidence.level]}：{candidate.evidence.reasons.join('、')}</small>}{candidate.description && <small className="media-match-excerpt">{candidate.description.length>160?candidate.description.slice(0,160)+'…':candidate.description}</small>}{candidate.description&&candidate.description.length>160&&<details className="media-match-description"><summary>完整简介</summary><p tabIndex={0} aria-label="候选完整简介">{candidate.description}</p></details>}</div>
      <button aria-label="预览匹配" disabled={busy} onClick={() => setSelected(candidate)}>{layout==='page'?'选择':'预览匹配'}</button>
    </div>)}
    {selected && <Modal className="media-modal" title="确认元数据匹配" busy={busy} onClose={()=>{if(!busy)setSelected(null);}}><div className="media-match-confirm" aria-label="确认元数据匹配"><p>将“{item.title}”匹配为“{selected.title}”。在线标题、年份和简介等字段将采用此来源；人工编辑的字段仍优先显示。</p><div className="dialog-actions"><button className="media-primary" disabled={busy} onClick={() => void run(async signal => {
        const detail = await api.request<Detail>(`items/${item.id}/match`, 'PUT', { candidateId: selected.candidateId }, signal);
        if (!signal.aborted) { onUpdated(detail); setSelected(null); setCandidates([]); setSearched(false); }
      })}>确认此匹配</button><button disabled={busy} onClick={()=>setSelected(null)}>取消</button></div></div></Modal>}
    <small>TMDB 数据来源于 TMDB，本应用未经 TMDB 认可或认证。MusicBrainz 数据来源于 MetaBrainz 社区。</small>
  </Wrapper>;
}
