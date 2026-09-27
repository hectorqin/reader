// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'preact/test-utils';
import {render} from '../src/ui/vendor/preact.ts';
import {EmptyMediaLibrary} from '../src/media/empty-library.tsx';
import {MediaScreen} from '../src/media/screen.tsx';
const host=document.createElement('div');document.body.append(host);
afterEach(()=>act(()=>render(null,host)));
it('offers library creation only to an administrator with no library',()=>{
 const onCreate=vi.fn(),onManage=vi.fn();
 act(()=>render(<EmptyMediaLibrary channel="video" hasLibraries={false} admin category="电影" onCreate={onCreate} onManage={onManage}/>,host));
 expect(host.querySelector('h2')?.textContent).toBe('让喜欢的作品住进来');
 act(()=>host.querySelector('button')!.click());expect(onCreate).toHaveBeenCalledOnce();expect(onManage).not.toHaveBeenCalled();
});
it('routes an empty existing library to management instead of creating a duplicate',()=>{
 const onCreate=vi.fn(),onManage=vi.fn();
 act(()=>render(<EmptyMediaLibrary channel="music" hasLibraries admin category="专辑" onCreate={onCreate} onManage={onManage}/>,host));
 act(()=>host.querySelector('button')!.click());expect(onManage).toHaveBeenCalledOnce();expect(onCreate).not.toHaveBeenCalled();
});
it('does not offer privileged creation or claim there are no libraries to a member',()=>{
 act(()=>render(<EmptyMediaLibrary channel="music" hasLibraries={false} admin={false} category="专辑" onCreate={vi.fn()} onManage={vi.fn()}/>,host));
 expect(host.querySelector('button')).toBeNull();expect(host.textContent).toContain('开通权限');expect(host.textContent).not.toContain('尚无媒体库');
});
it('suppresses empty filters, folders and premature empty states',()=>{
 const emptyLibrary=vi.fn(()=> 'empty'),browse=Reflect.get(MediaScreen.prototype,'browseView');
 const state={libraries:[],busy:true,error:'',emptyLibrary};
 expect(Reflect.apply(browse,state,[])).toBeNull();expect(emptyLibrary).not.toHaveBeenCalled();
 state.busy=false;state.error='offline';expect(Reflect.apply(browse,state,[])).toBeNull();
 state.error='';expect(Reflect.apply(browse,state,[])).toBe('empty');expect(emptyLibrary).toHaveBeenCalledOnce();
});
