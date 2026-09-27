/** Opt-in, read-only upstream check using public catalog titles; never opens a library database. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {MetadataHttp,MusicBrainzProvider} from '../src/media/metadata-providers.ts';

const userAgent=process.env.MEDIA_MUSICBRAINZ_USER_AGENT;
if(!userAgent)throw new Error('Set MEDIA_MUSICBRAINZ_USER_AGENT with the application name, version and contact URL.');
const checks:Array<Record<string,unknown>>=[];
const report:{startedAt:string;finishedAt?:string;passed:boolean;checks:typeof checks;error?:string}={startedAt:new Date().toISOString(),passed:false,checks};
try{
  const provider=new MusicBrainzProvider(new MetadataHttp(),userAgent);
  const artists=await provider.search('artist','The Beatles');
  const artist=artists.find(candidate=>candidate.externalId==='b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d');
  assert.ok(artist,'Search must include the known Beatles artist identity');
  checks.push({operation:'artist-search',query:'The Beatles',candidates:artists.length,id:artist.externalId});
  const artistDetail=await provider.detail('artist',artist.externalId);
  assert.equal(artistDetail.fields.title,'The Beatles');
  checks.push({operation:'artist-detail',...artistDetail});
  const albums=await provider.search('album','Abbey Road');
  const album=albums.find(candidate=>candidate.title==='Abbey Road'&&candidate.artist==='The Beatles');
  assert.ok(album,'Search must include Abbey Road credited to The Beatles');
  checks.push({operation:'album-search',query:'Abbey Road',candidates:albums.length,id:album.externalId});
  const albumDetail=await provider.detail('album',album.externalId);
  assert.equal(albumDetail.fields.title,'Abbey Road');assert.equal(albumDetail.fields.artist,'The Beatles');
  assert.equal(albumDetail.fields.musicBrainzCoverGroupId,album.externalId);
  checks.push({operation:'album-detail',...albumDetail});
  for(const [kind,query] of [['track','Yesterday'],['audiobook','The Hobbit']] as const){
    const candidates=await provider.search(kind,query);
    // Recordings can include covers and editions; this checks parsing, not automatic identity selection.
    const candidate=candidates.find(value=>value.title.toLowerCase()===query.toLowerCase());
    assert.ok(candidate,`${kind} search must include the public sample title`);
    checks.push({operation:kind+'-search',query,candidates:candidates.length,id:candidate.externalId,artist:candidate.artist,selection:'first exact title; identity requires human review'});
    const detail=await provider.detail(kind,candidate.externalId);
    assert.equal(detail.fields.title,candidate.title);assert.equal(detail.externalId,candidate.externalId);
    checks.push({operation:kind+'-detail',...detail});
  }
  const narrowed=await provider.search('track','Yesterday',undefined,'The Beatles');
  const beatlesRecording=narrowed.find(candidate=>candidate.title==='Yesterday'&&candidate.artist==='The Beatles');
  assert.ok(beatlesRecording,'Artist-constrained search should recall a Beatles recording');
  const recording=await provider.detail('track',beatlesRecording.externalId);
  assert.equal(recording.fields.artist,'The Beatles');assert.equal(recording.fields.title,'Yesterday');
  checks.push({operation:'track-artist-constrained',query:'Yesterday',artist:'The Beatles',candidates:narrowed.length,...recording});
  report.passed=true;
}catch(error){report.error=error instanceof Error?error.message:'Live provider check failed';process.exitCode=1;}
finally{
  report.finishedAt=new Date().toISOString();
  if(process.env.MEDIA_LIVE_REPORT)await writeFile(process.env.MEDIA_LIVE_REPORT,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
