// Shared HTTP assertions for disposable local and container deployments.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');

function fixtureWav(){
  const wav=Buffer.alloc(44+16000);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
  wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);
  wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
  return wav;
}
async function waitForReading(origin){
  for(let attempt=0;attempt<120;attempt++){
    try{if((await fetch(origin+'/api/v1/health',{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}
    await delay(500);
  }
  throw Error('reading health timeout');
}
async function exerciseDeployment({origin,mediaRoot,restart,wav}){
  const api=async(path,method='GET',body,token)=>{
    const response=await fetch(origin+'/api/v1/'+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
    assert.ok(response.ok,`${method} ${path}: ${response.status}`);return response.json();
  };
  const waitForMedia=async token=>{
    const deadline=Date.now()+310000;
    for(;;){
      const response=await fetch(origin+'/api/v1/media/libraries',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});
      if(response.ok){await response.arrayBuffer();return;}
      const body=await response.json();
      assert.equal(response.status,503);assert.equal(body.error?.code,'MEDIA_STARTING','media startup failed');
      assert.ok(Date.now()<deadline,'media startup timeout');
      assert.ok(Array.isArray((await api('books','GET',undefined,token)).items),'reading remains available while media starts');
      await delay(100);
    }
  };
  const checkRange=async streamUrl=>{
    const response=await fetch(origin+streamUrl,{headers:{range:'bytes=0-43'},signal:AbortSignal.timeout(10000)});
    assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),wav.subarray(0,44));
  };
  await waitForReading(origin);
  const web=await fetch(origin+'/');assert.equal(web.status,200);assert.match(await web.text(),/<html/i);
  const auth=await api('auth/register','POST',{username:'deployment-check',password:randomUUID()});
  const token=auth.session.accessToken;
  let books;
  for(let attempt=0;attempt<100;attempt++){
    books=await api('books','GET',undefined,token);if(books.items.length)break;await delay(50);
  }
  assert.equal(books.items.length,1,'fixture book indexed and visible');const book=books.items[0];
  await api('sync/progress/'+book.id,'PUT',{locator:'chapter:deployment',percentage:.4,updatedAt:Date.now()},token);
  await waitForMedia(token);
  const library=await api('media/libraries','POST',{name:'Deployment music',kind:'music',root:mediaRoot,access:'all'},token);
  const scan=await api(`media/libraries/${library.id}/scan`,'POST',{},token);let job;
  for(let attempt=0;attempt<120;attempt++){
    job=await api('media/jobs/'+scan.id,'GET',undefined,token);if(job.state!=='running')break;await delay(250);
  }
  assert.equal(job.state,'complete');
  const items=await api(`media/libraries/${library.id}/items?kind=track`,'GET',undefined,token);assert.equal(items.items.length,1);
  const detail=await api('media/items/'+items.items[0].id,'GET',undefined,token);
  const part=detail.editions[0].parts[0];assert.equal(part.end,1,'ffprobe reads real duration');
  const playback=await api('media/playback','POST',{partId:part.id},token);
  await checkRange(playback.streamUrl);
  const saved=await api('media/playback/'+playback.id+'/progress','PUT',{position:.4,sequence:1,revision:playback.revision},token);
  assert.equal(saved.position,.4);

  origin=await restart();
  await waitForReading(origin);
  // The original access token must remain valid across a server restart.
  assert.equal((await api('books','GET',undefined,token)).items[0].id,book.id);
  assert.equal((await api('sync/progress/'+book.id,'GET',undefined,token)).progress.locator,'chapter:deployment');
  await waitForMedia(token);
  assert.equal((await api('media/libraries','GET',undefined,token)).items[0].id,library.id);
  assert.equal((await api(`media/libraries/${library.id}/items?kind=track`,'GET',undefined,token)).items[0].id,detail.id);
  const restored=await api('media/parts/'+part.id+'/progress','GET',undefined,token);
  assert.equal(restored.position,.4);assert.equal(restored.revision,saved.revision);
  await checkRange(playback.streamUrl);
  const resumed=await api('media/playback','POST',{partId:part.id},token);assert.equal(resumed.position,.4);
  return {reading:true,scan:true,ffprobe:true,range:true,web:true,restart:true,stableIdentities:true,readingProgress:true,mediaProgress:true,originalTokenAndStream:true};
}
module.exports={fixtureWav,exerciseDeployment};
