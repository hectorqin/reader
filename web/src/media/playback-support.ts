export interface PlaybackStream {type:string;codec:string;attachedPicture?:boolean;profile?:string}
// Only use codec strings that do not require profile/level data absent from the scan.
const CODECS:Record<string,string>={vp8:'vp8',vp9:'vp9',opus:'opus',vorbis:'vorbis',flac:'flac',mp3:'mp3',ac3:'ac-3',eac3:'ec-3'};
const AAC_PROFILES:Record<string,string>={LC:'mp4a.40.2','HE-AAC':'mp4a.40.5','HE-AACv2':'mp4a.40.29'};
function codecDeclaration(stream:PlaybackStream,contentType:string){
  if(stream.codec==='aac'&&['audio/mp4','video/mp4'].includes(contentType)&&stream.profile&&Object.hasOwn(AAC_PROFILES,stream.profile))return AAC_PROFILES[stream.profile];
  return Object.hasOwn(CODECS,stream.codec)?CODECS[stream.codec]:undefined;
}
/** Capability declarations are advisory, including when codec information is present. */
export function playbackSupport(media: Pick<HTMLMediaElement, 'canPlayType'>, contentType: string, streams:PlaybackStream[]=[]): string {
  if (!contentType || contentType === 'application/octet-stream') return '格式信息不足，将尝试直接播放。';
  try {
    const playable=streams.filter(stream=>['audio','video'].includes(stream.type)&&!stream.attachedPicture);
    const unsupported=playable.filter(stream=>{const codec=codecDeclaration(stream,contentType);return codec&&!media.canPlayType(`${contentType}; codecs="${codec}"`);});
    if(unsupported.length){
      const kinds=unsupported.some(stream=>stream.type==='video')?'视频或音轨':'部分音轨';
      return `设备未声明支持${kinds}编码（${[...new Set(unsupported.map(stream=>stream.codec))].join('、')}），仍可尝试直放；若无声可尝试切换音轨，播放失败请选择其他版本。当前不提供转码。`;
    }
    if(playable.length&&playable.every(stream=>codecDeclaration(stream,contentType)))
      return '设备声明支持扫描到的音视频编码，将尝试直接播放；实际解码能力以播放结果为准。';
    if(playable.length)
      return '已读取资源编码，但扫描信息不足以完整判断编码规格兼容性，将尝试直接播放；实际解码能力以播放结果为准。当前不提供转码。';
    return media.canPlayType(contentType)
      ? '设备声明支持此容器，将尝试直接播放；实际解码能力以播放结果为准。'
      : '设备未声明支持此格式，仍可尝试直放；失败时请选择其他版本。当前不提供转码。';
  } catch {
    return '无法检测设备格式支持，将尝试直接播放。';
  }
}

export function playbackFailure(error: unknown, mediaError?: Pick<MediaError, 'code'> | null): string {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
  if (name === 'NotAllowedError') return '浏览器尚未允许播放，请点击继续。';
  if (name === 'NotSupportedError' || mediaError?.code === 4) return '当前设备无法直放此资源，请选择其他版本或支持该格式的设备。当前不提供转码。';
  if (mediaError?.code === 3) return '资源解码失败，文件可能损坏或编码不受设备支持。请尝试其他版本。';
  if (mediaError?.code === 2) return '资源读取中断，请检查网络后点击继续重试。';
  if (name === 'AbortError' || mediaError?.code === 1) return '播放已中断，可点击继续重试。';
  return '播放失败，请检查连接后重试，或选择其他版本。';
}
