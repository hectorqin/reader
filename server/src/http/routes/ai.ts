import type {FastifyInstance} from 'fastify';
import type {AppContext} from '../context.ts';
import {authenticate,currentUser,requireAdmin} from '../auth.ts';
import {badRequest} from '../../lib/errors.ts';
import {AiService} from '../../services/ai.ts';
import {BusinessSettingsReader} from '../../services/business-settings.ts';
export function registerAiRoutes(app:FastifyInstance,ctx:AppContext){
 const service=new AiService(ctx.db,()=>new BusinessSettingsReader(ctx.db).read('ai'),app.log); const auth=authenticate(ctx), admin=async(req:any,reply:any)=>{await auth(req,reply);requireAdmin(req);};
 app.post<{Body:{baseUrl?:string;apiKey?:string}}>('/api/v1/admin/ai/models',{preHandler:admin,schema:{body:{type:'object',additionalProperties:false,properties:{baseUrl:{type:'string',maxLength:4096},apiKey:{type:'string',maxLength:4096}}}}},async req=>({models:await service.models(req.body?.baseUrl,req.body?.apiKey)}));
 // What a reader may ask for, so the client can leave out a button that would only answer AI_DISABLED.
 app.get('/api/v1/ai/capabilities',{preHandler:auth},async()=>{const c=new BusinessSettingsReader(ctx.db).read('ai');const configured=!!(c.baseUrl&&c.apiKey&&c.model);return {summary:c.enabled&&c.summaryEnabled&&configured,scan:c.enabled&&c.scanEnabled&&configured,assist:c.enabled&&c.assistEnabled&&configured};});
 app.post<{Body:{bookId:string;chapterId:string;content:string}}>('/api/v1/ai/summary',{preHandler:auth},async req=>{const body=req.body;if(!body||typeof body.bookId!=='string'||typeof body.chapterId!=='string'||typeof body.content!=='string')throw badRequest('缺少章节内容'); return service.summary(currentUser(req).id,body.bookId,body.chapterId,body.content);});
 // A question about a passage the reader selected. The lengths are checked again in the service, which words the refusal.
 app.post<{Body:{bookId:string;action:'translate'|'explain'|'ask';text:string;context?:string;question?:string}}>('/api/v1/ai/assist',{preHandler:auth,schema:{body:{type:'object',additionalProperties:false,required:['bookId','action','text'],properties:{bookId:{type:'string',minLength:1,maxLength:200},action:{type:'string',enum:['translate','explain','ask']},text:{type:'string',maxLength:20000},context:{type:'string',maxLength:20000},question:{type:'string',maxLength:2000}}}}},async req=>{const {bookId,...input}=req.body;return service.assist(currentUser(req).id,bookId,input);});
}
