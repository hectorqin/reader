import { ApiError } from '../../../api/errors.ts';

export function mediaActionError(error:unknown,fallback:string):string {
  if(error instanceof ApiError){
    if(error.kind==='offline')return '无法连接服务器，请检查连接后重试。';
    if(error.code==='ADMIN_REQUIRED')return '需要管理员权限才能执行此操作。';
  }
  return error instanceof Error?error.message:fallback;
}
