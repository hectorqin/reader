import {parentPort,workerData} from 'node:worker_threads';
import {timingSafeEqual} from 'node:crypto';
import Fastify from 'fastify';
import type {AppConfig} from '../config/index.ts';
import type {UserRow} from '../services/users.ts';
import {registerMediaRoutes} from '../http/routes/media.ts';
import {registerErrorHandler} from '../http/errors.ts';
import {MediaReadDatabase} from './read-database.ts';
import {MediaStoreDatabase} from './store-database.ts';
import {DatabaseMediaAccounts} from './accounts.ts';
import {MediaAccountCleanup} from './account-cleanup.ts';
import {prepareMediaDatabase} from './migrate-database.ts';

const {corePath,mediaPath,secret,config}=workerData as {corePath:string;mediaPath:string;secret:string;config:AppConfig};
// Copy and integrity checks run off the reading event loop. Fresh installations
// create their media schemas below, never in the reading database.
prepareMediaDatabase(corePath,mediaPath);
await new Promise<void>((resolve,reject)=>{
  const activated=(message:{type:string})=>{
    if(message.type==='activated'){parentPort!.off('message',activated);resolve();}
    if(message.type==='close'){parentPort!.off('message',activated);reject(new Error('media startup closed'));}
  };
  parentPort!.on('message',activated);
  parentPort!.postMessage({type:'prepared'});
});
const core=new MediaReadDatabase(corePath),media=new MediaStoreDatabase(mediaPath);
const app=Fastify({logger:false,bodyLimit:8*1024*1024,routerOptions:{maxParamLength:16_384}});
const expected=Buffer.from(secret);
app.addHook('onRequest',async(request,reply)=>{
  const header=request.headers['x-reader-media-internal'];
  const actual=Buffer.from(typeof header==='string'?header:'');
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return reply.status(403).send({error:{code:'MEDIA_INTERNAL_ONLY',message:'forbidden'}});
});
registerErrorHandler(app);
registerMediaRoutes(app,{config,db:core,users:{byId:id=>core.get<UserRow>(
  // Authentication needs account status and public profile, never password hashes.
  "SELECT id,username,display_name,role,disabled,created_at,updated_at,auth_version,'' AS password_hash FROM users WHERE id=?",id)}},{database:media});
let closing=false;
const cleanup=new MediaAccountCleanup(media,new DatabaseMediaAccounts(core));
let cleanupTimer:ReturnType<typeof setInterval>|undefined;
parentPort!.on('message',async(message:{type:string})=>{
  if(message.type!=='close'||closing)return;
  closing=true;
  clearInterval(cleanupTimer);
  try{await app.close();}finally{media.close();core.close();parentPort!.close();}
});
try{
  const origin=await app.listen({host:'127.0.0.1',port:0});
  parentPort!.postMessage({type:'ready',origin});
  cleanupTimer=setInterval(()=>{
    try{cleanup.sweep();}catch{console.warn('media account cleanup deferred; will retry');}
  },60000);cleanupTimer.unref();
}catch(error){await app.close();media.close();core.close();throw error;}
