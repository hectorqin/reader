/** Disposable real HTTP server for the JVM background-sync integration test. */
import Fastify from 'fastify';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '../src/db/index.ts';
import { loadConfig } from '../src/config/index.ts';
import { UserService } from '../src/services/users.ts';
import { signAccessToken } from '../src/services/tokens.ts';
import { registerMediaRoutes } from '../src/http/routes/media.ts';
import { registerErrorHandler } from '../src/http/errors.ts';
import type { AppContext } from '../src/http/context.ts';
import { MediaLibraries } from '../src/media/libraries.ts';
import { MediaScanner } from '../src/media/scanner.ts';
import { MediaPlayback } from '../src/media/playback.ts';

const root=await mkdtemp(join(tmpdir(),'native-media-integration-'));
const media=join(root,'media');await mkdir(media);await mkdir(join(root,'books'));
process.env.BOOKS_DIR=join(root,'books');process.env.DATA_DIR=join(root,'data');process.env.READER_TOKEN_SECRET='native-fixture-only';
const config=loadConfig(),db=new Db(':memory:'),app=Fastify({logger:false});
const libraries=new MediaLibraries(db),scanner=new MediaScanner(db,libraries,async()=>({status:'ready',info:{duration:30,format:'wav',streams:[],tags:{},chapters:[]}}));
db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('test','test','unused','admin',0,0)");
const actor={id:'test',role:'admin'} as const;
await writeFile(join(media,'first.wav'),'fixture');await writeFile(join(media,'second.wav'),'fixture');
for(const name of ['first','second'])await writeFile(join(media,name+'.zh.srt'),'1\n00:00:00,000 --> 00:00:05,000\n原生字幕联调');
const library=await libraries.create(actor,{name:'fixture',kind:'music',root:media,access:'all'});
scanner.start(actor,library.id);await scanner.wait(library.id);
const parts=db.all<{id:string}>('SELECT id FROM media_parts ORDER BY id').map(row=>row.id);
registerErrorHandler(app);registerMediaRoutes(app,{db,config,users:new UserService(db,config)} as AppContext);
const baseUrl=await app.listen({host:'127.0.0.1',port:0});
const session=new MediaPlayback(db,libraries).create(actor,parts[0]!);
process.stdout.write(JSON.stringify({...session,baseUrl,userId:actor.id,accessToken:signAccessToken(config,actor).token,queueId:'fixture-queue',queue:parts.map(partId=>({partId,title:partId}))})+'\n');
let closing=false;
async function close(){if(closing)return;closing=true;await app.close();await scanner.close();db.close();await rm(root,{recursive:true,force:true});process.exit(0);}
process.stdin.resume();process.stdin.once('data',()=>void close());process.stdin.once('end',()=>void close());
setTimeout(()=>void close(),120000).unref();
