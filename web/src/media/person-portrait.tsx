const portraitColors=['#637258','#916e52','#4d6876','#776152','#5c626f','#71816b'];

/** A name illustration is used only when no person photograph is available. */
export function personColor(name:string){
  let hash=0;for(const character of name)hash=(hash*31+character.codePointAt(0)!)>>>0;
  return portraitColors[hash%portraitColors.length]!;
}

export function PersonPortrait({name}:{name:string}){
  return <span className="media-cover square media-portrait media-person-placeholder" style={{backgroundColor:personColor(name)}} aria-hidden="true"><span className="media-cover-title">{Array.from(name.trim())[0]||'人'}</span></span>;
}
