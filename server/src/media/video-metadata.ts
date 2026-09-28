import {posix} from 'node:path';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {readLocalMetadata} from './local-metadata.ts';
import type {MediaStorage} from './storage/types.ts';
import {isRemoteStorageFailure} from './storage/types.ts';
import type {ProbeResult} from './probe.ts';

/** Per-scan ancestor sidecar cache; inaccessible remote metadata aborts the snapshot. */
export function videoMetadataReader(storage:MediaStorage){
  const cache=new Map<string,Promise<Record<string,string>|null>>();
  function sidecar(dir:string,name:string){
    const key=dir+'/'+name;
    let pending=cache.get(key);
    if(!pending){pending=(async()=>{
      const ref=dir?dir+'/'+name:name;
      try{
        const entries=await storage.siblings(ref),entry=entries.find(value=>value.name.toLowerCase()===name);
        if(!entry||entry.size>1024*1024)return null;
        const {stream}=await storage.open(entry.ref);let bytes=0;const chunks:Buffer[]=[];
        for await(const chunk of stream){bytes+=chunk.length;if(bytes>1024*1024){stream.destroy();return null;}chunks.push(Buffer.from(chunk));}
        const xml=Buffer.concat(chunks).toString('utf8');
        if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)return null;
        const parsed=new XMLParser({ignoreAttributes:false,processEntities:false,parseTagValue:false}).parse(xml);
        return parsed.tvshow??parsed.season??null;
      }catch(error){if(isRemoteStorageFailure(error))throw error;return null;}
    })();cache.set(key,pending);}return pending;
  }
  return async(ref:string,probe:ProbeResult)=>{
    const metadata=await readLocalMetadata(storage,ref,probe);
    let dir=posix.dirname(ref);if(dir==='.')dir='';
    const season=await sidecar(dir,'season.nfo');
    if(metadata.sources.season!=='nfo'&&season&&/^\d{1,3}$/.test(String(season.seasonnumber??season.season??''))){metadata.season=Number(season.seasonnumber??season.season);metadata.sources.season='nfo';}
    for(let depth=0;depth<64;depth++){
      const show=await sidecar(dir,'tvshow.nfo');
      if(show&&typeof show.title==='string'&&show.title.trim()){
        if(metadata.sources.show!=='nfo'){metadata.show=show.title.trim();metadata.sources.show='nfo';}
        if(metadata.year===undefined&&/^\d{4}$/.test(String(show.year??''))){metadata.year=Number(show.year);metadata.sources.year='nfo';}
        metadata.seriesRoot=dir;break;
      }
      if(!dir)break;dir=posix.dirname(dir);if(dir==='.')dir='';
    }
    return metadata;
  };
}
