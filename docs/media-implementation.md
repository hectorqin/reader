# 影音模块架构

影音覆盖电影、剧集、音乐和有声书，使用独立 React 路由、主题和服务线程。首页进入影视频道，阅读通过书架入口访问；阅读正文引擎由 React 页面托管生命周期。

## 数据与服务边界

- 阅读与账号数据保存在 reader.db，影音目录、版本、章节、收藏、播放进度和配置保存在 media.db。两库及签名密钥必须成对备份和恢复。
- 主服务先开放阅读，再异步启动影音 Worker。准备中返回 MEDIA_STARTING，失败返回 MEDIA_UNAVAILABLE；不会把影音启动或扫描任务排入阅读请求队列。
- MediaLibraries 管理媒体库权限与接入配置；MediaStorage 隔离本地目录和 OpenList。媒体资源引用不是外部下载 URL。
- MediaScanner 收集资源与资料，发布阶段通过独立事务原子更新目录，保留稳定身份、人工整理及已存在的进度。目录或远端旁车读取失败不发布不完整快照。
- 查询线程、发布线程及账号权限投影的边界见[写入隔离](media-write-isolation.md)。

## 领域结构

媒体库限定内容类型和访问范围。作品（电影、剧集、单集、歌手、专辑、曲目或有声书）可以包含多个版本；版本包含有序章节或播放部分，每部分引用一个文件资源。一个文件可产生多个内嵌章节，因此文件、作品、版本、章节不能混用身份。

手工调整作品归属、版本合并或拆分不会移动源文件；扫描保留人工组织和资料覆盖。不同版本不会因名称相同就自动混合播放。

## 元数据与播放

本地库使用 ffprobe 探测标签、编码、时长和章节，并读取同目录 NFO、封面、歌词、字幕。在线资料由 TMDB 和 MusicBrainz 适配器提供；用户审阅候选后确认覆盖，原文件不写回。

OpenList 使用 fs/list 与 fs/get，只读扫描，按需解析临时下载地址，由 Reader 授权接口代理 Range。令牌不交给前端或下载源；远程内嵌资料暂不探测。具体配置与驱动限制见[OpenList](media-openlist.md)。

Web 音频使用浏览器媒体能力，视频采用 DPlayer；Android 使用 Media3。播放会话、流票据、进度并发和即时撤权由服务端控制。后台授权与进程恢复见[后台播放](media-background-auth.md)。不提供转码、TVBox/JAR、云盘登录或影音离线下载。

## 代码与维护入口

- 服务端：[media 模块](../server/src/media/)、[HTTP 路由](../server/src/http/routes/media.ts)。
- 前端：[media feature 模块](../web/src/features/media/)、[React 页面路由](../web/src/app/router/routes.tsx)。
- [使用说明](media-user-guide.zh-CN.md)、[导航约定](media-navigation.md)、[验证方式](media-validation.md)、[性能测量](media-catalog-performance.md)。
- [冻结的 v2 原型](prototypes/media/v2-review/index.html)是布局参考；实际功能、地址和主题生命周期以源码及当前说明为准。浏览器评审截图和报告统一写入被忽略的 `artifacts/media`，不再提交到 `docs/`。
