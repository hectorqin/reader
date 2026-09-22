# reader

**把本地书、OPDS 书库和远程书源，放进自己的阅读空间。**

支持浏览器与 Android 的自部署书库阅读器，提供 EPUB 排版、漫画阅读、多用户同步和可扩展书源。

**简体中文** · [English](README.en.md)

[开始使用](docs/getting-started.zh-CN.md) · [使用手册](docs/user-guide.zh-CN.md) · [部署配置](docs/configuration.zh-CN.md) · [文档中心](docs/README.md)

## 为什么使用 reader

- **自己的书库**：挂载现有书籍目录，无需先把文件搬进另一套目录结构。封面、索引和服务端状态单独保存在数据目录。
- **专注阅读**：EPUB 保留出版方样式，TXT 支持编码识别与章节切分；支持分页、滚动、主题、字体设置和朗读。
- **多种来源**：内置本地书库和 OPDS，通过独立插件接入远程书源。
- **跨设备继续**：每个账号拥有独立书架、阅读进度、笔记和高亮；浏览器与 Android 连接同一服务。
- **适合自部署**：一个 Docker 容器包含服务端和 Web 界面，书库可按需要选择只读或可写挂载。

## 书籍与来源

| 类型 | 支持情况 |
| --- | --- |
| EPUB | 出版方样式、嵌入字体、目录、脚注、图文混排 |
| TXT | 编码识别、章节推断、字号与行距调整 |
| CBZ / ZIP / 图片目录 | 自然页序、漫画分页和卷目录 |
| PDF | 基础查看，能力取决于浏览器或设备查看器，不重排 |
| OPDS | 浏览、搜索、分页和获取书籍 |
| 远程书源插件 | 多源搜索、章节阅读、富文本与图片、刷新目录和自动追更 |


## 开始使用

准备 Docker、Docker Compose 和一个书籍目录，即可部署。服务启动后访问 `http://<你的主机>:8080`，首个注册账号成为管理员。

**[打开入门指南 →](docs/getting-started.zh-CN.md)**

指南包含 Compose 配置、首次登录、添加书籍、只读/可写挂载和更新流程。数据库、缓存和上传暂存均写入 `DATA_DIR`；该目录不能与 `BOOKS_DIR` 相同或位于其内部。

## 文档

| 我想要…… | 从这里开始 |
| --- | --- |
| 安装并读到第一本书 | [入门指南](docs/getting-started.zh-CN.md) |
| 使用书架、阅读器、书源和朗读 | [使用手册](docs/user-guide.zh-CN.md) |
| 设置环境变量、HTTPS、TTS 或排查部署问题 | [部署配置](docs/configuration.zh-CN.md) |
| 从源码运行、测试或构建 Android | [开发指南](docs/development.zh-CN.md) |
| 开发来源插件或调用 API | [文档中心](docs/README.md) |

## 当前边界

- PDF 提供基础查看；不支持 `.rar/.cbr` 或通用格式转换。
- 离线能力取决于已缓存内容；远程章节整书预下载与缓存配额尚未实现。
- 当前客户端为 Web 和 Android，没有独立 iOS 或桌面客户端；电脑端可使用浏览器。

## 参与贡献

欢迎提交问题、改进文档或贡献代码。请附上复现步骤、运行环境和脱敏日志；开发与验证流程见[开发指南](docs/development.zh-CN.md)。

## 许可证

[GNU Affero General Public License v3.0](LICENSE)。
