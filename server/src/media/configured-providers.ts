import type {BusinessSettingsReader,BusinessValues} from '../services/business-settings.ts';
import {MetadataHttp,TmdbProvider,MusicBrainzProvider,type MetadataProvider} from './metadata-providers.ts';

export function configuredProviders(settings:BusinessSettingsReader){
  let key='',providers:MetadataProvider[]=[];
  const limiter={next:0};
  return ()=>{
    const tmdb=settings.read('tmdb'),musicbrainz=settings.read('musicbrainz'),options=settings.read('scraping');
    const next=JSON.stringify([tmdb,musicbrainz,options]);
    if(next!==key){key=next;providers=createProviders(tmdb,musicbrainz,new MetadataHttp(fetch,options,limiter));}
    return providers;
  };
}
export function createProviders(tmdb:BusinessValues['tmdb'],musicbrainz:BusinessValues['musicbrainz'],http:MetadataHttp){
  return [new TmdbProvider(http,tmdb.enabled?tmdb.token:'',tmdb.enabled?tmdb.apiKey:'',tmdb.language),
    new MusicBrainzProvider(http,musicbrainz.enabled?musicbrainz.userAgent:'')];
}
