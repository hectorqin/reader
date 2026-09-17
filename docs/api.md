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

`apiVersion` 是**能力版本**，与包的版本号无关：只有在字段语义变化、客户端必须改行为时
才动它。加字段、加端点都不动——这正是「只做加法」能成立的原因。

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

渲染器布局前需要的清单。**打开一本书就是这一次请求**，可寻址结构也在里面，
所以客户端拿到响应就能画出第一屏。**已经带上第一个窗口的可寻址结构**：
`?group=N` 只换窗口，`groups` 始终完整。

```json
{ "book": {...},
  "contentUrl": "/api/v1/books/<id>/content",
  "coverUrl": "...",
  "files": [ { "rel_path": "小说/三体.epub", "size": 1843, "missing": 0 } ],
  "content": { "kind": "reflowable", "total": 42, "groups": [...], "items": [...] },
  "kind": "reflowable", "total": 42, "groups": [...], "items": [...] }
```

`kind` / `total` / `groups` / `items` 与 `content` 的内容相同，同时放在顶层是**冗余的
兼容层**：它们先于 `content` 存在，且 `kind` 是外壳判断「谁来渲染」的唯一开关
（见 `android/contract.md`）。新客户端读 `content`，老客户端读顶层字段，两者都不会错。

**`files` 让客户端能区分「另一份副本」和「文件真的没了」**：`missing: 1` 表示行还在、
磁盘上没了。它同时是 `/books/:id/file` 的**契约**——manifest 列出哪些路径构成这本书，
`/file` 就服务哪些路径，多一条也没有。两边的清单由**同一个页面遍历**生成，
所以不会互相漂移。

对单文件书，这里是文件表里的行（一般是 1 条）。对目录书，这里由格式处理器给出：
页面就是**页面自己的库内路径**，压缩包里的页面按**压缩包自己的路径**列出（一个压缩包算一页），
包内页码由同一条目上的 `ref` 寻址——`ref` 是不透明引用，客户端原样回传 `/assets?ref=` 即可，
不要自己拼。

`?group=N` 会把 `items` 收窄到第 N 组，`groups` 仍然完整——这样打开一本 40 卷的漫画
只传一卷的条目。目录客户端用 `/toc`，不要自己拼 `groups` 的标题。

### `GET /books/:id/items?group=N`

`group` 省略时等价于 `group=0` —— 返回**第一个窗口**，不是整本书。这是刻意的：
不带参数的调用是「打开这本书」，它必须便宜。要完整结构用 `?group=all`。


书里有哪些**可寻址的单元**：章节、页、卷。这是客户端构建目录和分页的地方。

契约对所有格式一致，`kind` 字段告诉客户端该按什么方式渲染：

| `kind` | 含义 | 典型格式 |
| --- | --- | --- |
| `reflowable` | 可重排文本，按章节加载 | epub |
| `paged` | 固定页序的图片 | cbz、漫画目录、单图 |
| `text` | 连续文本，可能带章节 | txt |
| `document` | 不透明文档，客户端自己渲染 | pdf |
| `single-image` | 单页图片 | 单个图片文件 |

**章节按包内路径寻址，不按下标。** `items[].href` 是不透明的格式私有引用
（`xhtml:OEBPS/ch1.xhtml`、`page:17`、`chapter:4`），客户端原样回传即可。
下标只在一个窗口内成立：分窗返回的是 spine 的前缀，所以按下标算出的章节
在完整 spine 里指向另一章。

```json
{ "kind": "paged", "total": 6,
  "groups": [ { "id": "v0", "seq": 0, "title": "第01卷", "count": 3 },
              { "id": "v1", "seq": 1, "title": "第02卷", "count": 3 } ],
  "items": [ { "id": "0:0", "seq": 0, "title": "001.jpg", "kind": "page",
               "mediaType": "image/jpeg", "href": "page:0:0" } ] }
```

`groups` 是卷（漫画）或单一隐式分组（epub/txt）。`?group=N` 只返回第 N 组，
让客户端一次只取一卷而不是整个系列的几千页清单。

`total` 在格式无法廉价得知时为 `0`，`groups` 为空 —— 例如没有标题的纯文本。
不要把它当作错误。

### `GET /books/:id/toc`

书的目录。**与 `/items` 分开**，因为两者要的性质相反：`/items` 是传输边界，
一次给一点；目录必须完整，否则跳转是残的。合成一个接口会让目录显示成
「第 1 章 – 第 40 章」——服务端的分页边界漏进 UI。

```json
{ "toc": [ { "href": "xhtml:OEBPS/text/ch1.xhtml", "title": "第一章", "level": 0, "spine": 0 } ] }
```

`spine` 是全书下标，`/items?group=N` 的每个 group 都带 `offset`，所以客户端
拿到单窗也能把跳转落到正确章节，不需要把前面的 count 加一遍。

按格式：epub 取 spine 标题（NCX / nav），txt 取分章结果，漫画目录取卷，
pdf / 单图没有独立目录，回落到 items。

### `GET /books/:id/assets?ref=<ref>`

取单个资源。`ref` 是**不透明**的格式私有引用，客户端只应把它从 `items[].href`
原样回传，不要自己拼。

| 格式 | ref 形态 |
| --- | --- |
| epub | `chapter:2`（第 3 章）、或包内资源路径 `OEBPS/images/pic.png` |
| cbz | `page:17` |
| 漫画目录 | `page:1:2`（第 2 卷的第 3 页） |
| txt | `chapter:4` 或 `chunk:262144`（字节偏移） |
| pdf | `document` |

响应带 `Cache-Control: private, max-age=31536000, immutable`：资源由书籍主键寻址，
而主键来自内容哈希，所以同一个 URL 的内容永不改变。

**流式下发，支持 Range。** 响应带 `Accept-Ranges: bytes` 时可以用
`Range: bytes=0-1023` 取片段（PDF 跳页、漫画跳卷、断点续传）。压缩方式为
`deflate` 的 zip 条目无法字节定位，会诚实上报 `Accept-Ranges: none` ——
让客户端知道，而不是白跑一次再发现。

**尾部范围（`bytes=-N`）在超过 8MB 时退化为整包响应。** 一个前向流无法「跳到文件末尾」，
服务这条请求意味着把整个文件读完再丢掉——对 400MB 的漫画包就是拿三个字节换一次全量读。
所以服务端会说 `Accept-Ranges: none` 并回 200，让客户端能做计划，而不是付出一次它没
预期到的下载。

**子资源可以带 `?access_token=`。** 章节里的 `<img src>`、`<link href>` 是浏览器
自己发起的，没法带 `Authorization` 头。这类请求允许把令牌放进 query，
但**仅限** `GET` + 下列端点：

- `/api/v1/books/:id/assets`
- `/api/v1/books/:id/cover`
- `/api/v1/books/:id/content`

其他任何端点（含触发扫描、写元数据）都不接受 URL 里的令牌 —— URL 会进日志、
进历史、进 `Referer`，能改状态的令牌不该走那条路。

**epub 章节返回的是重写过的 HTML。** 章节内的相对资源引用（`images/pic.png`）已经被
服务端改写成指向本端点的绝对地址。客户端直接把 HTML 交给 WebView 即可，不需要自己
解析路径。绝对 URL、`data:` URI 和文内锚点（`#note7`）保持原样，所以脚注和外链仍然可用。

### `GET /library/formats`

本实例支持的格式清单，由格式注册表生成：

```json
{ "formats": [ { "format": "epub", "kind": "reflowable", "label": "EPUB（精排渲染，保留出版方样式）",
                 "extensions": ["epub"], "directory": false } ] }
```

客户端用它决定显示哪些入口，不必硬编码格式列表。

### `GET /books/:id/content`

流式返回书文件，`Content-Type` 按格式给 `application/epub+zip` 或 `application/pdf`。

书内容按哈希不可变，所以带 `ETag`，客户端可以放心长缓存。支持
`Range: bytes=`，所以**离线下载可以续传**。

目录型书籍（漫画目录）没有单一文件，返回 `400 DIRECTORY_BOOK`；
这类书按 `items?group=N` 逐卷取图。

### `GET /books/:id/file?path=<rel_path>`

流式返回这本书的**某一个**文件（二进制流，不是 JSON）。

只有一种格式需要它：以目录形式存放的漫画。它没有一个「书文件」可以整体下载，
客户端按页取。`path` 必须是 `/manifest` 的 `files` 里出现过的那个 `rel_path`——
服务端只按这份清单精确匹配，**从不**用 query 拼路径，所以路径穿越只会匹配到空。

**`files` 是契约，不是清单。** 两边由同一个页面遍历生成：manifest 列出哪些路径构成
这本书，本端点就服务哪些路径。目录书的页面哪怕住在压缩包里，也按**压缩包自己的路径**
列出（`第01卷.cbz`），因为那才是能拿来发请求的路径；请求这个路径拿到的是**这一页的图**，
不是压缩包本身。压缩包内部的页码由 `/assets?ref=page:卷:页` 寻址，不是文件路径，
也永远不会出现在 `files` 里。

manifest 的每个条目还带 `ref`，即这个文件对应的**资源引用**。要按页取用 `/assets?ref=`，
引用**原样**回传——它不是路径，也不是下标：卷的边界只有格式处理器知道，
客户端从 `rel_path` 反推会让「第 1 页」指向另一页。

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

## 朗读（HTTP TTS）

这两条路由只在服务端配置了 `TTS_URL` 时才有意义，并且分工明确：
一条回答「这里能用什么」，一条真正合成音频。

### `GET /tts/voices`

能力查询，朗读设置面板打开时调用一次。

→ `{ "http": false, "formats": ["audio/mpeg", ...], "maxLength": 800, "voices": [] }`

- 未配置 `TTS_URL` 时返回 `http: false` 而**不是 404**：客户端问的是「这里能用什么引擎」，
  不是「这个接口存在吗」。一个 `TTS_URL` 没配的实例是完全正常的实例。
- `maxLength` 无论开关都返回：客户端会按它切句，这个决定发生在选引擎之前。
- 配置了之后 `voices` 来自 `TTS_VOICES_URL`（或约定路径 `<TTS_URL>/voices`）。

### `GET /tts?text=<文本>&voice=<可选>&speed=<可选>&format=<可选>`

合成一条语句，返回音频字节流（`audio/*`）。

- **一次一条语句，不是一章**。客户端本来就是逐句朗读（理由见架构文档第 9 节），
  而按请求切分正是让暂停、续读、下一句、改语速在远程引擎上也能工作的前提；
  它同时把响应限制在手机可以边走边缓冲的大小，并让缓存以句为单位而不是以书为单位。
- `speed` 夹在 0.25–4；`text` 上限 800 字，超了返回 `TEXT_TOO_LONG`，
  **不会转发给上游**。
- 上游返回非 `audio/*` 时返回 `TTS_UPSTREAM` 而不是把 HTML 当音频流出去：
  一个配错的 `TTS_URL`（指到一个网页）会以 200 返回 HTML，塞进 `<audio>` 里
  既没有声音也没有事件——这是最难排查的一种「成功」。
- 这是唯一接受**查询串令牌**的接口之一（另一个是 `/books/:id/assets`、`/cover`、`/content`）：
  `<audio src>` 无法携带 `Authorization` 头。因此它被精确地限制为 `GET /tts`，
  能力查询 `/tts/voices` 不支持查询串令牌。
- 响应带 `cache-control: private, max-age=604800, immutable`：
  同一句话的音频永远相同，第二次播放不应该再到服务端。

相关环境变量：

| 变量 | 说明 |
| --- | --- |
| `TTS_URL` | 上游合成服务的地址，例如 `http://127.0.0.1:5002/tts`。不设则关闭 HTTP 朗读 |
| `TTS_TOKEN` | 以 `Authorization: Bearer` 转发给上游 |
| `TTS_VOICES_URL` | 语音列表地址；默认 `<TTS_URL>/voices` |
| `TTS_TIMEOUT_MS` | 单次合成超时，默认 20000 |
| `TTS_CACHE_BYTES` | 音频磁盘缓存上限（`DATA_DIR/tts-cache`），默认 256MiB；0 关闭缓存 |

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
| `DIRECTORY_BOOK` | 400 | 这本书由目录承载，按页取而不是整本下载 |
| `UNSUPPORTED_FORMAT` | 400 | 该格式不提供可寻址结构 |
| `EMPTY_ASSET` | 400 | 资源既没有数据也没有流 |
| `ADMIN_REQUIRED` | 403 | 需要管理员权限 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `NO_COVER` | 404 | 这本书没有封面 |
| `FILE_MISSING` | 404 | 文件已从磁盘消失 |
| `USERNAME_TAKEN` | 409 | 用户名已占用 |
| `PASSWORD_TOO_SHORT` | 409 | 口令少于 8 位 |
| `TTS_DISABLED` | 400 | 该实例没有配置 `TTS_URL`，无法使用 HTTP 朗读 |
| `TTS_UPSTREAM` | 400 | 上游合成服务不可达、超时、报错，或返回的不是音频 |
| `TEXT_TOO_LONG` | 400 | 单条语句超过 800 字，请客户端先切句 |
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
