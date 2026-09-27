# OpenList 媒体库

影音的「新建媒体库」支持服务器目录与 OpenList。OpenList 通过后台只读适配器接入，沿用现有扫描目录、作品详情、权限、收藏与播放进度；不修改阅读模块。

## 配置

- **服务地址**：Reader 服务端可访问的 OpenList HTTP/HTTPS 地址，例如 `http://nas:5244`。部署在子路径时包含该前缀，例如 `https://nas.example/openlist`；不要填写 `/api/fs/list` 或下载地址。
- **远端目录**：OpenList API 所见的绝对路径，例如 `/电影`、`/音乐`。使用 `/` 分隔。OpenList 普通用户配置了基本路径时，填写该用户视角下的路径。
- **API Token**：按 OpenList 的 Authorization 值原样填写，不额外添加 Bearer。允许访客读取的目录可以留空；其余目录使用可读取目标目录的凭据。
- **目录密码**：仅目标目录设置了访问密码时填写。
- **内容类型与访问范围**：仍由 Reader 独立控制。OpenList 有权限，并不代表所有 Reader 用户都能访问该库。

创建前先校验目录可读；失败不会创建空壳库。创建成功后使用现有扫描操作导入。已有库可更新 Token 和目录密码，空白且未修改表示保留；显式清除表示使用空凭据。服务地址与根目录不可在已有库中更换，避免把旧作品、进度错误绑定到另一来源。

凭据仅保存在服务端影音数据库的 `media_library_openlist` 表，配置响应只返回 `hasToken` / `hasPassword`。备份影音数据库时需要一并保护该备份。创建请求回执只保存远程配置摘要，不重复保存明文凭据。普通用户的媒体库响应不包含服务地址、根目录或凭据。

## 支持范围

- 按页递归读取目录，支持电影、剧集、音乐、有声书的既有文件扩展名与文件名分组规则。
- 读取外置 NFO、封面、歌手资料、LRC 歌词及字幕。旁车匹配保留列表返回的实际大小写路径。
- 播放时重新解析临时下载地址，通过 Reader 的授权流接口代理传输；支持上游正确实现的字节 Range，下载 URL 和 OpenList Token 不下发浏览器。
- 目录读取或旁车网络读取失败时，扫描失败并保留之前的作品、可用状态和元数据，不将断网误判为资源全部失效。
- 同一次扫描复用目录快照，最多缓存 64 个目录、合计 20,000 项，并合并正在进行的相同目录请求；失败不缓存，下一次扫描创建新适配器重新读取。
- 编辑凭据先校验新连接；失败保留旧凭据。新增、编辑和扫描仅管理员可操作。

## 当前限制

- 不转码。浏览器仍需支持媒体容器和编码。
- 远程文件不交给本地 ffprobe；暂不读取内嵌音频标签、封面、歌词、字幕及有声书章节，也不预先探测时长与编码。外置 NFO/图片/歌词/字幕可用，播放器可在加载后获得播放时长。
- `.m3u8` 播放列表、TVBox、JAR 与云盘登录流程不由此适配器处理。OpenList 负责其挂载服务的访问和凭据。
- 若某 OpenList 驱动需要专用下载请求头，请在 OpenList 为该挂载启用 **Web 代理**。Reader 不会把 OpenList API Token 转发到下载源。代理或直链上游必须正确支持 Range；忽略或错误返回 Range 会明确失败，避免返回错误片段。
- 创建校验和每次 API 请求最长 15 秒；下载连接和流的连续无数据等待最长 15 秒，有数据持续传输的播放不受总时长限制。远端服务必须由 Reader 服务端可达；建议生产环境使用 HTTPS。
- 每页读取 200 项，每个目录最多 100,000 项、每次扫描最多 10,000 个目录、深度最多 64 层。超过边界时报告扫描失败，保留旧快照。扫描使用 OpenList 缓存目录（`refresh:false`），外部挂载变化可先在 OpenList 刷新，再扫描 Reader。
- 仅对用户明确配置的 OpenList 服务进行接入；下载地址及跳转由该服务提供，服务应为管理员信任的实例。

## API

`POST /api/v1/media/libraries` 保持原有本地库参数兼容。OpenList 示例：

```json
{
  "name": "家庭电影",
  "kind": "video",
  "storage": "openlist",
  "root": "/电影",
  "access": "restricted",
  "openlist": {
    "baseUrl": "http://nas:5244",
    "token": "YOUR_OPENLIST_TOKEN",
    "password": ""
  }
}
```

`PATCH /api/v1/media/libraries/:id` 可提交 `name` 和/或 `openlist:{token?,password?}`；字段不传则保留，空字符串表示清除。`GET /api/v1/media/libraries/:id/configuration` 仅管理员可读，包含 `storage`、`root`、`openlist:{baseUrl,hasToken,hasPassword}`，使用 `private, no-store`。

连接错误返回经过清理的 `MEDIA_OPENLIST_AUTH` 或 `MEDIA_OPENLIST_UNAVAILABLE`；错误 Range 为 `MEDIA_OPENLIST_RANGE`，扫描遇到目录变化为 `MEDIA_OPENLIST_CHANGED`。扫描任务归纳为 `openlist-auth-failed` / `openlist-unavailable`，不会携带上游路径、下载签名或错误正文。

## 官方契约来源与验证

依据 OpenList v4 源码，核对版本 `54ae9d7451707d76b4c92f0e946a407fb6bb4481`：

- [fsread.go](https://github.com/OpenListTeam/OpenList/blob/54ae9d7451707d76b4c92f0e946a407fb6bb4481/server/handles/fsread.go)：`POST /api/fs/list` 的 `path/password/page/per_page/refresh`，返回 `content/total`；`POST /api/fs/get` 返回文件信息和 `raw_url`。
- [router.go](https://github.com/OpenListTeam/OpenList/blob/54ae9d7451707d76b4c92f0e946a407fb6bb4481/server/router.go)：鉴权及 fs 端点。
- [down.go](https://github.com/OpenListTeam/OpenList/blob/54ae9d7451707d76b4c92f0e946a407fb6bb4481/server/handles/down.go)：下载跳转与 Web 代理行为。

自动化测试使用同契约的临时 HTTP 服务，覆盖分页/子目录、拒绝越界路径、不完整扫描、大小写旁车、凭据更新与权限撤销、NFO/封面/歌词、Range、重定向凭据隔离和读取超时。测试不等同于对每一种 OpenList 网盘驱动的实测。
