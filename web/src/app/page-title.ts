const APP = 'reader';

/** First match wins, so the specific paths come before the sections that contain them. */
const TITLES: Array<[RegExp, string]> = [
  [/^\/$/, '首页'],
  [/^\/shelf$/, '书架'],
  [/^\/search$/, '搜索'],
  [/^\/library\/files$/, '文件管理'],
  [/^\/library(\/|$)/, '书库'],
  [/^\/sources(\/|$)/, '书源'],
  [/^\/book\//, '阅读'],
  [/^\/me$/, '我的'],
  [/^\/me\/settings$/, '偏好设置'],
  [/^\/me\/stats$/, '时长统计'],
  [/^\/me\/account$/, '账号与连接'],
  [/^\/me\/opds$/, '外部阅读器'],
  [/^\/me\/admin\/users$/, '用户管理'],
  [/^\/me\/admin\/registration$/, '注册与邀请'],
  [/^\/me\/admin\/services$/, '服务配置'],
  [/^\/media\/search$/, '影音搜索'],
  [/^\/media\/([^/]+\/)?favorites$/, '我的收藏'],
  [/^\/media\/([^/]+\/)?queue$/, '待播队列'],
  [/^\/media\/[^/]+\/history$/, '播放记录'],
  [/^\/media\/[^/]+\/settings\/libraries/, '媒体库'],
  [/^\/media\/[^/]+\/settings\/tasks$/, '扫描与刮削'],
  [/^\/media\/[^/]+\/folders(\/|$)/, '文件夹浏览'],
  [/^\/media\/[^/]+\/player(\/|$)/, '正在播放'],
  [/^\/media\/video(\/|$)/, '影视'],
  [/^\/media\/music(\/|$)/, '音乐'],
  [/^\/media\/audiobook(\/|$)/, '有声书'],
  [/^\/media(\/|$)/, '影音'],
];

/**
 * The tab's title for a route: "书架 · reader".
 *
 * The app is one HTML document, so without this every history entry, bookmark and
 * tab is called "reader" and the browser's own back-list cannot tell them apart.
 * It names the place, not the item: a page that knows something better (the reader
 * and its book) may set `document.title` itself after this runs.
 */
export function pageTitle(pathname: string): string {
  const match = TITLES.find(([pattern]) => pattern.test(pathname));
  return match ? `${match[1]} · ${APP}` : APP;
}
