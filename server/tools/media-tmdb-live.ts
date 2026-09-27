/** Public samples only. No library database or user media is opened by this check. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {TmdbProvider,MetadataHttp} from '../src/media/metadata-providers.ts';
import {RemoteArtwork} from '../src/media/remote-artwork.ts';

const checks:Array<Record<string,unknown>>=[];
const report:{passed:boolean;startedAt:string;finishedAt?:string;checks:typeof checks;error?:string}={passed:false,startedAt:new Date().toISOString(),checks};
try{
  if(!process.env.MEDIA_TMDB_TOKEN&&!process.env.MEDIA_TMDB_API_KEY){
    process.exitCode=2;
    throw new Error('MEDIA_TMDB_TOKEN or MEDIA_TMDB_API_KEY is required; no upstream requests were made.');
  }
  const provider=new TmdbProvider(new MetadataHttp());
  for(const sample of [
    {kind:'movie',query:'Inception',id:'27205',year:2010},
    {kind:'series',query:'Breaking Bad',id:'1396',year:2008},
  ] as const){
    const candidates=await provider.search(sample.kind,sample.query);
    assert.ok(candidates.some(candidate=>candidate.externalId===sample.id),`${sample.kind} search did not recall the known identity`);
    checks.push({operation:sample.kind+'-search',query:sample.query,id:sample.id,candidates:candidates.length});
    const detail=await provider.detail(sample.kind,sample.id);
    assert.equal(detail.externalId,sample.id);assert.equal(detail.fields.year,sample.year);
    assert.ok(typeof detail.fields.title==='string'&&detail.fields.title.length>0);
    checks.push({operation:sample.kind+'-detail',...detail});
    const poster=detail.fields.tmdbPosterPath;
    assert.equal(typeof poster,'string',`${sample.kind} sample must expose a poster`);
    const artwork=new RemoteArtwork();
    const bytes=await artwork.tmdb(poster as string);
    const jpeg=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
    const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
    assert.ok(jpeg||png||webp,'poster must have a supported image signature');
    assert.deepEqual(await artwork.tmdb(poster as string),bytes);
    checks.push({operation:sample.kind+'-poster',path:poster,bytes:bytes.length,signature:jpeg?'jpeg':png?'png':'webp',cacheBytesStable:true,decoded:false});
  }
  for(const [kind,id] of [['season','1396/season/1'],['episode','1396/season/1/episode/1']] as const){
    const detail=await provider.detail(kind,id);
    assert.equal(detail.externalId,id);assert.equal(detail.fields.year,2008);
    assert.ok(typeof detail.fields.title==='string'&&detail.fields.title.length>0);
    assert.equal(detail.sourceUrl,'https://www.themoviedb.org/tv/'+id);
    checks.push({operation:kind+'-detail',...detail});
  }
  report.passed=true;
}catch(error){
  // Never serialize request headers, URLs with credentials, or arbitrary upstream errors.
  const message=error instanceof Error?error.message:'Live TMDB check failed';
  report.error=[process.env.MEDIA_TMDB_TOKEN,process.env.MEDIA_TMDB_API_KEY].reduce((safe,secret)=>secret?safe.split(secret).join('[redacted]'):safe,message);
  process.exitCode=process.exitCode||1;
}finally{
  report.finishedAt=new Date().toISOString();
  if(process.env.MEDIA_TMDB_LIVE_REPORT)await writeFile(process.env.MEDIA_TMDB_LIVE_REPORT,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
