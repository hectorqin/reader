# 影音导航与路由

## 顶部栏

手机首页点击频道标题或切换图标显示阅读、影视、音乐、有声书菜单；无底部频道 tab。点击外部、选择频道或 Escape 关闭菜单。桌面首页使用顶部频道链接，下方为频道内分类。

二级页显示返回、页面标题和当前页面的操作，不显示频道切换。设置、收藏、资源详情、播放器各自拥有路由。媒体库筛选位于列表工具栏左侧，版本、排序等选择器使用统一主题弹层。阅读界面和书架设置维持原有结构。

## 路由表

channel 表示 video、music 或 audiobook；id、part、library 均为真实资源标识。

| 页面 | Hash 地址 |
| --- | --- |
| 频道首页 | #/media/video、#/media/music/albums、#/media/audiobook/books |
| 影视分类 | #/media/video/movies、#/media/video/series |
| 音乐分类 | #/media/music/albums、artists、tracks |
| 有声书分类 | #/media/audiobook/books、narrators |
| 收藏 | #/media/favorites，scope 和 offset 保存筛选、分页 |
| 搜索 | #/media/search?q=…&scope=… |
| 历史、待播队列 | #/media/:channel/history、queue |
| 设置 | #/media/:channel/settings，以及 theme、browse、playback、plugins、account 子页 |
| 媒体库管理 | #/media/:channel/settings/libraries |
| 新建、编辑、权限 | settings/libraries/new、settings/libraries/:library/edit、permissions |
| 扫描与刮削 | #/media/:channel/settings/tasks |
| 作品详情 | #/media/:channel/:kind/:id；kind 使用 movie、show、season、episode、album、artist、track 或 book |
| 资料、匹配、章节 | #/media/:channel/items/:id/metadata、match、chapters |
| 播放 | #/media/:channel/player/:id/:part |
| 歌词、播放队列、播放章节 | 播放地址追加 /lyrics、/queue、/chapters |
| 文件夹、文件 | #/media/:channel/folders?library=…&path=…；#/media/:channel/files/:asset |
| 演播者、演播作品 | #/media/audiobook/narrators/:name，以及 /works/:work |

旧频道收藏地址会规范化到全局收藏地址。返回按实际浏览器历史和保存的来源状态处理；不为每个页面生成 return 查询参数。播放器路径包含作品及播放部分，可刷新后重新校验授权并恢复页面。

协议实现以[页面路由](../web/src/media/page-route.ts)及[路由器](../web/src/ui/router.ts)为准。冻结 v2 原型内的示例路由只用于设计演示。
