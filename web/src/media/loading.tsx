export function MediaLoading({label='正在读取媒体库…',layout='grid',square=false,count}:{label?:string;layout?:'grid'|'list'|'detail'|'episodes'|'tracks';square?:boolean;count?:number}){
  return <section className={'media-read-loading media-read-loading-'+layout} aria-label={label} aria-busy="true">
    <p role="status">{label}</p>
    <div className={layout==='grid'?'media-grid':'media-skeleton-list'} aria-hidden="true">{Array.from({length:count??(layout==='detail'?1:layout==='grid'?9:layout==='episodes'?12:6)},(_,index)=><div key={index} className="media-skeleton-entry"><span className={'media-skeleton-cover'+(square?' square':'')}/><span className="media-skeleton-copy"><i/><i/></span></div>)}</div>
  </section>;
}
