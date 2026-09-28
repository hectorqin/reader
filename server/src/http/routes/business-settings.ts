import type {FastifyInstance} from 'fastify';
import type {AppContext} from '../context.ts';
import {authenticate,requireAdmin} from '../auth.ts';
import {badRequest,AppError} from '../../lib/errors.ts';
import {SETTINGS_SCHEMA,type SettingsGroup} from '../../services/business-settings.ts';
import {TtsService} from '../../services/tts.ts';
import {MetadataHttp,TmdbProvider,MusicBrainzProvider} from '../../media/metadata-providers.ts';
import {uploadBackup} from '../../maintenance/webdav.ts';

export function registerBusinessSettingsRoutes(app:FastifyInstance,ctx:AppContext){
  const settings=ctx.settings!,auth=authenticate(ctx),active=new Set<string>();
  const guard=async(request:Parameters<typeof auth>[0],reply:Parameters<typeof auth>[1])=>{await auth(request,reply);requireAdmin(request);reply.header('cache-control','no-store');};
  const group=(params:unknown)=>{
    const name=(params as {group?:string})?.group;
    if(!name||!Object.hasOwn(SETTINGS_SCHEMA,name))throw badRequest('未知配置分类');return name as SettingsGroup;
  };
  app.get('/api/v1/admin/settings',{preHandler:guard},async()=>({groups:(Object.keys(SETTINGS_SCHEMA) as SettingsGroup[]).map(name=>settings.view(name))}));
  app.patch('/api/v1/admin/settings/:group',{preHandler:guard},async request=>{
    const name=group(request.params),body=request.body as {values?:unknown;revision?:unknown};
    if(!body)throw badRequest('缺少配置');
    // Do not let a CORS edit lock this browser out of administering the instance.
    if(name==='access'&&request.headers.origin){
      const next=settings.candidate(name,body.values),origins=next.corsOrigins.split(',').map(value=>value.trim()).filter(Boolean);
      if(origins.length&&!origins.includes(request.headers.origin))throw badRequest('允许的来源必须包含当前管理页面的来源');
    }
    const result=settings.save(name,body.values,body.revision);
    settings.apply(ctx.config);
    if(name==='tts')ctx.tts=new TtsService(ctx.config,settings.read('tts'));
    ctx.settingsChanged?.(name);
    app.log.info({group:name,actor:request.currentUser!.id,revision:result.revision},'business settings updated');
    return result;
  });
  app.post('/api/v1/admin/settings/:group/test',{preHandler:guard},async request=>{
    const name=group(request.params),input=(request.body as {values?:unknown})?.values??{};
    if(active.has(name))throw new AppError(409,'SETTINGS_TEST_BUSY','此配置正在检测，请稍候');
    active.add(name);const started=Date.now();
    try{
      if(name==='tmdb'){
        const value=settings.candidate('tmdb',input),http=new MetadataHttp(fetch,settings.read('scraping'));
        await new TmdbProvider(http,value.token,value.apiKey,value.language).search('movie','test');
      }else if(name==='musicbrainz'){
        const value=settings.candidate('musicbrainz',input);
        await new MusicBrainzProvider(new MetadataHttp(fetch,settings.read('scraping')),value.userAgent).search('artist','Mozart');
      }else if(name==='tts'){
        const service=new TtsService(ctx.config,settings.candidate('tts',input));
        const audio=await service.synthesize({text:'这是阅读器的朗读连接测试。'});
        return {ok:true,elapsedMs:Date.now()-started,bytes:audio.bytes.length,voices:await service.voices()};
      }else if(name==='webdav'){
        const value=settings.candidate('webdav',input);
        if(!value.url||!value.username||!value.password)throw badRequest('请填写备份地址、账号和密码');
        const response=await fetch(value.url,{method:'PROPFIND',redirect:'error',headers:{Depth:'0',Authorization:'Basic '+Buffer.from(value.username+':'+value.password).toString('base64')},signal:AbortSignal.timeout(15000)});
        await response.body?.cancel();if(!response.ok)throw badRequest(`WebDAV 连接失败（HTTP ${response.status}）`);
      }else throw badRequest('此分类不需要连接测试');
      return {ok:true,elapsedMs:Date.now()-started};
    }catch(error){
      if(error instanceof AppError)throw error;
      throw new AppError(502,'SETTINGS_TEST_FAILED','连接测试失败，请检查服务地址、凭据及网络');
    }finally{active.delete(name);}
  });
  app.post('/api/v1/admin/settings/tts/preview',{preHandler:guard},async(request,reply)=>{
    const body=request.body as {values?:unknown;voice?:string};
    if(body?.voice!==undefined&&(typeof body.voice!=='string'||body.voice.length>120))throw badRequest('无效的音色');
    const service=new TtsService(ctx.config,settings.candidate('tts',body?.values??{}));
    const audio=await service.synthesize({text:'这是阅读器朗读试听。愿你享受阅读的时光。',voice:body?.voice});
    return reply.type(audio.contentType).send(Buffer.from(audio.bytes));
  });
  app.post('/api/v1/admin/settings/tts/clear-cache',{preHandler:guard},async()=>{
    // Cache cleanup also works when HTTP speech has been disabled.
    const value=settings.read('tts');new TtsService(ctx.config,{...value,enabled:true,url:value.url||'http://localhost'}).clearCache();
    return {ok:true};
  });
  app.post('/api/v1/admin/settings/webdav/upload',{preHandler:guard},async request=>{
    const body=request.body as {directory?:unknown;name?:unknown};
    if(typeof body?.directory!=='string'||!body.directory||body.directory.length>4096||typeof body?.name!=='string')throw badRequest('请输入已验证备份目录和远端文件名');
    if(active.has('upload'))throw new AppError(409,'BACKUP_BUSY','已有备份正在上传');
    active.add('upload');
    try{return await uploadBackup(body.directory,{...settings.read('webdav'),name:body.name});}
    catch{throw badRequest('备份上传失败，请检查备份完整性、目标权限、配额及同名文件；不会覆盖已有备份');}
    finally{active.delete('upload');}
  });
}
