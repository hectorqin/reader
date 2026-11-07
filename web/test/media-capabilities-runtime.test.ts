// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import type {Platform,HttpResponse} from '../src/core/platform.ts';
import {FakeTransport,makePlatform} from './helpers/env.ts';
import {createAppRuntime} from '../src/app/runtime.ts';
import {useAuthStore} from '../src/shared/stores/auth.store.ts';

const fixture=vi.hoisted(()=>({platform:null as Platform|null,created:0,stopped:vi.fn()}));
vi.mock('../src/core/web-platform.ts',()=>({createWebPlatform:async()=>fixture.platform}));
vi.mock('../src/core/sync.ts',()=>({SyncEngine:class{
  start(){} stop(){} async flush(){} onStatus(){return ()=>{};}
  status(){return {state:'idle',lastSyncAt:null,pending:false,message:''};}
}}));
vi.mock('../src/features/media/services/player.ts',()=>({MediaPlayer:class extends EventTarget{
  active=true;
  constructor(){super();fixture.created++;}
  async stop(){this.active=false;fixture.stopped();}
  async flush(){} reconnectNative(){}
}}));

afterEach(()=>{fixture.created=0;fixture.stopped.mockClear();useAuthStore.setState({session:null,verifiedUser:null});});

async function setup(enabled=false){
  const transport=new FakeTransport(),platform=makePlatform(transport);
  fixture.platform=platform;
  const user={id:'reader',username:'reader',displayName:'Reader',role:'member' as const,createdAt:0,mediaEnabled:true,features:{media:enabled}};
  const session={user,accessToken:'access',refreshToken:'refresh',accessTokenExpiresAt:9e15,refreshTokenExpiresAt:9e15};
  await platform.kv.set('reader.session.v1',JSON.stringify(session));
  transport.json({user});
  const runtime=await createAppRuntime('https://reader.example');
  return {runtime,transport,user,session};
}

it('pure-reading startup, page flush and capability polling do not initialize a player',async()=>{
  const {runtime}=await setup();
  const disconnect=runtime.connect();
  try{
    await runtime.flush();await runtime.saveBeforeUpdate();await runtime.refreshCapabilities();
    expect(fixture.created).toBe(0);
    expect(useAuthStore.getState().verifiedUser?.features?.media).toBe(false);
  }finally{disconnect();runtime.queryClient.clear();}
});

it('revocation stops an existing player once and cancels media caches',async()=>{
  const {runtime,transport,user}=await setup(true);
  void runtime.player;
  runtime.queryClient.setQueryData(['media','scope','history'],{private:true});
  transport.json({user:{...user,features:{media:false}}});
  await runtime.refreshCapabilities();await runtime.refreshCapabilities();
  expect(fixture.created).toBe(1);expect(fixture.stopped).toHaveBeenCalledOnce();
  expect(runtime.queryClient.getQueryData(['media','scope','history'])).toBeUndefined();
  expect(useAuthStore.getState().verifiedUser?.features?.media).toBe(false);
  runtime.queryClient.clear();
});

it('concurrent capability refreshes share one request',async()=>{
  const {runtime,transport,user}=await setup();
  let finish!:(response:HttpResponse)=>void;
  transport.respondWith(()=>new Promise(resolve=>{finish=resolve;}));
  const requests=transport.requests.length;
  const first=runtime.refreshCapabilities(),second=runtime.refreshCapabilities();
  await vi.waitFor(()=>expect(transport.requests.length).toBe(requests+1));
  finish({status:200,headers:{},json:{user}});
  await Promise.all([first,second]);runtime.queryClient.clear();
});

it('a late capability response from the previous account cannot enable media on the new account',async()=>{
  const {runtime,transport,user,session}=await setup();
  const disconnect=runtime.connect();
  try{
    let finish!:(response:HttpResponse)=>void;
    transport.respondWith(()=>new Promise(resolve=>{finish=resolve;}));
    const old=runtime.refreshCapabilities();
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    const nextUser={...user,id:'other',features:{media:false}};
    transport.respondWith(request=>({status:200,headers:{},json:request.url.endsWith('/login')?{...session,user:nextUser}:{user:nextUser}}));
    await runtime.api.login('other','password123');
    await runtime.refreshCapabilities();
    finish({status:200,headers:{},json:{user:{...user,features:{media:true}}}});
    await old.catch(()=>undefined);
    expect(useAuthStore.getState().verifiedUser?.id).toBe('other');
    expect(useAuthStore.getState().verifiedUser?.features?.media).toBe(false);
    expect(fixture.created).toBe(0);
  }finally{disconnect();runtime.queryClient.clear();}
});
