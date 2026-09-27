const errors:Record<string,string>={
  'probe-upgrade-failed':'技术信息升级未完成，原有资料已保留。请检查服务器 ffprobe 是否可用，再重新扫描。',
  'directory-unavailable':'媒体目录不可访问，原有资料已保留。请检查目录挂载和读取权限后重新扫描。',
  'openlist-auth-failed':'OpenList 验证失败，原有资料已保留。请在编辑媒体库中检查访问令牌和目录密码后重新扫描。',
  'openlist-unavailable':'暂时无法读取 OpenList 目录，原有资料已保留。请检查服务连接和远端目录后重新扫描。',
  'scan-failed':'扫描未完成，原有资料已保留。请检查媒体文件和服务器日志后重试。',
  'server-restarted':'服务器重启中断了扫描，原有资料已保留，请重新扫描。',
  cancelled:'扫描已取消，原有资料已保留。',
};
export const scanFeedback=(code:string|null)=>!code?'':Object.hasOwn(errors,code)?errors[code]:'扫描未完成，请检查服务器日志后重试。';
