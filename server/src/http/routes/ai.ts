import type {FastifyInstance} from 'fastify';
import type {AppContext} from '../context.ts';
import {authenticate,currentUser,requireAdmin} from '../auth.ts';
import {badRequest} from '../../lib/errors.ts';
import {AiService} from '../../services/ai.ts';
import {BusinessSettingsReader} from '../../services/business-settings.ts';
export function registerAiRoutes(app:FastifyInstance,ctx:AppContext){
 const service=new AiService(ctx.db,()=>new BusinessSettingsReader(ctx.db).read('ai')); const auth=authenticate(ctx), admin=async(req:any,reply:any)=>{await auth(req,reply);requireAdmin(req);};
 app.get('/api/v1/admin/ai/models',{preHandler:admin},async()=>({models:await service.models()}));
 app.post<{Body:{libraryId:string;paths?:string[]}}>('/api/v1/admin/ai/scan',{preHandler:admin},async req=>{const body=req.body;if(!body?.libraryId)throw badRequest('缺少媒体库'); let paths=body.paths;if(!paths){paths=ctx.db.all<{ref:string}>('SELECT ref FROM media_assets WHERE library_id=? AND available=1 ORDER BY ref',body.libraryId).map(x=>x.ref);}if(paths.length>50000)throw badRequest('路径数量过多');const c=new BusinessSettingsReader(ctx.db).read('ai');const groups=new Map<string,string[]>();for(const p of paths){const dir=p.replace(/[\\/][^\\/]*$/,'');const list=groups.get(dir)||[];list.push(p);groups.set(dir,list);}const batches:string[][]=[];let batch:string[]=[];for(const group of groups.values()){if(batch.length&&batch.length+group.length>c.batchSize){batches.push(batch);batch=[];}batch.push(...group);if(batch.length>=c.batchSize){batches.push(batch);batch=[];}}if(batch.length)batches.push(batch);const items=[];for(const part of batches){const result=await service.scan(body.libraryId,part);items.push(...result.items);}return {items,total:paths.length,batches:batches.length};});
 app.post<{Body:{bookId:string;chapterId:string;content:string}}>('/api/v1/ai/summary',{preHandler:auth},async req=>{const body=req.body;if(!body||typeof body.bookId!=='string'||typeof body.chapterId!=='string'||typeof body.content!=='string')throw badRequest('缺少章节内容'); return service.summary(currentUser(req).id,body.bookId,body.chapterId,body.content);});
}
