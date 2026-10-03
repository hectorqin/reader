import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';

import {act} from 'react';
import {ApiError} from '../src/api/errors.ts';
import {MediaScreenError} from '../src/media/screen-error.tsx';

it.each([
  [new ApiError('server','准备中','MEDIA_STARTING',503),'影音服务正在准备'],
  [new ApiError('server','服务失败','MEDIA_UNAVAILABLE',503),'影音服务暂不可用'],
  [new ApiError('offline','网络错误'),'无法连接服务器'],
  [new ApiError('forbidden','库权限已撤销','LIBRARY_FORBIDDEN',403),'没有访问权限'],
  [new ApiError('not_found','作品不存在','ITEM_NOT_FOUND',404),'内容已不可用'],
] as const)('explains %s and keeps retry and return as explicit actions', (error,title)=>{
  const root=document.createElement('div'),onRetry=vi.fn(),onBack=vi.fn();
  try{
    act(()=>render(<MediaScreenError error={error} message={error.message} busy={false} onRetry={onRetry} onBack={onBack}/>,root));
    expect(root.querySelector('strong')?.textContent).toBe(title);
    expect(root.textContent).toContain(error.kind==='offline'?'暂时无法获取内容。':error.message);
    expect(onRetry).not.toHaveBeenCalled();
    act(()=>root.querySelectorAll('button')[0]!.click());
    expect(onRetry).toHaveBeenCalledOnce();expect(onBack).not.toHaveBeenCalled();
    act(()=>root.querySelectorAll('button')[1]!.click());expect(onBack).toHaveBeenCalledOnce();
  }finally{act(()=>render(null,root));}
});

it('does not mislabel an account failure as a library grant or invent a return target',()=>{
  const root=document.createElement('div'),error=new ApiError('forbidden','账号已禁用','ACCOUNT_DISABLED',403),onRetry=vi.fn();
  try{
    act(()=>render(<MediaScreenError error={error} message={error.message} busy onRetry={onRetry}/>,root));
    expect(root.textContent).not.toContain('媒体库授权');expect(root.querySelector('strong')).toBeNull();
    expect(root.querySelectorAll('button')).toHaveLength(1);expect(root.querySelector('button')!.disabled).toBe(true);
  }finally{act(()=>render(null,root));}
});
it('explains administrator-only sources without suggesting a media library grant',()=>{
  const root=document.createElement('div'),error=new ApiError('forbidden','admin role required','ADMIN_REQUIRED',403);
  try{
    act(()=>render(<MediaScreenError error={error} message={error.message} busy={false} onRetry={()=>{}}/>,root));
    expect(root.textContent).toContain('需要管理员权限');expect(root.textContent).not.toContain('媒体库授权');expect(root.textContent).not.toContain('admin role required');
  }finally{act(()=>render(null,root));}
});

it.each([false,true])('uses the offline presentation without exposing a browser exception (full page: %s)',fullPage=>{
  const root=document.createElement('div'),error=new ApiError('offline','Failed to fetch');
  try{
    act(()=>render(<MediaScreenError fullPage={fullPage} error={error} message={error.message} busy={false} onRetry={()=>{}}/>,root));
    expect(!!root.querySelector('.media-screen-error.is-page')).toBe(fullPage);expect(!!root.querySelector('svg')).toBe(fullPage);
    expect(root.textContent).toContain(fullPage?'暂时连接不上服务':'无法连接服务器');expect(root.textContent).not.toContain('Failed to fetch');
  }finally{act(()=>render(null,root));}
});
