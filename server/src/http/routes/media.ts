import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { authenticate, currentUser, requireAdmin } from '../auth.ts';
import { MediaLibraries } from '../../media/libraries.ts';
import type { CreateMediaLibrary, MediaLibraryKind } from '../../media/libraries.ts';
import type { OpenListConnection } from '../../media/storage/openlist.ts';
import { MediaScanner } from '../../media/scanner.ts';
import { AppError, badRequest } from '../../lib/errors.ts';
import { MediaCatalogReader } from '../../media/catalog-reader.ts';
import type { CatalogQuery } from '../../media/catalog-query.ts';
import { executeCatalogQuery } from '../../media/catalog-query.ts';
import type { MediaItemKind, MediaBrowseKind, MediaSort } from '../../media/catalog.ts';
import { MediaPlayback } from '../../media/playback.ts';
import { MediaUserState } from '../../media/user-state.ts';
import { MediaScraping } from '../../media/scraping.ts';
import { MediaHierarchy } from '../../media/hierarchy.ts';
import type { CreateVideoParent } from '../../media/hierarchy.ts';
import type { MetadataProvider } from '../../media/metadata-providers.ts';
import { MediaArtwork } from '../../media/artwork.ts';
import { MediaSubtitles } from '../../media/subtitles.ts';
import { MediaLyrics } from '../../media/lyrics.ts';
import { MediaFolders } from '../../media/folders.ts';
import { MediaScrapeJobs,SCRAPE_RESULT_STATES } from '../../media/scrape-jobs.ts';
import { MediaBackgroundGrants } from '../../media/background-grants.ts';
import { DatabaseMediaAccounts, MediaAccountReferences } from '../../media/accounts.ts';
import type { MediaDatabase } from '../../media/read-database.ts';
import type { Db } from '../../db/index.ts';
import {BusinessSettingsReader} from '../../services/business-settings.ts';
import {configuredProviders} from '../../media/configured-providers.ts';

export type MediaRouteContext=Pick<AppContext,'config'> & {db:MediaDatabase & Pick<Db,'prepare'>;users:Pick<AppContext['users'],'byId'>};

export function registerMediaRoutes(app:FastifyInstance,ctx:MediaRouteContext,options:{metadataProviders?:MetadataProvider[];database?:MediaDatabase & Pick<Db,'prepare'>}={}):void {
  const database=options.database||ctx.db;
  const accounts=new DatabaseMediaAccounts(ctx.db);
  const references=database!==ctx.db?new MediaAccountReferences(database,accounts):undefined;
  const settings=new BusinessSettingsReader(ctx.db);
  const libraries=new MediaLibraries(database,true,accounts,references),scanner=new MediaScanner(database,libraries,undefined,app.log,()=>settings.read('scanning'));
  const playback=new MediaPlayback(database,libraries,accounts,()=>settings.read('playback').mode);
  const background=new MediaBackgroundGrants(database,libraries,accounts);
  const userState=new MediaUserState(database,libraries,scanner.catalog);
  const scraping=new MediaScraping(database,scanner.catalog,options.metadataProviders??configuredProviders(settings));
  const hierarchy=new MediaHierarchy(database,scanner.catalog);
  const scrapeJobs=new MediaScrapeJobs(database,scanner.catalog,scraping,accounts);
  const artwork=new MediaArtwork(database,libraries);
  const subtitles=new MediaSubtitles(database,libraries);
  const lyrics=new MediaLyrics(database,libraries);
  const folders=new MediaFolders(database,libraries,scanner.catalog);
  const authenticateAccount=authenticate(ctx);
  const auth=async(request:import('fastify').FastifyRequest,reply:import('fastify').FastifyReply)=>{
    await authenticateAccount(request,reply);
    if(request.method!=='GET'&&request.method!=='HEAD')references?.ensure(currentUser(request).id);
  };
  const databasePath=database.all<{name:string;file:string}>('PRAGMA database_list').find(database=>database.name==='main')?.file;
  const catalogReader=databasePath ? new MediaCatalogReader(databasePath) : null;
  const queryCatalog=async (request:import('fastify').FastifyRequest,reply:import('fastify').FastifyReply,query:CatalogQuery)=>{
    // In-memory fixtures cannot share a separate SQLite connection.
    if(!catalogReader)return executeCatalogQuery(scanner.catalog,folders,userState,query);
    const result=await catalogReader.query(query);
    await auth(request,reply);
    const actor=currentUser(request),access=result.access!;
    const ids=libraries.list(actor).map(library=>library.id).sort();
    if(actor.id!==access.actor.id||actor.role!==access.actor.role||JSON.stringify(ids)!==JSON.stringify(access.libraryIds))
      throw new AppError(503,'MEDIA_ACCESS_CHANGED','目录权限已变化，请重新查询');
    return result.result;
  };
  app.get<{Params:{id:string};Querystring:{path?:string;offset?:number;limit?:number}}>('/api/v1/media/libraries/:id/folders',{preHandler:auth,schema:{querystring:{type:'object',properties:{path:{type:'string',maxLength:4000},offset:{type:'integer',minimum:0,default:0},limit:{type:'integer',minimum:1,maximum:200,default:60}}}}},async (request,reply)=>queryCatalog(request,reply,{method:'folders',args:[currentUser(request),request.params.id,request.query.path,request.query.offset,request.query.limit]}));
  app.get<{Params:{id:string}}>('/api/v1/media/assets/:id/catalog',{preHandler:auth},async (request,reply)=>queryCatalog(request,reply,{method:'file',args:[currentUser(request),request.params.id]}));
  app.get<{Params:{id:string}}>('/api/v1/media/parts/:id/lyrics',{preHandler:auth},async(request,reply)=>reply.header('cache-control','private, no-store').send(await lyrics.read(currentUser(request),request.params.id)));
  const backgroundToken=(request:import('fastify').FastifyRequest)=>typeof request.headers['x-media-background']==='string'?request.headers['x-media-background']:'';
  app.post<{Body:{partIds:string[]}}>('/api/v1/media/background-grants',{logLevel:'silent',preHandler:auth,schema:{body:{type:'object',additionalProperties:false,required:['partIds'],properties:{partIds:{type:'array',minItems:1,maxItems:2000,items:{type:'string',minLength:1,maxLength:100}}}}}},async(request,reply)=>reply.header('cache-control','no-store').status(201).send(background.create(currentUser(request),request.body.partIds)));
  app.delete('/api/v1/media/background-grants/current',{logLevel:'silent'},async(request,reply)=>{background.revoke(backgroundToken(request));return reply.status(204).send();});
  app.post<{Body:{partId:string}}>('/api/v1/media/background/playback',{logLevel:'silent',schema:{body:{type:'object',additionalProperties:false,required:['partId'],properties:{partId:{type:'string',minLength:1,maxLength:100}}}}},async(request,reply)=>{const token=backgroundToken(request);const session=playback.create(background.authorizePart(token,request.body.partId),request.body.partId);background.authorizeSession(token,session.id);return reply.header('cache-control','no-store').status(201).send(session);});
  app.post<{Params:{id:string}}>('/api/v1/media/background/playback/:id/renew',{logLevel:'silent'},async(request,reply)=>reply.header('cache-control','no-store').send(playback.renew(background.authorizeSession(backgroundToken(request),request.params.id),request.params.id)));
  app.put<{Params:{id:string};Body:{sequence:number;revision:number;position:number;completed?:boolean}}>('/api/v1/media/background/playback/:id/progress',{logLevel:'silent',schema:{body:{type:'object',additionalProperties:false,required:['sequence','revision','position'],properties:{sequence:{type:'integer',minimum:0},revision:{type:'integer',minimum:0},position:{type:'number',minimum:0},completed:{type:'boolean'}}}}},async(request,reply)=>reply.header('cache-control','no-store').send(playback.update(background.authorizeSession(backgroundToken(request),request.params.id),request.params.id,request.body)));
  const scrapeAdmin=[auth,async (request:import('fastify').FastifyRequest)=>requireAdmin(request)];
  app.get<{Params:{id:string}}>('/api/v1/media/background/playback/:id/subtitles',{logLevel:'silent'},async(request,reply)=>{
    const actor=background.authorizeSession(backgroundToken(request),request.params.id);
    const result=await subtitles.list(actor,playback.subtitleAsset(actor,request.params.id));
    background.authorizeSession(backgroundToken(request),request.params.id);
    return reply.header('cache-control','private, no-store').send(result);
  });
  app.get<{Params:{id:string;subtitleId:string}}>('/api/v1/media/background/playback/:id/subtitles/:subtitleId',{logLevel:'silent'},async(request,reply)=>{
    const actor=background.authorizeSession(backgroundToken(request),request.params.id);
    const result=await subtitles.read(actor,playback.subtitleAsset(actor,request.params.id),request.params.subtitleId);
    background.authorizeSession(backgroundToken(request),request.params.id);
    return reply.header('cache-control','private, no-store').send(result);
  });
  app.get<{Querystring:{summary?:boolean}}>('/api/v1/media/scrape-jobs',{preHandler:scrapeAdmin,schema:{querystring:{type:'object',properties:{summary:{type:'boolean'}}}}},async request=>request.query.summary?scrapeJobs.summaries(currentUser(request)):scrapeJobs.list(currentUser(request)));
  app.get<{Params:{id:string};Querystring:{state?:string;offset?:number;limit?:number}}>('/api/v1/media/scrape-jobs/:id/results',{preHandler:scrapeAdmin,schema:{querystring:{type:'object',properties:{state:{type:'string',enum:SCRAPE_RESULT_STATES},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:50}}}}},async request=>scrapeJobs.results(currentUser(request),request.params.id,request.query));
  app.post<{Params:{id:string}}>('/api/v1/media/scrape-jobs/:id/retry',{preHandler:scrapeAdmin},async(request,reply)=>reply.status(202).send(scrapeJobs.retry(currentUser(request),request.params.id)));
  app.post<{Params:{id:string}}>('/api/v1/media/items/:id/child-scrape-job',{preHandler:scrapeAdmin},async(request,reply)=>reply.status(202).send(scrapeJobs.startSeriesChildren(currentUser(request),request.params.id)));
  app.post<{Body:{provider:string;itemIds:string[]}}>('/api/v1/media/scrape-jobs',{preHandler:scrapeAdmin,schema:{body:{type:'object',additionalProperties:false,required:['provider','itemIds'],properties:{provider:{type:'string',enum:['tmdb','musicbrainz']},itemIds:{type:'array',minItems:1,maxItems:500,uniqueItems:true,items:{type:'string',minLength:1}}}}}},async(request,reply)=>reply.status(202).send(scrapeJobs.start(currentUser(request),request.body.provider,request.body.itemIds)));
  app.get<{Params:{id:string}}>('/api/v1/media/scrape-jobs/:id',{preHandler:scrapeAdmin},async request=>scrapeJobs.get(currentUser(request),request.params.id));
  app.post<{Params:{id:string}}>('/api/v1/media/scrape-jobs/:id/cancel',{preHandler:scrapeAdmin},async request=>scrapeJobs.cancel(currentUser(request),request.params.id));
  app.get('/api/v1/media/metadata/providers',{preHandler:scrapeAdmin},async request=>scraping.status(currentUser(request)));
  app.post<{Params:{id:string};Body:{provider:string}}>('/api/v1/media/items/:id/auto-match',{preHandler:scrapeAdmin,schema:{body:{type:'object',additionalProperties:false,required:['provider'],properties:{provider:{type:'string',enum:['tmdb','musicbrainz']}}}}},async request=>scraping.autoMatch(currentUser(request),request.params.id,request.body.provider));
  app.post<{Params:{id:string};Body:{provider:string;query:string;artist?:string}}>('/api/v1/media/items/:id/matches',{
    preHandler:scrapeAdmin,schema:{body:{type:'object',additionalProperties:false,required:['provider','query'],properties:{provider:{type:'string',enum:['tmdb','musicbrainz']},query:{type:'string',minLength:1,maxLength:200},artist:{type:'string',maxLength:200}}}},
  },async request=>scraping.search(currentUser(request),request.params.id,request.body.provider,request.body.query,undefined,undefined,request.body.artist));
  app.put<{Params:{id:string};Body:{candidateId:string}}>('/api/v1/media/items/:id/match',{
    preHandler:scrapeAdmin,schema:{body:{type:'object',additionalProperties:false,required:['candidateId'],properties:{candidateId:{type:'string',minLength:1,maxLength:100}}}},
  },async request=>scraping.confirm(currentUser(request),request.params.id,request.body.candidateId));
  app.delete<{Params:{id:string}}>('/api/v1/media/items/:id/match',{preHandler:scrapeAdmin},async request=>scraping.clear(currentUser(request),request.params.id));
  app.addHook('onClose',async()=>{await catalogReader?.close();await scrapeJobs.close();await scanner.close();});
  const pagination={type:'object',properties:{offset:{type:'integer',minimum:0,default:0},limit:{type:'integer',minimum:1,maximum:200,default:100}}};
  app.get('/api/v1/media/libraries',{preHandler:auth},async request=>({items:libraries.list(currentUser(request))}));
  app.get('/api/v1/media/library-summaries',{preHandler:scrapeAdmin},async(request,reply)=>{reply.header('cache-control','private, no-store');return queryCatalog(request,reply,{method:'librarySummaries',args:[currentUser(request)]});});
  app.get('/api/v1/media/scan-jobs',{preHandler:scrapeAdmin},async request=>({items:scanner.latestJobs(currentUser(request))}));
  app.post('/api/v1/media/scan-jobs',{preHandler:scrapeAdmin},async(request,reply)=>reply.status(202).send(scanner.startAll(currentUser(request))));
  app.get<{Querystring:{query:string;channel?:MediaLibraryKind;kind?:MediaItemKind;offset:number;limit:number}}>('/api/v1/media/search',{
    preHandler:auth,schema:{querystring:{...pagination,required:['query'],additionalProperties:false,properties:{...pagination.properties,query:{type:'string',minLength:1,maxLength:200,pattern:'\\S'},kind:{type:'string',enum:['movie','series','season','episode','artist','album','track','audiobook']},channel:{type:'string',enum:['video','music','audiobook']}}}},
  },async (request,reply)=>queryCatalog(request,reply,{method:'search',args:[currentUser(request),request.query.query,request.query]}));
  app.get<{Querystring:{channel?:MediaLibraryKind;offset?:number;limit?:number}}>('/api/v1/media/favorites',{preHandler:auth,schema:{querystring:{type:'object',properties:{channel:{type:'string',enum:['video','music','audiobook']},offset:{type:'integer',minimum:0,default:0},limit:{type:'integer',minimum:1,maximum:500,default:500}}}}},async (request,reply)=>queryCatalog(request,reply,{method:'favorites',args:[currentUser(request),request.query]}));
  app.get<{Querystring:{channel?:MediaLibraryKind;offset?:number;limit?:number}}>('/api/v1/media/history',{preHandler:auth,schema:{querystring:{type:'object',properties:{channel:{type:'string',enum:['video','music','audiobook']},offset:{type:'integer',minimum:0,default:0},limit:{type:'integer',minimum:1,maximum:500,default:100}}}}},async (request,reply)=>queryCatalog(request,reply,{method:'history',args:[currentUser(request),request.query]}));
  app.get('/api/v1/media/queue',{preHandler:auth},async request=>userState.queue(currentUser(request)));
  app.post<{Body:{partIds:string[]}}>('/api/v1/media/queue/preview',{preHandler:auth,schema:{body:{type:'object',additionalProperties:false,required:['partIds'],properties:{partIds:{type:'array',minItems:1,maxItems:2000,items:{type:'string',minLength:1,maxLength:100}}}}}},async request=>userState.previewQueue(currentUser(request),request.body.partIds));
  app.put<{Body:{partIds:string[];expectedRevision:string}}>('/api/v1/media/queue/snapshot',{preHandler:auth,schema:{body:{type:'object',additionalProperties:false,required:['partIds','expectedRevision'],properties:{partIds:{type:'array',minItems:1,maxItems:2000,items:{type:'string',minLength:1,maxLength:100}},expectedRevision:{type:'string',minLength:64,maxLength:64}}}}},async request=>userState.replaceQueue(currentUser(request),request.body.partIds,request.body.expectedRevision));
  app.post<{Body:{partIds:string[]}}>('/api/v1/media/queue',{preHandler:auth,schema:{body:{type:'object',required:['partIds'],properties:{partIds:{type:'array',minItems:1,maxItems:500,items:{type:'string'}}}}}},async request=>userState.enqueue(currentUser(request),request.body.partIds));
  app.delete<{Params:{id:string}}>('/api/v1/media/queue/:id',{preHandler:auth},async request=>userState.remove(currentUser(request),request.params.id));
  app.post<{Body:{channel:MediaLibraryKind;entryIds:string[]}}>('/api/v1/media/queue/clear',{preHandler:auth,schema:{body:{type:'object',additionalProperties:false,required:['channel','entryIds'],properties:{channel:{type:'string',enum:['video','music','audiobook']},entryIds:{type:'array',minItems:1,maxItems:2000,uniqueItems:true,items:{type:'string',minLength:1}}}}}},async request=>userState.clear(currentUser(request),request.body.channel,request.body.entryIds));
  app.post<{Params:{id:string};Body:{neighborId:string;direction:'up'|'down'}}>('/api/v1/media/queue/:id/move',{preHandler:auth,schema:{body:{type:'object',additionalProperties:false,required:['neighborId','direction'],properties:{neighborId:{type:'string',minLength:1},direction:{type:'string',enum:['up','down']}}}}},async request=>userState.move(currentUser(request),request.params.id,request.body.neighborId,request.body.direction));
  app.get<{Params:{id:string}}>('/api/v1/media/items/:id/favorite',{preHandler:auth},async request=>userState.isFavorite(currentUser(request),request.params.id));
  app.put<{Params:{id:string};Body:{favorite:boolean}}>('/api/v1/media/items/:id/favorite',{preHandler:auth,schema:{body:{type:'object',required:['favorite'],properties:{favorite:{type:'boolean'}}}}},async request=>userState.favorite(currentUser(request),request.params.id,request.body.favorite));
  const openlistCredentials={token:{type:'string',maxLength:4096},password:{type:'string',maxLength:4096}};
  app.post<{Body:CreateMediaLibrary}>('/api/v1/media/libraries',{
    logLevel:'silent',preHandler:[auth,async request=>requireAdmin(request)],schema:{body:{type:'object',additionalProperties:false,required:['name','kind','root','access'],properties:{requestId:{type:'string',minLength:16,maxLength:100,pattern:'^[A-Za-z0-9_-]+$'},name:{type:'string',minLength:1,maxLength:200},kind:{type:'string',enum:['video','music','audiobook']},root:{type:'string',minLength:1,maxLength:4000},access:{type:'string',enum:['all','restricted']},storage:{type:'string',enum:['local','openlist']},openlist:{type:'object',additionalProperties:false,required:['baseUrl'],properties:{baseUrl:{type:'string',minLength:1,maxLength:2048},...openlistCredentials}}}}},
  },async(request,reply)=>{
    try{return reply.status(201).send(await libraries.create(currentUser(request),request.body));}
    catch(error){if(['ENOENT','ENOTDIR','EACCES'].includes((error as NodeJS.ErrnoException).code||''))throw badRequest('media directory is not accessible','MEDIA_DIRECTORY_UNAVAILABLE');throw error;}
  });
  app.get<{Params:{id:string}}>('/api/v1/media/libraries/:id',{preHandler:auth},async request=>libraries.get(currentUser(request),request.params.id));
  app.get<{Params:{id:string}}>('/api/v1/media/libraries/:id/configuration',{preHandler:[auth,async request=>requireAdmin(request)]},async(request,reply)=>reply.header('cache-control','private, no-store').send(libraries.configuration(currentUser(request),request.params.id)));
  app.patch<{Params:{id:string};Body:{name?:string;openlist?:Pick<OpenListConnection,'token'|'password'>}}>('/api/v1/media/libraries/:id',{logLevel:'silent',preHandler:[auth,async request=>requireAdmin(request)],schema:{body:{type:'object',additionalProperties:false,minProperties:1,properties:{name:{type:'string',minLength:1,maxLength:200},openlist:{type:'object',additionalProperties:false,minProperties:1,properties:openlistCredentials}}}}},async request=>libraries.update(currentUser(request),request.params.id,request.body));
  app.put<{Params:{id:string};Body:{access:'all'|'restricted';userIds:string[]}}>('/api/v1/media/libraries/:id/access',{preHandler:[auth,async request=>requireAdmin(request)],schema:{body:{type:'object',additionalProperties:false,required:['access','userIds'],properties:{access:{type:'string',enum:['all','restricted']},userIds:{type:'array',maxItems:1000,items:{type:'string'}}}}}},async(request,reply)=>{
    libraries.setAccess(currentUser(request),request.params.id,request.body.access,request.body.userIds);return reply.status(204).send();
  });
  app.post<{Params:{id:string}}>('/api/v1/media/libraries/:id/scan',{preHandler:[auth,async request=>requireAdmin(request)]},async(request,reply)=>reply.status(202).send(scanner.start(currentUser(request),request.params.id)));
  app.get<{Params:{id:string}}>('/api/v1/media/libraries/:id/jobs',{preHandler:auth},async request=>({items:scanner.jobs(currentUser(request),request.params.id)}));
  app.get<{Params:{id:string}}>('/api/v1/media/jobs/:id',{preHandler:auth},async request=>scanner.job(currentUser(request),request.params.id));
  app.post<{Params:{id:string}}>('/api/v1/media/jobs/:id/cancel',{preHandler:[auth,async request=>requireAdmin(request)]},async(request,reply)=>reply.status(202).send(scanner.cancel(currentUser(request),request.params.id)));
  app.get<{Params:{id:string};Querystring:{offset:number;limit:number}}>('/api/v1/media/libraries/:id/assets',{preHandler:auth,schema:{querystring:pagination}},async request=>scanner.assets(currentUser(request),request.params.id,request.query.offset,request.query.limit));
  app.get<{Params:{id:string}}>('/api/v1/media/assets/:id',{preHandler:auth},async request=>scanner.asset(currentUser(request),request.params.id));
  app.get<{Params:{id:string}}>('/api/v1/media/assets/:id/subtitles',{preHandler:auth},async(request,reply)=>{
    reply.header('cache-control','private, no-store');return subtitles.list(currentUser(request),request.params.id);
  });
  app.get<{Params:{id:string;subtitleId:string}}>('/api/v1/media/assets/:id/subtitles/:subtitleId',{preHandler:auth},async(request,reply)=>{
    reply.header('cache-control','private, no-store');return subtitles.read(currentUser(request),request.params.id,request.params.subtitleId);
  });
  app.get<{Params:{id:string};Querystring:{kind?:MediaBrowseKind;parentId?:string;search?:string;artist?:string;album?:string;offset:number;limit:number;sort?:MediaSort}}>('/api/v1/media/libraries/:id/items',{
    preHandler:auth,schema:{querystring:{...pagination,properties:{...pagination.properties,artist:{type:'string',maxLength:200},album:{type:'string',maxLength:200},sort:{type:'string',enum:['default','title-asc','title-desc']},kind:{type:'string',enum:['video','movie','series','season','episode','artist','album','track','audiobook']},parentId:{type:'string'},search:{type:'string',maxLength:200}}}},
  },async (request,reply)=>queryCatalog(request,reply,{method:'list',args:[currentUser(request),request.params.id,request.query]}));
  app.get<{Params:{id:string}}>('/api/v1/media/items/:id',{preHandler:auth},async (request,reply)=>queryCatalog(request,reply,{method:'detail',args:[currentUser(request),request.params.id]}));
  app.post<{Params:{id:string};Body:CreateVideoParent}>('/api/v1/media/items/:id/hierarchy',{
    preHandler:[auth,async request=>requireAdmin(request)],schema:{body:{type:'object',additionalProperties:false,required:['ordinal','expectedParentId','expectedOrdinal'],properties:{seriesTitle:{type:'string',minLength:1,maxLength:200},targetSeriesId:{type:'string',minLength:1,maxLength:100},seasonOrdinal:{type:'integer',minimum:0,maximum:9999},ordinal:{type:'integer',minimum:0,maximum:99999},expectedParentId:{anyOf:[{type:'string',minLength:1,maxLength:100},{type:'null'}]},expectedOrdinal:{type:'integer',minimum:0,maximum:99999}}}},
  },async(request,reply)=>reply.status(201).send(hierarchy.createParent(currentUser(request),request.params.id,request.body)));
  app.put<{Params:{id:string};Body:{targetParentId:string;ordinal:number;expectedParentId:string|null;expectedOrdinal:number}}>('/api/v1/media/items/:id/hierarchy',{
    preHandler:[auth,async request=>requireAdmin(request)],schema:{body:{type:'object',additionalProperties:false,required:['targetParentId','ordinal','expectedParentId','expectedOrdinal'],properties:{targetParentId:{type:'string',minLength:1,maxLength:100},ordinal:{type:'integer',minimum:0,maximum:99999},expectedParentId:{anyOf:[{type:'string',minLength:1,maxLength:100},{type:'null'}]},expectedOrdinal:{type:'integer',minimum:0,maximum:99999}}}},
  },async request=>hierarchy.moveVideo(currentUser(request),request.params.id,request.body));
  app.post<{Params:{id:string};Body:{title:string;expectedParentId:string|null}}>('/api/v1/media/items/:id/parent',{
    preHandler:[auth,async request=>requireAdmin(request)],schema:{body:{type:'object',additionalProperties:false,required:['title','expectedParentId'],properties:{title:{type:'string',minLength:1,maxLength:200},expectedParentId:{anyOf:[{type:'string',minLength:1,maxLength:100},{type:'null'}]}}}},
  },async(request,reply)=>reply.status(201).send(scanner.catalog.createMusicParent(currentUser(request),request.params.id,request.body.title,request.body.expectedParentId)));
  app.put<{Params:{id:string};Body:{targetParentId:string;expectedParentId:string|null}}>('/api/v1/media/items/:id/parent',{
    preHandler:[auth,async request=>requireAdmin(request)],schema:{body:{type:'object',additionalProperties:false,required:['targetParentId','expectedParentId'],properties:{targetParentId:{type:'string',minLength:1,maxLength:100},expectedParentId:{anyOf:[{type:'string',minLength:1,maxLength:100},{type:'null'}]}}}},
  },async request=>scanner.catalog.reparentMusic(currentUser(request),request.params.id,request.body.targetParentId,request.body.expectedParentId));
  app.get<{Querystring:{channel:MediaLibraryKind;kind:MediaBrowseKind;artist?:string;album?:string;offset:number;limit:number;sort?:MediaSort}}>('/api/v1/media/browse',{preHandler:auth,schema:{querystring:{...pagination,required:['channel','kind'],properties:{...pagination.properties,artist:{type:'string',maxLength:200},album:{type:'string',maxLength:200},sort:{type:'string',enum:['default','title-asc','title-desc']},channel:{type:'string',enum:['video','music','audiobook']},kind:{type:'string',enum:['video','movie','series','artist','album','track','audiobook']}}}}},async (request,reply)=>queryCatalog(request,reply,{method:'browse',args:[currentUser(request),request.query.channel,request.query.kind,request.query]}));
  app.get<{Querystring:{name?:string;search?:string;offset:number;limit:number}}>('/api/v1/media/narrators',{preHandler:auth,schema:{querystring:{...pagination,properties:{...pagination.properties,name:{type:'string',minLength:1,maxLength:2000},search:{type:'string',maxLength:200}}}}},async request=>scanner.catalog.narrators(currentUser(request),'',request.query));
  app.get<{Params:{id:string}}>('/api/v1/media/items/:id/album-playback',{preHandler:auth},async request=>scanner.catalog.albumPlayback(currentUser(request),request.params.id));
  app.get<{Params:{id:string};Querystring:{name?:string;search?:string;offset:number;limit:number}}>('/api/v1/media/libraries/:id/narrators',{
    preHandler:auth,schema:{querystring:{...pagination,properties:{...pagination.properties,name:{type:'string',minLength:1,maxLength:2000},search:{type:'string',maxLength:200}}}},
  },async request=>scanner.catalog.narrators(currentUser(request),request.params.id,request.query));
  app.get<{Params:{id:string}}>('/api/v1/media/items/:id/matches',{preHandler:scrapeAdmin},async(request,reply)=>{
    reply.header('cache-control','private, no-store');return scraping.candidates(currentUser(request),request.params.id);
  });
  app.get<{Params:{id:string}}>('/api/v1/media/items/:id/season-playback',{preHandler:auth},async request=>scanner.catalog.seasonPlayback(currentUser(request),request.params.id));
  app.get<{Params:{id:string}}>('/api/v1/media/items/:id/series-playback',{preHandler:auth},async request=>scanner.catalog.seriesPlayback(currentUser(request),request.params.id));
  app.patch<{Params:{id:string};Body:{label:string;expectedLabel:string}}>('/api/v1/media/editions/:id',{preHandler:[auth,async request=>requireAdmin(request)],schema:{body:{type:'object',additionalProperties:false,required:['label','expectedLabel'],properties:{label:{type:'string',minLength:1,maxLength:200},expectedLabel:{type:'string',maxLength:32000}}}}},async request=>scanner.catalog.renameEdition(currentUser(request),request.params.id,request.body.label,request.body.expectedLabel));
  app.put<{Params:{id:string};Body:{targetItemId:string;expectedItemId:string}}>('/api/v1/media/editions/:id/item',{
    preHandler:[auth,async request=>requireAdmin(request)],
    schema:{body:{type:'object',additionalProperties:false,required:['targetItemId','expectedItemId'],properties:{targetItemId:{type:'string',minLength:1,maxLength:200},expectedItemId:{type:'string',minLength:1,maxLength:200}}}},
  },async request=>scanner.catalog.reassignEdition(currentUser(request),request.params.id,request.body.targetItemId,request.body.expectedItemId));
  app.post<{Params:{id:string};Body:{title:string;expectedItemId:string}}>('/api/v1/media/editions/:id/new-item',{
    preHandler:[auth,async request=>requireAdmin(request)],
    schema:{body:{type:'object',additionalProperties:false,required:['title','expectedItemId'],properties:{title:{type:'string',minLength:1,maxLength:200},expectedItemId:{type:'string',minLength:1,maxLength:200}}}},
  },async(request,reply)=>reply.status(201).send(scanner.catalog.createEditionItem(currentUser(request),request.params.id,request.body.title,request.body.expectedItemId)));
  app.post<{Params:{id:string};Body:{expectedRevision:string;assetIds:string[];label:string}}>('/api/v1/media/editions/:id/split',{
    preHandler:[auth,async request=>requireAdmin(request)],schema:{body:{type:'object',additionalProperties:false,required:['expectedRevision','assetIds','label'],properties:{expectedRevision:{type:'string',minLength:64,maxLength:64},assetIds:{type:'array',minItems:1,maxItems:2000,uniqueItems:true,items:{type:'string',minLength:1,maxLength:200}},label:{type:'string',minLength:1,maxLength:200}}}},
  },async request=>scanner.catalog.splitEdition(currentUser(request),request.params.id,request.body));
  app.post<{Params:{id:string};Body:{expectedRevision:string;targetEditionId:string;targetRevision:string}}>('/api/v1/media/editions/:id/merge',{
    preHandler:[auth,async request=>requireAdmin(request)],schema:{body:{type:'object',additionalProperties:false,required:['expectedRevision','targetEditionId','targetRevision'],properties:{expectedRevision:{type:'string',minLength:64,maxLength:64},targetRevision:{type:'string',minLength:64,maxLength:64},targetEditionId:{type:'string',minLength:1,maxLength:200}}}},
  },async request=>scanner.catalog.mergeEditions(currentUser(request),request.params.id,request.body));
  app.put<{Params:{id:string};Body:{expectedRevision:string;partIds:string[]|null}}>('/api/v1/media/editions/:id/order',{
    preHandler:[auth,async request=>requireAdmin(request)],schema:{body:{type:'object',additionalProperties:false,required:['expectedRevision','partIds'],properties:{expectedRevision:{type:'string',minLength:64,maxLength:64},partIds:{anyOf:[{type:'null'},{type:'array',maxItems:10000,uniqueItems:true,items:{type:'string',minLength:1,maxLength:200}}]}}}},
  },async request=>scanner.catalog.orderEdition(currentUser(request),request.params.id,request.body));
  app.post<{Body:{partId:string;previousSessionId:string}}>('/api/v1/media/playback/recover',{preHandler:auth,schema:{body:{type:'object',additionalProperties:false,required:['partId','previousSessionId'],properties:{partId:{type:'string',minLength:1,maxLength:100},previousSessionId:{type:'string',minLength:1,maxLength:100}}}}},async(request,reply)=>reply.header('cache-control','no-store').status(201).send(playback.recover(currentUser(request),request.body.partId,request.body.previousSessionId)));
  app.get<{Params:{id:string}}>('/api/v1/media/items/:id/cover',{preHandler:auth},async(request,reply)=>{
    const cover=await artwork.cover(currentUser(request),request.params.id);
    return reply.type(cover.contentType).header('cache-control','private, no-store').header('x-content-type-options','nosniff')
      .header('content-security-policy',"default-src 'none'; sandbox").send(cover.bytes);
  });
  app.patch<{Params:{id:string};Body:Record<string,unknown>}>('/api/v1/media/items/:id/metadata',{preHandler:[auth,async request=>requireAdmin(request)],schema:{body:{type:'object'}}},async request=>{
    scanner.catalog.override(currentUser(request),request.params.id,request.body);return scanner.catalog.detail(currentUser(request),request.params.id);
  });
  app.post<{Body:{partId:string}}>('/api/v1/media/playback',{preHandler:auth,schema:{body:{type:'object',required:['partId'],additionalProperties:false,properties:{partId:{type:'string'}}}}},async(request,reply)=>reply.status(201).send(playback.create(currentUser(request),request.body.partId)));
  app.post<{Params:{id:string}}>('/api/v1/media/playback/:id/renew',{preHandler:auth},async(request,reply)=>{
    reply.header('cache-control','no-store');
    return playback.renew(currentUser(request),request.params.id);
  });
  app.get<{Params:{id:string}}>('/api/v1/media/parts/:id/progress',{preHandler:auth},async request=>playback.progress(currentUser(request),request.params.id));
  app.put<{Params:{id:string};Body:{sequence:number;revision:number;position:number;completed?:boolean}}>('/api/v1/media/playback/:id/progress',{
    preHandler:auth,schema:{body:{type:'object',additionalProperties:false,required:['sequence','revision','position'],properties:{sequence:{type:'integer',minimum:0},revision:{type:'integer',minimum:0},position:{type:'number',minimum:0},completed:{type:'boolean'}}}},
  },async request=>playback.update(currentUser(request),request.params.id,request.body));
  // Scope URL credentials to one read-only session; suppress request URL logs for these routes.
  app.get<{Params:{id:string};Querystring:{ticket:string;proxy?:string}}>('/api/v1/media/streams/:id',{
    logLevel:'silent',schema:{querystring:{type:'object',required:['ticket'],properties:{ticket:{type:'string',minLength:40,maxLength:100},proxy:{type:'string',enum:['1']}}}},
  },async(request,reply)=>{
    const started=performance.now(),mode=settings.read('playback').mode;
    reply.header('cache-control','private, no-store').header('referrer-policy','no-referrer');
    try {
      if(mode!=='proxy'&&request.query.proxy!=='1'){
        const url=await playback.directUrl(request.params.id,request.query.ticket);
        // HTTPS pages cannot load insecure media; auto mode keeps that traffic server-side.
        if(url&&!(mode==='auto'&&settings.read('access').publicUrl.startsWith('https:')&&url.startsWith('http:'))){
          const elapsedMs=Math.round(performance.now()-started);
          app.log.info({sessionId:request.params.id,transport:'direct',elapsedMs},'media playback source ready');
          return reply.header('server-timing',`resolve;dur=${elapsedMs}`).redirect(url,307);
        }
      }
      const result=await playback.stream(request.params.id,request.query.ticket,request.headers.range);
      const elapsedMs=Math.round(performance.now()-started);
      app.log.info({sessionId:request.params.id,transport:'proxy',elapsedMs,rangeStart:result.start},'media playback source ready');
      reply.header('server-timing',`upstream;dur=${elapsedMs}`);
      reply.header('cache-control','private, no-store').header('referrer-policy','no-referrer').header('accept-ranges','bytes').type(result.contentType);
      reply.header('content-length',result.entry.size?result.end-result.start+1:0);
      if(result.partial)reply.status(206).header('content-range',`bytes ${result.start}-${result.end}/${result.entry.size}`);
      reply.raw.once('close',()=>result.stream.destroy());
      return reply.send(result.stream);
    } catch(error) {
      const code=(error as {code?:string}).code;
      app.log.warn({sessionId:request.params.id,code,elapsedMs:Math.round(performance.now()-started)},'media playback source failed');
      if(code==='MEDIA_RANGE'||code==='invalid-range'){
        const {part}=playback.authorizeStream(request.params.id,request.query.ticket);
        return reply.status(416).header('content-range',`bytes */${part.size}`).send({error:{code:'MEDIA_RANGE',message:'unsatisfiable range'}});
      }
      if(code==='ENOENT')return reply.status(404).send({error:{code:'MEDIA_MISSING',message:'media resource is missing'}});
      throw error;
    }
  });
}
