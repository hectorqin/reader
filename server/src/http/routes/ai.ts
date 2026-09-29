import type {FastifyInstance} from 'fastify';
import type {AppContext} from '../context.ts';
import {authenticate,currentUser,requireAdmin} from '../auth.ts';
import {badRequest} from '../../lib/errors.ts';
import {AiService} from '../../services/ai.ts';
import {BusinessSettingsReader} from '../../services/business-settings.ts';
export function registerAiRoutes(app:FastifyInstance,ctx:AppContext){
 const service=new AiService(ctx.db,()=>new BusinessSettingsReader(ctx.db).read('ai')); const auth=authenticate(ctx), admin=async(req:any,reply:any)=>{await auth(req,reply);requireAdmin(req);};
 app.post<{Body:{baseUrl?:string;apiKey?:string}}>('/api/v1/admin/ai/models',{preHandler:admin,schema:{body:{type:'object',additionalProperties:false,properties:{baseUrl:{type:'string',maxLength:4096},apiKey:{type:'string',maxLength:4096}}}}},async req=>({models:await service.models(req.body?.baseUrl,req.body?.apiKey)}));
 app.post<{Body:{bookId:string;chapterId:string;content:string}}>('/api/v1/ai/summary',{preHandler:auth},async req=>{const body=req.body;if(!body||typeof body.bookId!=='string'||typeof body.chapterId!=='string'||typeof body.content!=='string')throw badRequest('缺少章节内容'); return service.summary(currentUser(req).id,body.bookId,body.chapterId,body.content);});
}