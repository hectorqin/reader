import type { SourceType } from '../api/sources.ts';

const capabilities: Record<string, string> = {
  browse: '浏览目录', search: '搜索', 'search.filters': '搜索筛选', 'search.cancel': '取消搜索',
  'search.session': '继续搜索', 'content.alternatives': '换源', detail: '书籍详情',
  'acquire.file': '获取文件', 'acquire.chapters': '获取章节', 'content.manifest': '章节目录',
  'content.resource': '读取正文', 'content.update': '更新目录',
};

export function SourceCapabilities({ type }: { type: SourceType }) {
  return <details className="source-capabilities"><summary>插件能力与兼容性</summary>
    <p>{type.label} · {type.version}</p>
    <dl>{Object.entries(capabilities).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{type.capabilities.includes(key) ? '已声明' : '未声明'}</dd></div>)}</dl>
    <p className="muted">能力由插件声明，实际可用性取决于站点、账号权限及插件适配。网站登录、验证码与付费内容由站点和插件处理。</p>
    <p className="muted">OPDS 来源用于连接外部书库；通过“连接外部阅读器”可创建 Reader OPDS 服务端的只读凭据。Legado 规则需要专用适配插件，不能直接作为 Reader 插件导入。</p>
  </details>;
}
