# 部署配置

[项目首页](../README.md) · [文档中心](README.md) · [English](configuration.en.md)

初次部署请先看[入门指南](getting-started.zh-CN.md)。本页适用于部署后的配置、维护与排错。

## 目录与权限

- `BOOKS_DIR` 是用户书籍目录。`:ro` 用于只读部署；`:rw` 配合文件系统写权限启用管理员文件管理。
- `DATA_DIR` 保存 SQLite、账号、阅读记录、密钥、封面、扫描状态、上传暂存、远程下载与插件数据，必须始终可写。
- Web 插件安装需要服务端可执行 npm（官方容器已包含）。可通过服务端 npm 配置设置 registry；下载、依赖和缓存都放在 `DATA_DIR/plugins` 的独立安装目录，成功后清理临时包和下载缓存。安装最长等待 5 分钟，禁用 npm 生命周期脚本；需要编译或额外运行环境的插件应由发布者提供构建产物与部署说明。
- `DATA_DIR` 不能与 `BOOKS_DIR` 相同或位于其内部，启动时会拒绝该配置。
- 镜像入口脚本尝试修正数据目录本身的属主，再以 `reader` 用户运行。它不会替你修改书籍目录的属主，也不会递归修复已有数据文件的权限。

书库只读不影响账号和阅读进度写入数据目录。需要上传时，除修改 `:rw` 外，还要检查宿主机 ACL 或目录权限。

## 环境变量

以下是直接运行服务端时的默认值。Docker 镜像另设 `DATA_DIR=/data`、`WEB_DIR=/app/web`，`BOOKS_DIR=/books`。

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `BOOKS_DIR` | `/books` | 书籍目录 |
| `DATA_DIR` | 当前工作目录下的 `data` | 服务端状态和缓存目录 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `8080` | 监听端口 |
| `PUBLIC_URL` | 空 | 对外访问地址，反向代理后设置 |
| `SCAN_INTERVAL` | `1800` | 定时扫描间隔，秒；`0` 关闭 |
| `WATCH_INTERVAL` | `60` | 变化检查间隔，秒；`0` 关闭 |
| `ALLOW_REGISTRATION` | `false` | 首个账号之后是否允许公开注册 |
| `ACCESS_TOKEN_TTL` | `86400` | 访问令牌有效期，秒 |
| `REFRESH_TOKEN_TTL` | `31536000` | 刷新令牌有效期，秒 |
| `READER_TOKEN_SECRET` | 自动生成 | 至少 16 字符的签名密钥；默认保存在 `DATA_DIR/token.secret` |
| `LOG_LEVEL` | `info` | 日志级别 |
| `CORS_ORIGINS` | 空 | 允许的浏览器来源，逗号分隔；空值反射请求来源 |
| `WEB_DIR` | 当前工作目录下的 `web` | 已构建 Web 客户端目录 |
| `TTS_URL` | 空 | HTTP 语音上游地址，空值关闭 HTTP 朗读 |
| `TTS_TOKEN` | 空 | 上游 Bearer 令牌 |
| `TTS_VOICES_URL` | `<TTS_URL>/voices` | 上游语音列表 |
| `TTS_TIMEOUT_MS` | `20000` | 单次语音请求超时，毫秒 |
| `TTS_CACHE_BYTES` | `268435456` | `DATA_DIR/tts-cache` 缓存上限，字节；`0` 关闭 |

修改 Compose 环境变量后执行 `docker compose up -d`。签名密钥需要稳定保存，否则已有会话会失效。数据目录中的账号、进度和笔记不能靠重新扫描书籍恢复。

## HTTPS 与反向代理

局域网可直接访问 `http://<服务器IP>:8080`。对公网提供服务时使用 HTTPS，保护登录凭据和访问令牌。

例如 Caddy 与 reader 运行在同一台主机上时：

```caddyfile
reader.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

设置 `PUBLIC_URL=https://reader.example.com`。如果 Caddy 也在容器中，代理地址应改为容器网络中 reader 的服务地址。

前后端分开部署时，将 `CORS_ORIGINS` 设置为 Web 客户端的实际来源。书源搜索采用 Streamable HTTP，代理需要持续转发 `text/event-stream`；不要把搜索响应缓冲到完成后才返回。没有公网 IP 时也可用 VPN 或隧道连接服务。

## HTTP 朗读

优先使用 Android 系统语音或浏览器 `speechSynthesis`。需要 HTTP 语音时，在 Compose 中配置兼容上游：

```yaml
environment:
  TTS_URL: "http://your-tts-host:5002/tts"
  # TTS_TOKEN: "your-token"
  # TTS_VOICES_URL: "http://your-tts-host:5002/voices"
  TTS_CACHE_BYTES: "268435456"
```

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

### 远程书源搜索失败

检查来源地址、当前账号凭据和搜索结果中的错误详情，确认来源与插件已启用。插件额外的运行依赖和配置要求，以插件作者提供的文档为准。
