# 影音 v2 设计基准

[打开高保真交互原型](index.html)。这是已采用的布局参考，不再是待确认提案。单文件包含 42 个页面和状态、手机/桌面尺寸与六种主题，可直接在浏览器打开；页面路径按当前 React 路由同步。

作品、封面、进度、候选和账号均为示例；不调用真实服务，不播放媒体，不执行文件操作。冻结文件保留评审时的示例内容；作品详情使用 `/media/:channel/items/:itemId`，播放器使用 `/media/:channel/player` 及其歌词、队列、章节子面板，收藏等公共入口以[导航说明](../../../media-navigation.md)为准。视频控件由 DPlayer 提供，原型只表达布局和交互层级。

从仓库根目录运行 node docs/prototypes/media/v2-review/verify.cjs 可验证原型布局与基本交互；使用 PROTOTYPE_CHROMIUM 指定浏览器。输出进入 artifacts/media/prototype-v2，不会覆盖已冻结的设计源文件。原型验证不替代生产页面的视觉与功能验收。
