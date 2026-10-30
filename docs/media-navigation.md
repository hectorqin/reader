# 影音导航与路由

## 应用导航与频道切换

全应用只有一套导航：手机为底部标签栏，701px 起为左侧边栏，包含首页（#/）、书架（#/shelf）、影音（#/media/video）和我的（#/me）。宽屏侧边栏在「影音」下列出影视、音乐、有声书三个频道；手机在频道分类页顶部用影视/音乐/有声书三段切换频道（旧的频道菜单和频道导轨已移除）。

频道下方是分类标签：影视（首页、电影、剧集）、音乐（专辑、歌手、曲目）、有声书（有声书、演播者）。手机上左右滑动切换相邻分类，越过频道最后一个分类即进入下一频道；同频道内保留 library 和 sort 参数，跨频道重置。频道尚无媒体库时滑动按整个频道切换。分类页右上角 ⋯ 菜单提供收藏、历史、队列和媒体库管理，工具栏提供文件夹入口。

二级页显示返回、页面标题和当前页面的操作，不显示频道切换；手机上二级页以自己的返回栏替代底部标签栏，宽屏侧边栏保留。播放器与阅读页隐藏应用导航。设置、收藏、资源详情、播放器各自拥有路由。媒体库筛选位于列表工具栏左侧，版本、排序等选择器使用统一主题弹层。阅读界面和书架设置维持原有结构。

## 路由表

channel 表示 video、music 或 audiobook；itemId、part、libraryId 均为真实资源标识。

| 页面 | Hash 地址 |
| --- | --- |
| 频道首页 | #/media/video、#/media/music、#/media/audiobook |
| 影视分类 | #/media/video/movies、#/media/video/series |
| 音乐分类 | #/media/music/albums、#/media/music/artists、#/media/music/tracks |
| 有声书分类 | #/media/audiobook/books、#/media/audiobook/narrators |
| 首页、我的 | #/；#/me |
| 收藏 | #/media/favorites，scope 和 offset 保存筛选、分页；#/media/:channel/favorites 预选该频道 |
| 搜索 | #/media/search?q=…&scope=… |
| 历史、待播队列 | #/media/:channel/history；#/media/queue、#/media/:channel/queue |
| 偏好设置（我的） | #/me/theme、#/me/browse、#/me/playback、#/me/account |
| 媒体库管理 | #/media/:channel/settings/libraries |
| 新建、编辑、权限 | #/media/:channel/settings/libraries/new、#/media/:channel/settings/libraries/:libraryId/edit、#/media/:channel/settings/libraries/:libraryId/permissions |
| 扫描与刮削 | #/media/:channel/settings/tasks?tab=scan\|ai\|scrape&library=… |
| 作品详情 | #/media/:channel/items/:itemId |
| 资料、匹配、章节 | #/media/:channel/items/:itemId/metadata、match、chapters |
| 版本、结构管理 | #/media/:channel/items/:itemId/editions/:editionId；#/media/:channel/items/:itemId/structure |
| 播放 | #/media/:channel/player?item=…&part=… |
| 歌词、播放队列、播放章节 | #/media/:channel/player/lyrics、#/media/:channel/player/queue、#/media/:channel/player/chapters |
| 文件夹、文件 | #/media/:channel/folders/:libraryId?path=…&offset=…（libraryId 可省略）；文件继续使用该路由并追加 asset=… |
| 演播者、演播作品 | #/media/audiobook/narrators/:narrator，以及 /media/audiobook/narrators/:narrator/works/:workId |

路由表之外保留少量旧深链接兼容：`/media`、`/media/music` 和 `/media/audiobook` 会进入对应频道默认页；已移除的影音设置 `/media/:channel/settings` 及其 `/:panel` 子页跳转到 `/me` 或对应的 `/me/:panel`；未知路径回到 `/media/video`。书源与系统旧入口的兼容规则见[React 架构说明](frontend-react-migration.md)。返回按实际浏览器历史和保存的来源状态处理；不为每个页面生成 return 查询参数。播放器的 item、part 查询参数保存作品及播放部分，可刷新后重新校验授权并恢复页面。

协议实现以[React 页面路由](../web/src/app/router/routes.tsx)及[影音 feature](../web/src/features/media/)为准。冻结 v2 原型仍使用已移除的 `/media/:channel/settings/*` 设置页路径，作品 ID、查询参数和状态参数只用于设计演示，不作为路由依据。
