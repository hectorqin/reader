import { Icon } from '../../../ui/icon.tsx';
import type { MediaChannel } from '../api/media-api.ts';

export function EmptyMediaLibrary({channel,hasLibraries,admin,category,onCreate,onManage}: {
  channel:MediaChannel;hasLibraries:boolean;admin:boolean;category:string;
  onCreate:()=>void;onManage:()=>void;
}) {
  const label={video:'影视',music:'音乐',audiobook:'有声书'}[channel];
  return <section className="media-library-empty" aria-label="媒体库空状态">
    <span className="media-empty-emblem"><Icon name="folder-browse" size={32} /></span>
    <h2>{hasLibraries?`还没有${category}`:'让喜欢的作品住进来'}</h2>
    <p>{hasLibraries
      ?admin?'可以切换分类，或到媒体库管理中扫描已添加的目录。':'这个分类暂时没有内容，可以切换分类或稍后再来。'
      :admin?'添加服务端的媒体目录，即可整理作品资料、继续播放。':`这里还没有可访问的${label}内容。请联系管理员添加媒体库或为你开通权限。`}</p>
    {admin&&<button className="media-primary" onClick={hasLibraries?onManage:onCreate}>
      {hasLibraries?'管理媒体库':'添加媒体库'}
    </button>}
  </section>;
}
