# reader

**把书籍、电影、剧集、音乐和有声书，放进自己的阅读与影音空间。**

支持浏览器与 Android 的自部署书库和媒体库，提供 EPUB 排版、漫画阅读、影音播放和多用户进度同步。

**简体中文** · [English](README.en.md)

[开始使用](docs/getting-started.zh-CN.md) · [阅读手册](docs/user-guide.zh-CN.md) · [影音手册](docs/media-user-guide.zh-CN.md) · [部署配置](docs/configuration.zh-CN.md) · [文档中心](docs/README.md)

## 为什么使用 reader

- **自己的书库与媒体库**：挂载现有目录，或连接 OPDS 书库、OpenList 媒体目录。书籍与影音分别管理，索引、封面和用户状态保存在数据目录。
- **专注阅读**：EPUB 保留出版方样式，TXT 支持编码识别与章节切分；支持漫画、分页、滚动、主题、字体和朗读。
- **完整的影音浏览**：电影与剧集、歌手与专辑、有声书与演播者分别组织，支持媒体库筛选、搜索、收藏、历史记录和播放队列。
- **资料与刮削**：读取本地标签、NFO、封面、歌词和字幕；可配置 TMDB 与 MusicBrainz 补全资料，确认匹配后保存，也可手工整理作品与版本。
- **跨设备继续**：账号独立保存书架、阅读进度、笔记及播放进度。Web 视频采用 Plyr；音频支持歌词、倍速和睡眠定时，Android 支持原生后台播放。
- **适合自部署**：一个 Docker 容器提供服务端与 Web 界面；影音源文件只读扫描，阅读与影音使用独立数据库及服务线程。

## 支持内容

| 类型 | 支持情况 |
| --- | --- |
| EPUB / TXT | 出版方排版、目录、脚注；TXT 编码识别和章节推断 |
| CBZ / ZIP / 图片目录 | 自然页序、漫画分页和卷目录 |
| PDF | 浏览器或设备基础查看，不重排 |
| OPDS | 浏览、搜索和获取书籍；也可向外部阅读器提供只读目录 |
| 电影 / 剧集 | 海报与资料、季和单集、版本选择、字幕与播放进度 |
| 音乐 | 歌手、专辑、曲目、歌词、队列与连续播放 |
| 有声书 | 演播者、内容简介、章节、倍速与睡眠定时 |
| OpenList | 接入远端媒体目录，扫描外置资料，通过 Reader 授权接口播放 |

## 开始使用

准备 Docker、Docker Compose、书籍目录和独立数据目录。启动后访问 `http://<你的主机>:5888`，首个注册账号成为管理员。部署步骤见[入门指南](docs/getting-started.zh-CN.md)。

默认进入书架，从「影音」入口打开媒体模块。手机点击顶部频道名称切换影视、音乐、有声书，选择「阅读」返回书架；影音设置内置多种主题，阅读界面与书架设置保持独立。

管理员在「影音设置 → 媒体库管理」添加服务器目录或 OpenList。Docker 本地媒体目录需先挂载，再填写容器内路径；创建后自动扫描。详细步骤见[影音手册](docs/media-user-guide.zh-CN.md)和 [OpenList 接入](docs/media-openlist.md)。

## 文档

| 我想要…… | 从这里开始 |
| --- | --- |
| 部署服务、添加书籍与媒体 | [入门指南](docs/getting-started.zh-CN.md) |
| 使用书架、阅读器、OPDS 和朗读 | [阅读手册](docs/user-guide.zh-CN.md) |
| 建媒体库、刮削、看视频或听音乐与有声书 | [影音手册](docs/media-user-guide.zh-CN.md) |
| 对接 OpenList / NAS / 网盘挂载 | [OpenList 接入](docs/media-openlist.md) |
| 配置环境变量、HTTPS、媒体探测或 TTS | [部署配置](docs/configuration.zh-CN.md) |
| 备份账号、阅读与影音数据 | [备份恢复](docs/backup.zh-CN.md) |
| 开发、测试或构建 Android | [开发指南](docs/development.zh-CN.md)、[影音验证](docs/media-validation.md) |

## 当前边界

- 视频与音频不提供转码，实际播放能力取决于浏览器或设备支持的容器和编码。
- OpenList 支持外置 NFO、封面、歌词和字幕，暂不读取远端内嵌标签、封面和章节；部分驱动需开启 OpenList Web 代理并正确支持 Range。
- 影音暂不支持 TVBox/JAR、离线下载或直接登录网盘；网盘挂载由 OpenList 管理。
- PDF 为基础查看；不支持 `.rar/.cbr` 或通用书籍格式转换。阅读离线能力取决于当前设备已缓存内容。
- 提供 Web 和 Android 客户端，没有独立 iOS 或桌面客户端；电脑端使用浏览器。

## 参与贡献

欢迎提交问题、改进文档或贡献代码。请附上复现步骤、运行环境和脱敏日志，开发流程见[开发指南](docs/development.zh-CN.md)。

## 许可证

[GNU Affero General Public License v3.0](LICENSE)。
