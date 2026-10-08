# 部署配置

[项目首页](../README.md) · [文档中心](README.md) · [English](configuration.en.md)

初次部署请先看[入门指南](getting-started.zh-CN.md)。本页适用于部署后的配置、维护与排错。

## 目录与权限

- `BOOKS_DIR` 是用户书籍目录。`:ro` 用于只读部署；`:rw` 配合文件系统写权限启用管理员文件管理。
- `DATA_DIR` 保存 SQLite、账号、阅读记录、密钥、封面、扫描状态、上传暂存、下载文件与影音资料，必须始终可写。
- `DATA_DIR` 不能与 `BOOKS_DIR` 相同或位于其内部，启动时会拒绝该配置。
- 镜像入口脚本尝试修正数据目录本身的属主，再以 `reader` 用户运行。它不会替你修改书籍目录的属主，也不会递归修复已有数据文件的权限。

书库只读不影响账号和阅读进度写入数据目录。需要上传时，除修改 `:rw` 外，还要检查宿主机 ACL 或目录权限。

## 页面业务配置

管理员在「系统设置 → 服务配置」中管理 HTTP 朗读、扫描、登录有效期、对外地址、浏览器来源、TMDB、MusicBrainz 及 WebDAV 备份目标，注册策略沿用「注册与邀请」。配置写入 reader.db，保存后无需重启。详见[业务配置](business-settings.zh-CN.md)。

升级首次启动会导入旧业务环境变量；数据库存在配置后不再读取这些环境变量，清空字段也不会恢复旧值。

## 部署环境变量

以下是直接运行服务端时的默认值。Docker 镜像另设 `DATA_DIR=/data`、`WEB_DIR=/app/web`，`BOOKS_DIR=/books`。

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `BOOKS_DIR` | `/books` | 书籍目录 |
| `DATA_DIR` | 当前工作目录下的 `data` | 服务端状态和缓存目录 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `5888` | 监听端口 |
| `READER_TOKEN_SECRET` | 自动生成 | 至少 16 字符的签名密钥；默认保存在 `DATA_DIR/token.secret` |
| `LOG_LEVEL` | `info` | 日志级别 |
| `MEDIA_FFPROBE_PATH` | `ffprobe` | 影音技术信息读取程序；缺失时仍可扫描入库，时长、标签及章节信息可能不完整 |
| `MEDIA_FFMPEG_PATH` | `ffmpeg` | 内嵌封面与字幕提取程序，不提供转码 |
| `WEB_DIR` | 当前工作目录下的 `web` | 已构建 Web 客户端目录 |

修改 Compose 环境变量后执行 `docker compose up -d`。签名密钥需要稳定保存，否则已有会话会失效。数据目录中的账号、进度和笔记不能靠重新扫描书籍恢复。

## HTTPS 与反向代理

局域网可直接访问 `http://<服务器IP>:5888`。对公网提供服务时使用 HTTPS，保护登录凭据和访问令牌。

例如 Caddy 与 reader 运行在同一台主机上时：

```caddyfile
reader.example.com {
    reverse_proxy 127.0.0.1:5888
}
```

在「登录与服务访问」中设置对外地址为 `https://reader.example.com`。如果 Caddy 也在容器中，代理地址应改为容器网络中 reader 的服务地址。

前后端分开部署时，在「登录与服务访问」中设置允许的浏览器来源为 Web 客户端的实际来源。书源搜索采用 Streamable HTTP，代理需要持续转发 `text/event-stream`；不要把搜索响应缓冲到完成后才返回。没有公网 IP 时也可用 VPN 或隧道连接服务。

## HTTP 朗读

优先使用 Android 系统语音或浏览器 `speechSynthesis`。需要 HTTP 语音时，进入「系统设置 → 服务配置 → HTTP 朗读」，填写合成接口、认证令牌和可选音色列表地址，启用后检测连接、试听并保存。请求超时和音频缓存上限也在此设置。

reader 代理语音请求，不内置合成模型。上游接口需兼容项目的请求协议；不能仅凭服务名称判断是否兼容，详见 [TTS API](api.md)。地址必须从 reader 容器内可达，容器内的 `localhost` 指容器自身。

## 故障排查

### 启动时报数据目录不可写

先看 `docker compose logs --tail=100 reader`。如果是 `/data/token.secret`、数据库或缓存目录的 `EACCES`：

1. 检查 `/data` 没有被只读挂载，且有可用空间。
2. 若设置了 `user:`、`--user` 或替换了入口脚本，需要自行保证该用户可写数据目录。
3. 运行 `docker compose run --rm --no-deps --entrypoint id reader reader` 查看镜像中 `reader` 用户的 UID/GID，再在宿主机修正该数据目录的属主或 ACL；自定义运行用户时以该用户为准。
4. NFS、SMB 或 NTFS 需按共享文件系统的权限机制配置，不能只依赖 `chown`。

设置 `READER_TOKEN_SECRET` 只能省去密钥文件写入，不能替代数据库和缓存所需的写权限。

### 文件管理返回 `READ_ONLY_MOUNT`

检查卷是否为 `:ro`。改用 `:rw` 并重新创建容器后，还需确认服务进程对目标目录有写权限。上传仅在管理员文件管理页面提供。

### 页面打开但看不到书

确认挂载目录中的文件对服务进程可读，格式受支持，并等待扫描完成或由管理员手动扫描。扫描器跳过 `.git`、`@eaDir`、`#recycle` 等目录，不跟随符号链接；可在书库文件页核对实际目录。

## 影音媒体库

本地电影、剧集、音乐和有声书目录单独挂载到容器（建议只读），在「影音设置 → 媒体库管理」中填写容器路径。直接运行服务端时填写本机绝对路径；媒体根目录不要使用 DATA_DIR。普通用户只可访问已授权的库，扫描、刮削与资料编辑由管理员操作。

官方镜像包含 ffprobe 和 ffmpeg。本机启动时将二者加入 PATH，或设置 MEDIA_FFPROBE_PATH / MEDIA_FFMPEG_PATH 为可执行文件路径。ffprobe 用于时长、编码、标签和章节，ffmpeg 用于内嵌资源提取，均不提供转码。

在线匹配在书架右上角「系统设置 → 服务配置」的 TMDB 和 MusicBrainz 分类中配置令牌、API Key、应用标识与联系地址。可测试连接、调整资料语言并保存，无需重启。本地 NFO 和标签读取不依赖在线凭据。

OpenList 连接信息在建库界面设置，无需本地挂载；服务端必须能访问 OpenList 和其下载源。远端内嵌资料暂不读取，某些驱动需要 OpenList Web 代理。配置与限制见 [OpenList 接入](media-openlist.md)。

影音使用独立 media.db；阅读与账号使用 reader.db。备份整个 DATA_DIR，成对恢复，见[备份指南](backup.zh-CN.md)。

### 影音不可用或无法播放

阅读健康检查成功不代表影音已就绪。MEDIA_STARTING 表示正在准备，稍后重试；MEDIA_UNAVAILABLE 需检查服务日志与数据目录。扫描失败时查看任务错误，检查路径、权限或 OpenList 连接后重新扫描。

能显示资料但无法播放时，检查浏览器对媒体容器及编码的支持、下载源连通性和 Range 响应。当前没有转码；OpenList 驱动特定请求头问题可按其配置启用 Web 代理。不要删除 media.db 作为修复方式。
