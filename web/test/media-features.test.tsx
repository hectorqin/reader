// @vitest-environment jsdom
import {act} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MemoryRouter,Route,Routes,createMemoryRouter,RouterProvider} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {render} from '../src/shared/ui/render-root.ts';
import {RuntimeContext} from '../src/app/providers/runtime-context.tsx';
import {useAuthStore} from '../src/shared/stores/auth.store.ts';
import {AppNav} from '../src/app/AppNav.tsx';
import {MediaLayout} from '../src/app/App.tsx';
import {SearchPage} from '../src/features/search/pages/SearchPage.tsx';
import {StatsPage} from '../src/features/stats/pages/StatsPage.tsx';
import {UserManagement} from '../src/ui/system-settings.tsx';
import {dismissAllNotices} from '../src/ui/notifications.ts';
import {routes} from '../src/app/router/routes.tsx';

const root=document.createElement('div');document.body.append(root);
const user={id:'reader',username:'reader',displayName:'Reader',role:'admin' as const,createdAt:0,mediaEnabled:false,features:{media:false}};
let client:QueryClient;
const runtime={
  api:{baseUrl:'https://reader.example',currentSession:()=>({user}),listBooks:vi.fn(async()=>({items:[],total:0})),readingStats:vi.fn(async()=>({series:[],works:[]})),readingStatsUsers:vi.fn(async()=>[])},
  mediaApi:{preferenceScope:()=> 'features-test',search:vi.fn(),timeStats:vi.fn(),statsUsers:vi.fn()},
} as any;
const paint=(element:React.ReactNode,path='/')=>act(async()=>render(<RuntimeContext value={runtime}><QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>{element}</MemoryRouter></QueryClientProvider></RuntimeContext>,root));

beforeEach(()=>{client=new QueryClient({defaultOptions:{queries:{retry:false}}});useAuthStore.setState({session:{user,accessToken:'access',refreshToken:'refresh',accessTokenExpiresAt:9e15,refreshTokenExpiresAt:9e15},verifiedUser:user});});
afterEach(()=>{act(()=>render(null,root));client.clear();vi.clearAllMocks();useAuthStore.setState({session:null,verifiedUser:null});dismissAllNotices();});

it('pure reading navigation has three destinations and book-only search',async()=>{
  await paint(<AppNav mode="top"/>);
  expect([...root.querySelectorAll('.app-nav-list > li > a')].map(link=>link.textContent)).toEqual(['首页','书架','我的']);
  expect(root.querySelector('input[aria-label="搜索书籍"]')).not.toBeNull();
  expect(root.querySelector('[aria-label="影音频道"]')).toBeNull();
});

it('old media deep links cannot mount their children',async()=>{
  const mounted=vi.fn();
  function Child(){mounted();return <div>Forbidden media</div>;}
  await paint(<Routes><Route path="/media" element={<MediaLayout/>}><Route path="video" element={<Child/>}/></Route></Routes>,'/media/video');
  expect(mounted).not.toHaveBeenCalled();
  expect(root.textContent).toContain('影音模块未启用');
  expect(root.querySelector('a')?.getAttribute('href')).toBe('/');
});

it('actual application routes keep account and administrator recovery links accessible in pure reading',async()=>{
  const router=createMemoryRouter(routes,{initialEntries:['/me']});
  try{
    await act(async()=>render(<RuntimeContext value={runtime}><QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider></RuntimeContext>,root));
    expect(root.querySelector('a[href="/me/admin/users"]')).not.toBeNull();
    expect(root.querySelector('a[href="/me/admin/services"]')).not.toBeNull();
    expect(root.querySelector('a[href="/me/account"]')).not.toBeNull();
    expect(root.textContent).not.toContain('影音模块未启用');
  }finally{router.dispose();}
});

it('search does not fetch or show media even if its cache still contains results',async()=>{
  client.setQueryData(['search','media',runtime.api.baseUrl,user.id,'test'],{items:[{id:'old',title:'Private media'}],total:1});
  await paint(<SearchPage/>,'/search?q=test');
  expect(runtime.api.listBooks).toHaveBeenCalled();
  expect(runtime.mediaApi.search).not.toHaveBeenCalled();
  expect(root.querySelector('[aria-label="影音搜索结果"]')).toBeNull();
  expect(root.querySelector('input')?.placeholder).toBe('搜索书名、作者');
  expect(root.textContent).not.toContain('Private media');
});

it('statistics keep reading but skip media and ignore an old video filter',async()=>{
  await paint(<StatsPage/>,'/me/stats?kind=video');
  expect(runtime.api.readingStats).toHaveBeenCalled();
  expect(runtime.mediaApi.timeStats).not.toHaveBeenCalled();
  expect(runtime.mediaApi.statsUsers).not.toHaveBeenCalled();
  expect(root.querySelector('[aria-label="类型"]')?.textContent).not.toContain('观影');
});

it('administrators can change their own media permission while the global switch is off',async()=>{
  const onSaved=vi.fn();
  let enabled=true;
  const api={currentSession:()=>({user}),adminUsers:vi.fn(async()=>({users:[{...user,mediaEnabled:enabled,disabled:false}]})),businessSettingsRequest:vi.fn(async()=>({groups:[{group:'modules',values:{mediaEnabled:false,newUserMediaEnabled:false}}]})),adminUpdateUser:vi.fn(async(_id,body)=>{enabled=body.mediaEnabled;})} as any;
  await paint(<UserManagement api={api} onSaved={onSaved}/>);
  expect(root.textContent).toContain('全站影音已关闭');
  await act(async()=>[...root.querySelectorAll('button')].find(button=>button.textContent==='新增用户')!.click());
  expect(root.querySelector<HTMLInputElement>('[type=checkbox]')?.checked).toBe(false);
  await act(async()=>[...root.querySelectorAll('button')].find(button=>button.textContent==='新增用户')!.click());
  await act(async()=>[...root.querySelectorAll('button')].find(button=>button.textContent==='关闭影音')!.click());
  await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('[role=alertdialog] button')].find(button=>button.textContent==='确认')!.click());
  expect(api.adminUpdateUser).toHaveBeenCalledWith(user.id,{mediaEnabled:false});
  expect(onSaved).toHaveBeenCalledOnce();
  expect(root.textContent).toContain('影音：未启用');
  expect(root.textContent).toContain('启用影音');
});
