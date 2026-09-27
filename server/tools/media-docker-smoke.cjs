// Run against an explicitly selected local image. Never touches the user's Compose deployment.
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {mkdtemp,mkdir,writeFile,rm,readFile}=require('node:fs/promises');
const {join,resolve}=require('node:path');
const {tmpdir}=require('node:os');
const {randomUUID,createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const {fixtureWav,exerciseDeployment}=require('./media-deployment-protocol.cjs');
const exec=promisify(execFile);
const docker=async(...args)=>(await exec('docker',args,{windowsHide:true,timeout:120000,maxBuffer:4*1024*1024})).stdout.trim();
(async()=>{
  const image=process.env.MEDIA_DOCKER_IMAGE;
  assert.ok(image,'Set MEDIA_DOCKER_IMAGE to the image built from this worktree.');
  assert.equal(await docker('info','--format','{{.OSType}}'),'linux');
  const root=await mkdtemp(join(tmpdir(),'reader-docker-media-'));
  const name='reader-media-check-'+randomUUID();let created=false;
  try{
    for(const dir of ['books','media','data'])await mkdir(join(root,dir));
    const wav=fixtureWav();
    await writeFile(join(root,'media','container-tone.wav'),wav);
    await writeFile(join(root,'books','reading.txt'),'第一章\n容器重启阅读验证\n'.repeat(20));
    const imageId=await docker('image','inspect',image,'--format','{{.Id}}');
    await docker('create','--pull','never','--name',name,'-p','127.0.0.1::5888',
      '--mount',`type=bind,source=${join(root,'books')},target=/books,readonly`,
      '--mount',`type=bind,source=${join(root,'media')},target=/media/music,readonly`,
      '--mount',`type=bind,source=${join(root,'data')},target=/data`,
      '-e','SCAN_INTERVAL=0','-e','WATCH_INTERVAL=0',imageId);
    created=true;await docker('start',name);
    const readOrigin=async()=>{
      const port=JSON.parse(await docker('inspect',name))[0].NetworkSettings.Ports['5888/tcp'][0].HostPort;
      return 'http://127.0.0.1:'+port;
    };
    const origin=await readOrigin();
    const clientSha256=createHash('sha256').update(await readFile(resolve(__dirname,'../../web/dist/assets/client.js'))).digest('hex');
    const imageClientSha256=await docker('exec',name,'node','-e',"console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('/app/web/assets/client.js')).digest('hex'))");
    assert.equal(imageClientSha256,clientSha256,'container Web bundle matches the locally built client');
    await docker('exec',name,'node','-e',"const fs=require('node:fs');for(const name of ['epub2','adm-zip']){if(fs.existsSync('/app/node_modules/'+name))throw Error('Unused dependency remains: '+name)}");
    const checks=await exerciseDeployment({origin,mediaRoot:'/media/music',wav,restart:async()=>{
      await docker('restart','--time','20',name);return readOrigin();
    }});
    const uid=await docker('exec',name,'node','-e',"console.log(require('node:fs').readFileSync('/proc/1/status','utf8').match(/^Uid:\\s+(\\d+)/m)[1])");
    assert.notEqual(uid,'0','server process runs unprivileged');
    await docker('exec',name,'node','-e',"try{require('node:fs').writeFileSync('/media/music/write-check','x');process.exit(1)}catch(e){if(e.code!=='EROFS')throw e}");
    assert.deepEqual(await readFile(join(root,'media','container-tone.wav')),wav);
    console.log(JSON.stringify({passed:true,imageId,clientSha256,unusedEpubDependenciesAbsent:true,readOnlyMount:true,unprivilegedServer:true,...checks}));
  }catch(error){
    if(created){
      try{
        const state=JSON.parse(await docker('inspect',name))[0];
        console.error(JSON.stringify({container:name,state:state.State.Status,health:state.State.Health?.Status,ports:state.NetworkSettings.Ports}));
        console.error(await docker('logs','--tail','20',name));
      }catch(diagnosticError){console.error('Container diagnostics unavailable: '+diagnosticError.message);}
    }
    throw error;
  }finally{
    if(created)await docker('rm','-f',name);
    await rm(root,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
