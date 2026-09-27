import {posix} from 'node:path';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import type {MediaStorage} from './storage/types.ts';
import {isRemoteStorageFailure} from './storage/types.ts';

export interface ArtistProfile {title:string;plot?:string;coverRef?:string;sourceRef:string}
export const sameArtist=(left:string,right:string)=>left.normalize('NFC').trim()===right.normalize('NFC').trim();

/** Explicit artist sidecars only; no remote URLs or album covers are treated as portraits. */
export async function readArtistProfile(storage:MediaStorage,ref:string,name:string,warnings:string[]):Promise<ArtistProfile|undefined>{
  const dir=posix.dirname(ref),parent=posix.dirname(dir);
  for(const folder of [...new Set([dir,parent])]){
    const sibling=(file:string)=>folder==='.'?file:`${folder}/${file}`;
    let sourceRef=sibling('artist.nfo');
    try{
      // Remote directory listing distinguishes an absent optional sidecar from a failed read.
      const names=storage.filePath?undefined:await storage.siblingNames(sourceRef);
      const actualName=(name:string)=>!names||names.has(name)?name:[...names].find(value=>value.toLowerCase()===name.toLowerCase());
      const sourceName=actualName('artist.nfo');if(!sourceName)continue;
      sourceRef=sibling(sourceName);
      if((await storage.stat(sourceRef)).size>1024*1024)throw Error('artist-nfo-too-large');
      const {stream}=await storage.open(sourceRef),chunks:Buffer[]=[];let size=0;
      for await(const chunk of stream){size+=chunk.length;if(size>1024*1024){stream.destroy();throw Error('artist-nfo-too-large');}chunks.push(Buffer.from(chunk));}
      const xml=Buffer.concat(chunks).toString('utf8');
      if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw Error('invalid-artist-nfo');
      const node=new XMLParser({processEntities:false,parseTagValue:false}).parse(xml).artist;
      if(!node||typeof node.name!=='string'||!sameArtist(node.name,name))continue;
      const profile:ArtistProfile={title:name,sourceRef};
      if(typeof node.biography==='string'&&node.biography.trim())profile.plot=node.biography.trim().slice(0,32000);
      for(const file of ['artist.jpg','artist.png','artist.webp']){
        const actual=actualName(file);if(!actual)continue;
        try{const entry=await storage.stat(sibling(actual));if(entry.size>0&&entry.size<=20*1024*1024){profile.coverRef=entry.ref;break;}}catch(error){if(isRemoteStorageFailure(error))throw error;/* Missing or unsafe local portraits do not block the biography. */}
      }
      return profile;
    }catch(error){if(isRemoteStorageFailure(error))throw error;if((error as NodeJS.ErrnoException).code!=='ENOENT')warnings.push('artist-nfo-unreadable');}
  }
  return undefined;
}
