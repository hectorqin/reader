import {expect,it,vi} from 'vitest';
import {ReaderApi} from '../src/api/client.ts';
import {FakeTransport,makePlatform} from './helpers/env.ts';

it('persists effective capabilities for offline restore and preserves them through token renewal',async()=>{
  const transport=new FakeTransport();
  const user={id:'reader',username:'reader',displayName:'Reader',role:'member' as const,createdAt:0,mediaEnabled:true};
  const session={user,accessToken:'access',refreshToken:'refresh',accessTokenExpiresAt:9e15,refreshTokenExpiresAt:9e15};
  const save=vi.fn(async(_value:unknown)=>undefined);
  const api=new ReaderApi(makePlatform(transport),{load:async()=>session,save,clear:async()=>undefined});
  await api.restore();
  transport.respondWith(()=>({status:200,headers:{},json:{user:{...user,features:{media:false},mediaState:'disabled'}}}));
  expect((await api.me()).features?.media).toBe(false);
  expect(api.currentSession()?.user.features?.media).toBe(false);
  expect(save.mock.calls[0]?.[0]).toMatchObject({user:{features:{media:false}}});
  api.currentSession()!.accessTokenExpiresAt=0;
  transport.respondWith(()=>({status:200,headers:{},json:{...session,accessToken:'renewed',accessTokenExpiresAt:9e15}}));
  await api.renewSessionIfNeeded();
  expect(api.currentSession()?.accessToken).toBe('renewed');
  expect(api.currentSession()?.user.features?.media).toBe(false);
});
