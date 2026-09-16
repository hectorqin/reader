# API 参考

基础路径 `/api/v1`。除标注「公开」外都需要 `Authorization: Bearer <accessToken>`。

错误响应统一格式：

```json
{ "error": { "code": "BOOK_NOT_FOUND", "message": "book not found" } }
```

## 兼容性承诺

只做加法。已有字段的语义不会改，端点不会删。
客户端可以按 `apiVersion` 判断能力，但不需要为小版本做分支。

---

## 实例信息

### `GET /instance` — 公开

```json
{ "name": "reader", "apiVersion": 1, "registrationOpen": false, "userCount": 3 }
```

客户端用它区分「全新实例」（可以注册）和「已被占用」（需要管理员开账号）。

### `GET /health` — 公开

```json
{ "status": "ok", "booksDir": "/books", "dataDir": "/data",
  "version": "0.1.0", "dataDirIsInsideBooks": false }
```

`dataDirIsInsideBooks` 恒为 `false`——为 `true` 时服务端根本不会启动。
暴露出来是为了让运维一眼确认挂载点就是自己以为的那个。

---

## 认证

### `POST /auth/register` — 公开

```json
{ "username": "owner", "password": "至少8位", "displayName": "图书馆长" }
```

- 首个账号恒可注册，且自动成为 `admin`
- 之后仅在 `ALLOW_REGISTRATION=true` 时开放
- 关闭时返回 `400 REGISTRATION_DISABLED`

返回 `201`：

```json
{ "user": { "id": "...", "username": "owner", "displayName": "图书馆长",
            "role": "admin", "createdAt": 1789537801289 },
  "session": { "user": {...}, "accessToken": "...", "accessTokenExpiresAt": 1789624201289,
               "refreshToken": "...", "refreshTokenExpiresAt": 1821073801289 } }
```

### `POST /auth/login` — 公开

`{ "username": "...", "password": "..." }` → 同上（不含 `user` 外包一层）

失败恒为 `401 BAD_CREDENTIALS`，不区分「用户不存在」和「密码错误」。
账号停用返回 `403 ACCOUNT_DISABLED`。

### `POST /auth/refresh` — 公开

`{ "refreshToken": "..." }` → 新的 `session`。

**刷新令牌会轮转**：传入的那个立即作废。客户端必须持久化新的那个。

### `POST /auth/logout`

`{ "refreshToken": "..." }` → `{ "ok": true }`。幂等，重复调用不报错。

### `GET /auth/me`

→ `{ "user": { ... } }`

### `POST /auth/password`

`{ "currentPassword": "...", "newPassword": "..." }` → `{ "ok": true }`

会撤销该账号**所有**会话（含当前设备），需要重新登录。

---

## 书架

### `GET /books`

查询参数：

| 参数 | 说明 |
| --- | --- |
| `search` | 匹配书名 / 作者 / 系列 / ISBN |
| `author` `series` `tag` `format` | 精确过滤 |
| `sort` | `title` \| `author` \| `added` \| `updated`，默认 `added` |
| `order` | `asc` \| `desc`，默认 `desc` |
| `page` `pageSize` | 默认 1 / 50，`pageSize` 上限 200 |

```json
{ "items": [ { "id": "...", "title": "三体", "author": "刘慈欣",
               "series": "地球往事", "seriesIndex": 1, "tags": ["科幻"],
               "format": "epub", "coverUrl": "/api/v1/books/<id>/cover",
               "fileSize": 1843, "source": "embedded", "manualFields": [] } ],
  "total": 1, "page": 1, "pageSize": 50 }
```

只看得到「有可用文件」的书。文件被删的书不会留在书架上。

`source` 是基础元数据的来源，`manualFields` 列出被手动改过的字段。

### `GET /books/:id`

→ `{ "book": {...}, "progress": {...} | null }`

### `GET /books/:id/manifest`

渲染器布局前需要的清单：

```json
{ "book": {...}, "contentUrl": "/api/v1/books/<id>/content",
  "coverUrl": "...",
  "files": [ { "rel_path": "小说/三体.epub", "size": 1843, "missing": 0 } ] }
```

`files` 让客户端能区分「另一份副本」和「文件真的没了」。

### `GET /books/:id/content`

流式返回书文件，`Content-Type` 按格式给 `application/epub+zip` 或 `application/pdf`。

书内容按哈希不可变，所以带 `ETag`，客户端可以放心长缓存。

### `GET /books/:id/file?path=<rel_path>`

流式返回这本书的**某一个**文件。

只有一种格式需要它：以图片目录形式存放的漫画。这种情况没有一个「书文件」可以整体
下载，客户端按页取。`path` 必须是这本书已经登记过的 `rel_path`——
服务端按 `book_files` 表精确匹配，不会用 query 拼路径，所以路径穿越只会匹配到空。

响应与 `/content` 一致，但 `ETag` 是按文件而非按书。

### `GET /books/:id/cover`

返回封面。无封面时 `404 NO_COVER`。缓存头是 `immutable`（封面随书籍主键变化）。

### `PATCH /books/:id/metadata`

```json
{ "title": "三体（修订版）", "tags": "科幻,雨果奖", "seriesIndex": 1 }
```

可改字段：`title` `author` `publisher` `language` `isbn` `description` `series`
`seriesIndex` `pubdate` `tags`（`tags` 用逗号分隔的字符串）。

写入的是覆盖层，**扫描永远不会覆盖它**。

### `DELETE /books/:id/metadata/:field`

撤销单个字段，回落到内嵌值。可用来实现 UI 上的「还原」按钮。

---

## 静态客户端

### `GET /` 与 `GET /*` — 公开

服务端会托管构建好的 H5 客户端（构建时打进镜像，或由 `WEB_DIR` 指定）。

- 找不到客户端产物时这些路由**不会注册**，纯服务端部署不受影响
- 都是公开的：它们只是静态资源，背后的 API 仍然要令牌
- 不带扩展名的路径一律回落到 `index.html`，方便深链
- `.html` 不缓存（否则升级后拿不到新产物），其余资源缓存 1 小时

## 书库

### `GET /library/facets`

→ `{ "authors": [...], "series": [...], "tags": [...], "formats": [...] }`
用来构建筛选界面。

### `GET /library/continue?limit=20`

继续阅读列表，按最近阅读时间倒序。带 `percentage` 和 `chapterTitle`。

### `GET /library/stats`

→ `{ "myBooks": 3, "libraryBooks": 10, "files": 12, "missingFiles": 1,
     "formats": [{"format":"epub","n":9}], "scan": {...} }`

### `POST /library/scan` — 管理员

触发一次扫描，同步等待结果。并发调用会共享同一次扫描。

### `GET /library/scan`

→ `{ "progress": { "running": false, "scanned": 12, "added": 1, ... } }`

---

## 同步

### `GET /sync?since=<ms>&bookId=<可选>`

`since` 是上次响应里的 `serverTime`（首次传 0）。

```json
{ "serverTime": 1789537864820,
  "progress": [ { "bookId": "...", "locator": "epubcfi(/6/4!/4/2)", "percentage": 0.42,
                  "chapterTitle": "第七章", "device": "android-a", "updatedAt": 1000 } ],
  "notes": [ { "id": "...", "bookId": "...", "type": "highlight", "locator": "...",
               "text": "...", "comment": "...", "color": "yellow",
               "updatedAt": 1789537864623, "deleted": false } ] }
```

**客户端必须保存返回的 `serverTime`**，下次带回来才能只拿增量。

### `POST /sync`

```json
{ "progress": [ { "bookId": "...", "locator": "...", "percentage": 0.42,
                  "chapterTitle": "第七章", "device": "android-a", "updatedAt": 1000 } ],
  "notes": [ { "id": "...", "bookId": "...", "type": "highlight", "locator": "...",
               "text": "...", "comment": "...", "color": "yellow",
               "updatedAt": 1000, "deleted": false } ] }
```

两个数组至少给一个，总数上限 5000（超了返回 `400 BATCH_TOO_LARGE`）。

`updatedAt` 是**客户端时钟**的毫秒时间戳，决定 LWW 谁赢。

响应把合并后的当前状态一并返回，客户端不用再多发一次拉取：

```json
{ "accepted": 1, "rejected": 0, "serverTime": 1789537864820,
  "progress": [...], "notes": [...] }
```

注意：`notes[].type` 只接受 `note` / `highlight` / `bookmark`。
`notes[].deleted: true` 是删除（写墓碑）。

### `GET /sync/progress/:bookId`

→ `{ "progress": {...} | null }`

### `PUT /sync/progress/:bookId`

单个进度上报的便捷写法：

```json
{ "locator": "epubcfi(/6/4!/4/2)", "percentage": 0.42,
  "chapterTitle": "第七章", "device": "android-a", "updatedAt": 1789537864623 }
```

`percentage` 会被夹到 `[0, 1]`。

### `GET /notes?bookId=<可选>&since=<可选>`

已过滤掉墓碑，只返回可见笔记。

### `POST /notes`

```json
{ "bookId": "...", "type": "highlight", "locator": "...",
  "text": "选中的原文", "comment": "我的批注", "color": "yellow" }
```

`id` 可省略或由客户端生成（推荐，便于离线创建）。返回 `201`。

### `DELETE /notes/:id`

写墓碑。幂等：不存在也返回 `{ "ok": true }`。

---

## 管理员

### `GET /admin/users`

→ `{ "users": [ { "id": "...", "username": "...", "displayName": "...",
                  "role": "member", "createdAt": 0 } ] }`

### `POST /admin/users`

```json
{ "username": "family", "password": "familypass123",
  "displayName": "家人", "role": "member" }
```

不受 `ALLOW_REGISTRATION` 限制——管理员本就该能加家庭成员。

### `PATCH /admin/users/:id`

`{ "disabled": true }` 或 `{ "role": "admin" }`。

不能停用自己（`400 SELF_LOCKOUT`），否则会把自己锁在外面。

### `GET /providers`

→ `{ "providers": [ { "id": "none", "displayName": "...", "enabled": true } ] }`

第一版只有 `none`。在线源接入后会自动出现在这里。

---

## 错误码

| 码 | HTTP | 含义 |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | 参数不合法 |
| `BAD_PAYLOAD` | 400 | 请求体结构错误 |
| `BATCH_TOO_LARGE` | 400 | 同步批次超过 5000 |
| `REGISTRATION_DISABLED` | 400 | 实例已关闭公开注册 |
| `SELF_LOCKOUT` | 400 | 不能停用自己 |
| `NO_TOKEN` | 401 | 缺少 Bearer 令牌 |
| `TOKEN_INVALID` | 401 | 签名错误 / 载荷被改 / 类型不对 |
| `TOKEN_EXPIRED` | 401 | 访问令牌过期，用 refresh 换新 |
| `REFRESH_INVALID` | 401 | 刷新令牌无效 / 已使用 |
| `REFRESH_EXPIRED` | 401 | 刷新令牌过期，需要重新登录 |
| `BAD_CREDENTIALS` | 401 | 用户名或口令错误 |
| `ACCOUNT_DISABLED` | 403 | 账号被停用 |
| `FORBIDDEN` | 403 | 越权访问 |
| `PATH_TRAVERSAL` | 403 | 路径逃逸出挂载点 |
| `ADMIN_REQUIRED` | 403 | 需要管理员权限 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `NO_COVER` | 404 | 这本书没有封面 |
| `FILE_MISSING` | 404 | 文件已从磁盘消失 |
| `USERNAME_TAKEN` | 409 | 用户名已占用 |
| `PASSWORD_TOO_SHORT` | 409 | 口令少于 8 位 |
| `INTERNAL` | 500 | 服务端错误 |

## 客户端应当遵守的约定

这几条不是服务端强制，而是客户端行为的一部分，写在这里以免下一个客户端重新踩：

1. **保存每次响应里的 `serverTime`**，下次带回来。从 0 拉全量在移动网络上很贵。
2. **`locator` 服务端不解释**，格式由客户端定义，但一旦发布就要向后兼容——
   用户不会及时升级客户端，和自部署用户不会及时升级服务端是同一个问题。
   当前客户端用的是 `r1:<偏移>:<章节 id>`，偏移是章节内的比例而非像素或列号，
   这样换字号、换屏幕宽度、换主题都不会跳位置。
3. **拉取回来的 `deleted: true` 是墓碑**，本地也要删；不要因为它「看起来是空的」就丢弃。
4. **推送是合并而不是覆盖**，按 `updatedAt` 做 LWW。所以离线队列可以放心重放。
