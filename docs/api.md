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
| `path` | 只返回**这个目录下**（含子目录）有文件的书。库内相对路径，`''` 等于不过滤 |
| `scope` | `shelf`（默认）\| `library`。见下 |
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

只看得到可用文件书、当前用户已获取的下载书和章节出版物。本地文件被删的书不会留在书架上；插件禁用不会隐藏已经获取的章节书。

`path` 是对 `book_files.rel_path` 的**前缀匹配**，带上分隔符：`path=科幻` 匹配
`科幻/…`，不会匹配到旁边的 `科幻小说`。`%` 和 `_` 在文件名里合法、在 `LIKE` 里是通配符，
两个都转义。

它就是书库**浏览页**（`#/library/<路径>`）的数据源：那一页是「这个文件夹里的**书**」，
而书是这个 DTO 的形状——拿 `/library/browse` 的文件行去画网格，是把文件名画在书名的
位置上。浏览页的搜索框就用上面那个 `search` 参数，所以它是**这个文件夹内**的筛选
（`path` 和 `search` 同时生效），而不是整个库的搜索；整个库的搜索是书架的事。

### `scope`：书架，还是索引

默认的 `shelf` 是「**我能读什么**」：一行 `user_books`（`hidden = 0`）以及可用文件、已下载文件或属于当前用户的章节出版物。
它也是书架屏用的那个。

`scope=library` 是「**这个文件夹里有什么**」：每一个有活文件的书，**不管这本书在不在
调用者的书架上**，并且每一项多一个字段：

```json
{ "shelfState": "on" | "off" }
```

它是浏览页用的那个，因为浏览页的存在理由就是「把这本书加入书架」——问书架的话，
返回的每一本都已经在书架上，`shelfState` 恒为 `'on'`，**那个动作永远画不出来**。
一个商城只陈列你已经买过的东西，就没有东西可以加。

`shelfState` **只在 `scope=library` 时出现**。书架自己的列表里它恒为 `'on'`，
一个常量字段是一个客户端迟早会画出来的字段。缺省与 `'off'` 是两个不同的事实
（老服务端没有这个字段 / 有字段且明确不在），客户端对缺省不画控件。

`library` 作用域里的排序键 `added` 用 `COALESCE(ub.added_at, b.updated_at)`：
没有 `user_books` 行的书在 `DESC` 下会被 SQLite 排在**最前**，
那个顺序读起来就是「读者从没上架过的那本书是他最近拿到的」。
`BookDto.addedAt` 本来就按同一规则兜底，所以两处说的一样。

客户端只在 `path=''` 时省略这个参数（省略等于根目录），**不发 `path=` 空串**：
一个空路径是根，一个「我传了个空的」不是同一个请求。

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

`format=chapters` 是远程章节出版物，没有整书文件，`files` 为 `[]`。它的 manifest 始终返回完整目录快照，即使传入 `group` 也不分窗，`content.revision` 标识快照版本。`items[].href` 是稳定定位引用，`items[].resourceRef` 是带 revision 的正文引用；用前者保存进度，用后者请求 `/assets`。阅读器应从这同一份快照构建目录，避免并发刷新时把两份目录混合。

### `GET /books/:id/items?group=N`

`group` 省略时返回完整条目；传入 `group=N` 时只返回对应窗口。首次打开时应优先使用
`/manifest` 返回的窗口；文件书的 `/manifest` 默认是第一个窗口，这是刻意的：
不带参数的调用是「打开这本书」，它必须便宜。要完整结构用 `?group=all`。


书里有哪些**可寻址的单元**：章节、页、卷。这是客户端构建目录和分页的地方。

契约对所有格式一致，`kind` 字段告诉客户端该按什么方式渲染：

| `kind` | 含义 | 典型格式 |
| --- | --- | --- |
| `reflowable` | 可重排文本，按章节加载 | epub |
| `paged` | 固定页序的图片 | cbz、漫画目录、单图 |
| `text` | 连续文本，可能带章节 | txt、chapters |
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

取单个资源。`ref` 是**不透明**的格式私有引用。客户端优先取 `items[].resourceRef`，字段不存在时取 `items[].href`，原样回传，不要自己拼。已有文件格式不需要 `resourceRef`。

| 格式 | ref 形态 |
| --- | --- |
| epub | `chapter:2`（第 3 章）、或包内资源路径 `OEBPS/images/pic.png` |
| cbz | `page:17` |
| 漫画目录 | `page:1:2`（第 2 卷的第 3 页） |
| txt | `chapter:4` 或 `chunk:262144`（字节偏移） |
| pdf | `document` |
| chapters | `chapter-resource:<revision>:<chapter-id-hash>`；稳定 href 不能用于取资源 |

响应带 `Cache-Control: private, max-age=31536000, immutable`：文件资源由内容身份寻址；章节资源引用同时包含目录 revision，所以同一个资源 URL 的内容保持不变。

章节资源按 manifest 的 `mediaType` 返回 `text/plain; charset=utf-8` 或清洗后的 `text/html; charset=utf-8`，带 `nosniff` 和 `default-src 'none'; img-src data:; sandbox` CSP。纯文本必须转义排版；HTML 只保留白名单标签，图片经插件通道获取、校验 PNG/JPEG/GIF/WebP 签名并转为 data URL。脚本、样式、表单、外部链接、SVG 和任意网络图片被移除。正文读取后持久缓存，来源禁用或插件卸载不影响缓存命中；旧 revision 已缓存正文可读，未缓存正文返回 `409 CHAPTER_SNAPSHOT_EXPIRED`。

### `POST /books/:id/refresh`

为当前用户已获取的章节书拉取并原子提交新目录，响应是完整内容 manifest（不含外层 `book`）：

```json
{ "kind": "text", "revision": "<snapshot-sha256>", "total": 1,
  "groups": [{ "id": "chapters", "seq": 0, "title": "章节", "count": 1, "offset": 0 }],
  "items": [{ "id": "<chapter-id-hash>", "seq": 0, "title": "第一章", "kind": "chapter",
    "href": "chapter:<chapter-id-hash>",
    "resourceRef": "chapter-resource:<snapshot-sha256>:<chapter-id-hash>",
    "mediaType": "text/plain; charset=utf-8", "format": "html" }] }
```

`format: "html"` 表示客户端将纯文本排版为 HTML，不表示资源含 HTML；富文本条目省略 `format`、声明 `mediaType: text/html`，目录 `kind` 为 `reflowable`。该接口无需请求体；文件书返回 `400 SOURCE_UNSUPPORTED`，其他用户章节书返回 404。刷新失败保留旧目录；同一目录保持 revision 不变；正文变化时插件须更新 `ManifestSnapshot.version`。进度和笔记不重写，插章后以稳定 href 定位。手动刷新会更新检查时间和新增章计数，但不会自动开启订阅或预下载正文。

### 文件资源的流式与子资源行为

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

**这三条允许名单决定的是「能不能取」，不是「怎么取」。** 重写出来的地址还要**带令牌**
才真的能取到：章节文档里的 `<img src>`、`<link href>` 和 CSS 的 `url(...)` 都是浏览器
自己发起的请求，用的是文档里的原始地址，读不到客户端内存里的会话。客户端在注入章节时
把令牌追加到这些地址上（`sanitiseInjectedContent` 的 `signAssetUrl`），**追加发生在
允许名单判定之后**——否则一本书只要写一个第三方地址，就能让读者把自己的令牌送出去。

这两半必须都在，缺一个的症状都是「图片加载不出来」而且**不会报错**：只丢属性不报错，
只回 401 也不报错。UI 评审的替身服务因此对 `/assets` 也做鉴权（`access_token` 或
`Authorization` 二者之一），否则它会替真实服务端放行，让「图片加载不出来」在评审里
永远查不出来。

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

## 书库（文件管理器）

书架回答「我能读什么」，这一组端点回答「磁盘上有什么」。两者的差别不是冗余：
书籍 DTO 里从来不带路径，所以「刚扫完目录但书架上看不到这本书」在本组端点之外
没有任何地方能解释清楚。这也是唯一会**写** `BOOKS_DIR` 的一组端点。

路径都是**书库内相对路径**，`''` 表示根目录；每一个都会过
`resolveInside`，逃逸直接被拒。

> **信任边界**：挂载点就是边界，没有第二道。能在这里改文件的人，能改书库里的
> 任何文件——和 `POST /library/scan` 已有的信任级别一致。在这之上再叠一层按路径的
> ACL 只是安全表演。

### `GET /library/browse?path=<相对路径>&page=<页>`（管理员页面用）

```json
{ "path": "科幻/已读",
  "crumbs": [ { "name": "书库", "path": "" }, { "name": "科幻", "path": "科幻" } ],
  "parent": "科幻",
  "entries": [
    { "name": "三体.epub", "path": "科幻/已读/三体.epub", "type": "file",
      "size": 1234567, "mtime": 1789537864820, "mode": 420,
      "hidden": false, "hiddenByRule": false, "scanned": true,
      "ext": "epub", "indexed": true, "shelfState": "on" }
  ],
  "total": 1, "dirs": 0, "files": 1, "size": 1234567,
  "writable": true, "name": "已读" }
```

`hidden` 是「以点开头」，`hiddenByRule` 是「落在扫描器跳过的目录里」，
`scanned` 是「扫描器会把它当一本书」。

`shelfState` 是「**调用者**的书架有没有这本书」：`"on"` / `"off"`，
目录和不是书的条目是 `null`。「不在书架」这个状态是这个接口能回答、
而其它任何接口都回答不了的问题——读者把一本书从书架上拿掉之后，
书库页和书架页说的是两件不同的事，而只有前者知道原因。
它是按调用者算的（服务端用当前登录用户解析），不是条目自身的属性。
在书库页面里给每一行都画「在书架上」等于用一整列噪音盖住唯一一行例外，
所以界面只标记 `"off"`。

**被跳过的条目照样列出来。** `.trash`、`@eaDir` 这些目录是设计上不被扫描的，
在这里过滤掉就正好藏住了读者要找的那批文件——在磁盘上、但不在书架上。标记出来，
让界面能解释，而不是替读者决定不用知道。

`entries` 是**这一页**，`total` / `dirs` / `files` 是**整个目录**的。两者来自同一次
`readdir`，因为分开算会让摘要、分页器和它下面那几行在任何一次磁盘变化之后互相矛盾，
而读者没有办法判断三个数字里哪个是旧的。一页默认 200 条，`pageSize` 可以调小，
上界是 1000：书库面对的是文件系统，一个放四千张扫描件的目录是真实存在的，
把四千行发给浏览器再丢掉 3940 行，就是那个让屏幕显得坏掉的请求。

页码是非法的（`?page=abc`）时返回第一页而不是 400：页码是「列表里的一个位置」，
对一个读者无法处理的参数报错没有意义。超界由服务端夹（见 `BrowseService.list`）。

`writable` 是实际探测出来的（真的建一个临时目录再删），不是读 mode 位：
`drwxr-xr-x` 的只读 bind mount 看起来可写，写起来 `EPERM`。

符号链接按链接本身显示（`lstat`），不跟随——扫描器也不跟随，跟随等于描述一棵
索引里并不存在的树，还会顺着链接走出挂载点。

### `POST /library/browse/move`

```json
{ "paths": ["科幻/三体.epub"], "target": "科幻/已读" }
```

→ `{ "moved": 1, "target": "科幻/已读" }`

同挂载点内 `rename`，不复制删除：文件字节、`mtime`、`inode` 都不变，扫描器视为
无变化，书籍身份（`identifier + 内容哈希`）因此保持，进度和笔记都还在。

同时把索引指向新路径，不等下一次扫描——文件管理器关掉时就该是一致的。

整批一起校验、一起拒绝：一半成功的移动比拒绝难推理得多。

目标已有同名条目 → `409 DESTINATION_EXISTS`。合并还是报错只有调用方知道，
猜错就是数据丢失。把目录移进它自己 → `400 MOVE_INTO_SELF`。

### `POST /library/browse/rename`

```json
{ "path": "科幻/三体.epub", "name": "三体（修订版）.epub" }
```

`name` 是单个路径段，不含斜杠。→ `{ "path": "科幻/三体（修订版）.epub" }`

### `POST /library/browse/mkdir`

```json
{ "path": "科幻", "name": "待整理" }
```

→ `{ "path": "科幻/待整理" }`

### `POST /library/browse/delete`

```json
{ "paths": ["科幻/其他/球状闪电.epub"] }
```

→ `{ "removed": 1 }`

递归删除，**不进回收站**。索引行不动，留给下一次扫描标记 `missing`：
删除本身已经是危险的那一半，再绑一次全量扫描会让界面等好几分钟才报告成功。
勾选过的那一行也会一直留着，和「共享目录没挂上」是同一种状态——
「文件没了但书还记着」，比书架突然少一本好。

`paths` 必须是**非空字符串数组**：`"a"` 和 `["a"]` 只差一个键，
但把字符串悄悄包成数组，会让「删了 1 项」看起来像「删了很多项」。

只读挂载上任何写操作 → `403 READ_ONLY_MOUNT`。

### `POST /library/upload`

`multipart/form-data`。重复的 `file` 字段各带一个文件，字段 `path` 指定目标目录
（书库内相对路径，缺省根目录），字段 `onConflict` 决定重名怎么办。

```json
{ "uploaded": [
    { "path": "科幻/三体.epub", "originalName": "三体.epub", "name": "三体.epub",
      "size": 1234567, "kind": "file",
      "bookId": "…", "title": "三体" } ],
  "skipped": [ { "name": "坏.zip", "reason": "无法解压（METHOD_UNSUPPORTED）" } ],
  "scan": { "added": 1, "updated": 0, "scaned": 1, "removed": 0, "failed": 0,
            "startedAt": 1789537864820, "finishedAt": 1789537864831 } }
```

**这是唯一会往 `/books` 里写新字节的端点。** 部署文档要求挂载只读，文件管理器也照此
行事，所以在此之前加一本书只能走 SMB 再等扫描——对运维是合理流程，对家里其他人是不可能
的任务，而自部署书库就是给他们用的。

三条规则让它是个例外而不是个洞：

- **字节完整、且已经落在同一个文件系统上，才会进书库。** 请求体先流到
  `DATA_DIR/uploads` 的暂存文件（服务端自己的可写空间），只有写完的文件才 `rename`
  进 `BOOKS_DIR`。传到 90% 断线、信号没了、密码错了，都不可能留下半本书，
  因为书库里从不出现半本书。
- **名字不是路径。** 客户端送的是文件名，不是路径：斜杠、`..`、控制字符、会让扫描器
  看不见的前导点，一律改写或拒绝，再过一遍 `resolveInside`。`C:\Users\me\我的书\三体.epub`
  只会取最后一段。
- **写完就索引。** 文件在磁盘上、书架上看不到，正是文件管理器要解释的那种状态，
  所以上传以一次增量扫描收尾，而不是等调度器。一次请求扫一次，不是每个文件扫一次。

`onConflict`：

- `rename`（默认）— 保留两份，新的是 `三体 (2).epub`
- `skip` — 保留磁盘上已有的那本，新来的记进 `skipped`
- `overwrite` — 同一个路径，索引看到的是「原位编辑」，书保持身份，进度和笔记都在
- `fail` — 整批 `409 DESTINATION_EXISTS`

`.zip` / `.cbz` 会被当**合集**解开（`kind: "archive-entry"`）。这是读者真正下载到的
东西：四十卷装在一个包里。单层包裹目录会被抹平（`系列/第01卷.epub` 落成 `第01卷.epub`），
更深的树保持原样——`系列/第01卷/001.jpg` 是一本**目录书**，抹平它正好毁掉扫描器要读的结构。

压缩包里的名字一个都不信：每个条目按自己的段重建成名字，`../../etc/passwd`、绝对路径、
控制字符全部落在目标目录里。条目解不开（加密、冷门压缩方法）只记 `skipped`，
不会因为一条坏条目丢掉另外三十九卷。

上传进的每一个字节都复制进了 `DATA_DIR`，请求结束（成功或失败）即删——
一个上传不进去第二次的书库比没有这个功能更糟。

挂载只读 → 在写入任何东西之前就 `403 READ_ONLY_MOUNT`。
`GET /library/upload` 返回 `{ "writable": true }`，让客户端在开始传 400MB 之前先问一句。

### `POST /library/browse/metadata`

```json
{ "paths": ["科幻/合集", "科幻/合集/第三卷.epub"],
  "fields": { "author": "某某", "series": "合集", "tags": "科幻,合集" } }
```

→ `{ "applied": 3, "books": ["…"], "failed": [ { "path": "空目录", "reason": "NOT_A_BOOK" } ] }`

一次改一批。手动覆盖层是按**书**存的，而书库是按批整理的：四十个「佚名」要的是
一次填同一个作者，不是四十个对话框。

`paths` 里给目录就等于给目录里扫描出来的每一本书：系列文件夹本身没有 `book_files` 行，
问它自己会什么都找不到。`fields` 与单本 `/books/:id/metadata` 同一份白名单——
批量不是写那些接口从不暴露的列的许可证。

不是书的路径记进 `failed` 而不是整批失败：选目录时捎上一个 `.nfo` 很常见，
界面因此可以说「已更新 12 本，跳过 2 项」。

### `POST /library/browse/shelf`

```json
{ "paths": ["旧扫描"], "action": "remove" }
```

```json
{ "bookIds": ["b_9f2…"], "action": "remove" }
```

→ 同 `metadata` 的结构。`action` 取 `add` / `remove` / `hide` / `unhide`，
其中 `add` 与 `unhide` 是同一个写、`remove` 与 `hide` 是同一个写
（两套名字来自早期想区分「加进书架」和「别再隐藏」的打算；只有一个标志位，
所以只有一对操作。名字保留是因为删掉一个已文档化的取值是破坏性变更）。

**目标两种命名，只收一种**：`paths`（文件管理器手里是路径）或 `bookIds`（一张卡片手里是
书）。两个都给、或都不给，都是 400 `AMBIGUOUS_TARGETS`——两份命名说的是同一个写，
同时带上就是「调用方自己不知道该说哪一个」，合并还会让同一本书被写两次、被数两次。

**`bookIds` 是「从书架移除时，找不到「xxx」在磁盘上的路径」的修法**（#40）。
被拿掉过的那本书叫「半小时漫画宇宙大爆炸（半小时读完138亿年宇宙史，一口气搞懂大爆炸、
奇点、黑洞、引力波、暗物质……混子哥陈磊新作！）」，而磁盘上的文件不叫这个——扫描器是从
文件里读出书名的。客户端当时是这么补上路径的：列出**书库根目录的第一页**，拿书名和文件名
对（去掉扩展名）。这个猜测有两处必然失手：**书名不等于文件名**（常态，不是例外），
以及**列表是分页的**（根目录第一页之外的书、任何子目录里的书，都不在那次查找里）。
两处都失手时读者被告知找不到这本书——在他要求把它从**自己的书架**上拿掉之后。

映射其实**已经在服务端**了（`book_files.book_id` → `rel_path`），客户端一直在猜一件
服务端已经知道的事。id 形式按 id 解析：书名和文件位置都不参与。

一个 id 指向的书**没有活下来的文件**（`book_files` 里没有 `missing = 0` 的行）
记进 `failed` 而不是猜一个路径——书的可见性判据本来就要求「存在一个未丢失的文件」，
给一本读者打不开的书写书架状态只是在那个判据之外留下一行。

**磁盘上什么都不会变**，这正是重点：「把这四十份扫描从书架上拿掉」和
「把这四十份扫描移进某个目录」在一行行列表里只差一个词，后果却完全不同，
所以是两个端点。`remove` 写的是 `hidden = 1` 而不是删行——书还在书库里、还在索引里，
读者放得回去；删行在书架上长得一样，却不可逆。

**`add` 必须清掉 `hidden`，不能只是「不存在才插入」。** 这是 #40 报的
「书库的书不再自动加入书架，需要手动加入」的服务端一半：被拿掉过的书**已经有**一行
`user_books`（就是 `remove` 为了可逆写下的那一行，`hidden = 1`），所以
`INSERT OR IGNORE` 会跳过它，书继续不在书架上——读者选中它、点「加入书架」、
然后什么都没发生。可逆性只存在于表结构里而不存在于端点里，就不是可逆性。
`add` 用 upsert：不存在则插入，存在则清标志（并在确实重新加入时刷新 `added_at`，
所以「最近入库」对一本没离开过的书仍然指它第一次入库的时间）。

**两个方向是同一对操作，所以「在不在书架上」只有一个定义。**
`GET /books` 的判据是「`user_books` 行存在且 `hidden = 0`」**且**「存在一个未丢失的文件」，
本端点写的就是这两件事里的第一件，`/library/browse` 的 `shelfState` 读的是**两件**。
一行 `hidden = 0` 但文件掉了的书因此**不在书架上**，而不是「在书架上但你打不开」——
把两种状态分开描述，会同时让书架和书库各自说一半真话。

`applied` 是这一批真正改动的行数，`failed` 是没能动的那几项——**用调用方自己那份
命名**（`paths` 进来的就是路径，`bookIds` 进来的就是 id），理由是调用方要能把它对回
自己手里那个东西。`reason` 有三种：`NOT_A_BOOK`（这个路径不是一本书，可能是目录或
`.nfo`）、`NO_LIVE_FILE`（这个 id 的书没有活文件）、`NO_PATHS` / `NO_BOOK_IDS`
是整批被拒而不是单条失败。
客户端把它当作**句子**的依据：「加入书架 0 本」紧挨着一个看起来能按的按钮，
就是「这个按钮坏了」的来源，所以不是书的那几项要单独报出来。

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

继续阅读列表，按最近阅读时间倒序。每一项是**一整本书**（与 `GET /books` 同样的字段）
加上 `percentage`、`chapterTitle` 和 `lastReadAt`。

**它是 `Book` 的扩展，不是另一套形状。** 这里曾经返回进度行自己的命名——
`bookId` / `updatedAt`——而客户端的 `ContinueReadingItem extends Book` 读的是
`id`，卡片上的 `title` 和 `coverUrl` 恰好两种拼法同名，所以卡片画得好好的，
点下去却把 `{ id: undefined }` 交给路由，也就是 `#/book/undefined`：404，
然后被报成「这本书不在书架上了」。两个手写类型的字段名漂移，中间没有任何一个
请求里出现过正确的那个名字。现在 `id` / `addedAt` / `manualFields` 都是必需字段，
服务端再退回窄形状会直接编译不过，而不是把失败推迟到一次点击。

选书这一列走的是 `ShelfService`，不是另写一条 `SELECT`：同一个 join、同一层手动覆盖、
同一个 `addedAt`。旧查询直接 join `books`，于是读者在书库管理页改过的书名，
书架上是新的、卡片上是旧的——同一屏上同一本书有两个名字。

**它只列出书架也会列出的书。** 可见性判据与 `GET /books` 一致：`hidden = 0`
**且具有可用的本地文件、下载文件或当前用户的章节出版物**。对本地文件书，少了可用文件判断，一份被删掉、或唯一副本在没插上的移动硬盘上的书
仍然出现在这一行里，而点开会得到 404 —— 客户端把它说成「这本书不在书架上了」。
那句话是真的，错的是那张卡片，而它正画在同一屏的「共 N 本」下面。
两个接口必须选同一个集合，修法是把判据做成同一句话，而不是教客户端先自己查一遍：
先查一遍只会把「读者点不开的书」修成「读者看不见的书」。

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

## 来源与插件

来源接口把本地书、OPDS 和外部章节插件统一成同一组发现与获取操作。来源实例由管理员创建；来源配置在实例级共享，登录凭据通过用户级凭据接口保存。插件运行在独立的受信任 Node 进程中，安装前必须确认它拥有服务端操作系统权限。

### `GET /sources/types`

返回当前已注册的内置和外部来源类型：

```json
{
  "types": [
    { "id": "local", "pluginId": "reader.local", "builtin": true, "label": "本地书库", "version": "1.0.0", "capabilities": ["browse", "search", "detail"] },
    { "id": "opds", "pluginId": "reader.opds", "builtin": true, "label": "OPDS", "version": "1.0.0", "capabilities": ["browse", "search", "detail", "acquire.file"] }
  ]
}
```

### `GET /sources`

登录用户可以看到来源实例，响应为 `{ "sources": [...] }`；每项有 `id/pluginId/sourceType/name/enabled/descriptor`，只有管理员返回 `config`。服务端启动时自动创建 `local` 实例。

### `POST /sources` — 管理员

创建来源：

```http
POST /api/v1/sources
Authorization: Bearer <admin-token>
Content-Type: application/json

{"pluginId":"reader.opds","sourceType":"opds","name":"家庭 OPDS","config":{"url":"https://books.example.test/opds","username":"reader"}}
```

返回 `201 { "source": {...} }`。可指定 `id`（2～80 位字母、数字、下划线或短横线），省略则自动生成。`sourceType` 和 `pluginId` 从 `/sources/types` 读取。`local` 仅接受空配置，使用宿主 `BOOKS_DIR`。

`config` 不能包含密码。OPDS 的 `url` 必须是 HTTP(S) 地址；Feed 和下载链接默认限制在该 origin。跨 origin 获取文件须配置 `allowedOrigins`；Basic 凭据不转发到附加 origin。管理员可 `PATCH /sources/:id` 更新 `name/config/enabled`，配置仍由提供者校验，修改 config 会清除该来源所有用户的凭据，防止向新地址发送旧凭据；来源有在途调用时修改 config 返回 `409 SOURCE_BUSY`。`DELETE /sources/:id` 只允许删除没有已获取内容的非内置来源，否则返回 `409 SOURCE_IN_USE`。Web 的 `#/sources` 提供对应表单。

### 来源浏览、搜索和详情

```text
GET /api/v1/sources/:id/browse?ref=<optional>&cursor=<optional>&limit=<1..200>
GET /api/v1/sources/:id/search?q=<query>&cursor=<optional>&limit=<1..200>
GET /api/v1/sources/:id/entries?ref=<entry-ref>
```

目录响应形如 `{ "items": [...], "navigation": [...], "nextCursor": "...", "title": "..." }`；可选字段可省略。`ref` 和 `cursor` 是来源拥有的不透明值，客户端只保存并原样回传。条目返回 `ref`、标题、作者、封面和 `options`；不要从 `ref` 推断 URL 或拼接下一页地址。引用和查询参数必须为非空字符串且不超过 16,384 字符；路径中的 `publicationRef` 需要 URL 编码，路由允许最大 16,384 字符的参数。

### 凭据与来源启停

```http
PUT /api/v1/sources/:id/credentials/password
Authorization: Bearer <user-token>
Content-Type: application/json

{"value":"用户自己的 OPDS 密码"}
```

返回 `{ "ok": true }`。`value` 必须为字符串，允许空密码，最大 16,384 字符。密码按 `(sourceId, userId, key)` 隔离并以 AES-256-GCM 加密保存，普通来源列表不会回显。管理员可用 `PATCH /api/v1/sources/:id` 携带 `{ "enabled": false }` 暂停来源；已获取到 `DATA_DIR/acquired` 的书不会被删除。

### 获取内容、目录和章节资源

```http
POST /api/v1/sources/:id/acquire
Authorization: Bearer <user-token>
Content-Type: application/json

{"entryRef":"<entry-ref>","optionId":"<option-id>"}
```

内置 `local` 直接返回已有书的 `publicationId`。OPDS 文件会同步下载，成功响应为 `{ "kind":"ready", "publicationId":"<book-id>" }`；单文件上限 256 MiB，下载完成后计算真实 SHA-256，写入 `DATA_DIR/acquired`，复用现有格式解析和阅读端点，并将书加入当前用户书架。取消、超限或解析失败不会留下临时文件。

章节插件在 RPC 中返回 `{ "kind":"chapters", "publicationRef":"..." }`。宿主随后获取并持久化目录，建立当前用户专属的 `format=chapters` 出版物并加入书架；HTTP 同样返回 `{ "kind":"ready", "publicationId":"<book-id>" }`。反复获取沿用 book ID，已隐藏的书重新上架；不同用户获取同一条目会得到不同出版物和正文缓存。此后通过 `/books/:id/manifest|items|toc|assets` 阅读，使用 `/books/:id/refresh` 手动更新目录。章节书没有整书文件，调用 `/books/:id/content` 返回 `400 CHAPTER_BOOK`。

来源级开发预览仍保留：

```text
GET /api/v1/sources/:id/publications/:publicationRef/manifest
GET /api/v1/sources/:id/publications/:publicationRef/resource?ref=<resource-ref>
```

上述来源级资源接口只返回 JSON：文本用 `text`，二进制资源用 `base64`。入库阅读接受 UTF-8 `text/plain`、`text/html`、`application/xhtml+xml`；目录最多 10,000 项及 2 MiB，原始正文最多 2 MiB。HTML 插图仅接受 `src="reader-res:<插件资源引用>"`，由同一来源的 `readResource` 返回图片；每章最多 32 个不同图片，单图 2 MiB，清洗与内嵌后的章节总计不超过 8 MiB，整章加载限时 60 秒。所有插件响应仍受单条 RPC 2 MiB 上限约束（含 base64）。

服务端和设备分别缓存已读正文（含已内嵌图片）。Web 按服务器、账号及 resourceRef 隔离；断网或 5xx 时目录可回退本账号缓存，授权失败或资源不存在时不回退。没有整书预下载和缓存总配额。后台目录检查由下面的订阅接口控制。

### 自动追更订阅

`GET /subscriptions` 返回 `{ "subscriptions": [...] }`，只列当前用户书架中的章节书：`bookId/title/enabled/intervalMinutes/nextCheckAt/lastCheckAt/lastSuccessAt/lastError/failures/newChapters`，时间为毫秒，未检查时间为 null。默认关闭、间隔 60 分钟。

`PATCH /books/:id/subscription` 接受 `{ "enabled": true, "intervalMinutes": 60 }` 或 `{ "acknowledge": true }`。间隔为 15～10080 分钟的整数；`acknowledge` 只清除新增章提示。管理员不能操作他人的章节书。

单实例服务每分钟扫描一次，每轮最多顺序处理 20 本；开始时写入 5 分钟执行租约，崩溃重启后到期重试。暂停来源、禁用账号或隐藏书籍时跳过。失败按订阅间隔和指数退避的较大值重试，保留旧目录及上次成功时间；不预下载正文，不发外部通知。状态中的错误是代码，不包含上游消息。浏览器关闭不影响调度；阅读中不会自动替换当前目录，用户刷新或重开时采用新版本。

插件类型可声明 `credentialKeys: [{ "key": "access-token", "label": "访问令牌" }]`；同时声明 `permissions.credentials: true` 后，宿主仅将该类型声明的当前用户键值放进 RPC `context.credentials`。凭据不出现在来源列表或普通 config 中。`AUTH_REQUIRED` 表示来源凭据问题，客户端不应退出 reader 账号。

### 插件管理（管理员）

插件包需要管理员预先部署。`folder` 接受 `DATA_DIR/plugins/<folder>` 下的单个目录名，或 `npm:包名`（含 `npm:@scope/name`），后者从 `DATA_DIR/plugins/node_modules` 加载。接口不下载 npm 包、不运行安装脚本、不上传或解压包；包名中不接受版本或路径遍历。

```http
POST /api/v1/plugins
Authorization: Bearer <admin-token>
Content-Type: application/json

{"folder":"demo-chapters","trusted":true}
```

启停和卸载：

```text
GET    /api/v1/plugins
PATCH  /api/v1/plugins/:id       body: {"enabled":true|false}
DELETE /api/v1/plugins/:id       保留来源实例、已获取书和数据
```

安装返回 `201 { "plugin": {...} }`，列表返回 `{ "plugins": [...] }`，启停返回 `{ "plugin": {...} }`，卸载返回 `{ "ok": true }`。插件状态包含 `pluginId/builtin/enabled/sourceTypes/runtime`，外部插件还带 `folder/name/version`，加载失败时有 `error`。卸载会移除注册和安装记录，保留包文件、来源实例、凭据和书籍数据。

禁用或插件进程故障不会删除已下载文件、章节目录及已缓存正文。当前没有包上传、在线升级或回滚接口；内置 `reader.local` 和 `reader.opds` 不可卸载、禁用或替换。已安装插件失败后可用 `PATCH ... {"enabled":true}` 重新加载。

### 可运行示例：demo-chapters

仓库中的 [`examples/plugins/demo-chapters`](../examples/plugins/demo-chapters) 是一个不联网的静态章节插件。按以下步骤验证完整调用链（服务端已启动且已有管理员令牌）：

```powershell
# 在仓库根目录执行；改为服务端实际使用的 DATA_DIR 和管理员令牌。
$readerDataDir = 'D:\reader-data'
$readerApi = 'http://localhost:8080/api/v1'
$readerHeaders = @{ Authorization = 'Bearer <admin-token>' }
New-Item -ItemType Directory -Force (Join-Path $readerDataDir 'plugins')
Copy-Item -Recurse examples/plugins/demo-chapters (Join-Path $readerDataDir 'plugins/demo-chapters')

Invoke-RestMethod -Method Post -Uri "$readerApi/plugins" -Headers $readerHeaders `
  -ContentType 'application/json' -Body '{"folder":"demo-chapters","trusted":true}'
$createdSource = Invoke-RestMethod -Method Post -Uri "$readerApi/sources" -Headers $readerHeaders `
  -ContentType 'application/json' -Body '{"pluginId":"reader.source.demo","sourceType":"demo-chapters","name":"Demo chapters","config":{}}'
$readerSourceId = $createdSource.source.id

Invoke-RestMethod -Uri "$readerApi/sources/$readerSourceId/browse" -Headers $readerHeaders
Invoke-RestMethod -Uri "$readerApi/sources/$readerSourceId/entries?ref=demo-book" -Headers $readerHeaders
$acquiredBook = Invoke-RestMethod -Method Post -Uri "$readerApi/sources/$readerSourceId/acquire" -Headers $readerHeaders `
  -ContentType 'application/json' -Body '{"entryRef":"demo-book"}'
$readerBookId = $acquiredBook.publicationId
$readerManifest = Invoke-RestMethod -Uri "$readerApi/books/$readerBookId/manifest" -Headers $readerHeaders
$readerResourceRef = [Uri]::EscapeDataString($readerManifest.items[0].resourceRef)
Invoke-RestMethod -Uri "$readerApi/books/$readerBookId/assets?ref=$readerResourceRef" -Headers $readerHeaders
Invoke-RestMethod -Method Post -Uri "$readerApi/books/$readerBookId/refresh" -Headers $readerHeaders
```

资源正文应包含“这是通过独立 Node 进程提供的示例章节”，书籍同时出现在当前用户书架。普通成员也可使用自己的令牌获取、阅读及手动刷新；只有安装插件、创建和启停来源需要管理员。

宿主来源调用预算为 60 秒，同一来源实例最多 2 个并发调用，宿主总计最多 8 个，超限立即返回 `429 RATE_LIMITED`。插件每次 RPC 预算 30 秒、单条 JSON 消息上限 2 MiB（包含 base64 开销）；超时、取消或协议错误会终止整个插件进程及其在途请求。外部进程暂不支持 `acquire.file`，大文件获取由内置 OPDS 提供。

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

第一版只有 `none`。此处是元数据补全 provider，与 `/sources` 内容来源独立；安装书源插件不会改变该列表。

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
| `READ_ONLY_MOUNT` | 403 | 书库是只读挂载，无法改名 / 移动 / 删除 |
| `DIR_NOT_FOUND` | 404 | 目录不存在 |
| `NOT_A_DIRECTORY` | 400 | 目标不是目录 |
| `PATH_NOT_FOUND` | 404 | 路径不存在 |
| `DESTINATION_EXISTS` | 409 | 目标位置已有同名条目 |
| `MOVE_INTO_SELF` | 400 | 不能把目录移动到它自己里面 |
| `BAD_NAME` | 400 | 名称含斜杠或非法 |
| `NAME_REQUIRED` | 400 | 名称为空 |
| `NO_PATHS` | 400 | 没有给出路径 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `NO_COVER` | 404 | 这本书没有封面 |
| `FILE_MISSING` | 404 | 文件已从磁盘消失 |
| `USERNAME_TAKEN` | 409 | 用户名已占用 |
| `PASSWORD_TOO_SHORT` | 409 | 口令少于 8 位 |
| `TTS_DISABLED` | 400 | 该实例没有配置 `TTS_URL`，无法使用 HTTP 朗读 |
| `TTS_UPSTREAM` | 400 | 上游合成服务不可达、超时、报错，或返回的不是音频 |
| `TEXT_TOO_LONG` | 400 | 单条语句超过 800 字，请客户端先切句 |
| `INVALID_SOURCE_CONFIG` | 400 | 来源配置不符合内置来源要求 |
| `SOURCE_UNSUPPORTED` | 400 | 来源未声明或未实现请求能力 |
| `SOURCE_DISABLED` | 400 | 来源实例已停用 |
| `SOURCE_NOT_FOUND` | 404 | 来源实例不存在 |
| `SOURCE_TYPE_NOT_FOUND` | 404 | 来源类型未安装 |
| `ENTRY_NOT_FOUND` | 404 | 来源条目不存在 |
| `AUTH_REQUIRED` | 401 | 来源需要凭据或凭据无法解密 |
| `OPDS_UNSAFE_URL` | 400 | OPDS 链接跳转到未允许的 origin 或包含 URL 凭据 |
| `RESOURCE_TOO_LARGE` | 413 | OPDS Feed 或资源超过大小限制 |
| `ACQUISITION_TOO_LARGE` | 413 | 获取文件超过 256 MiB 上限 |
| `CHAPTER_BOOK` | 400 | 章节出版物没有整书文件，请按 manifest 读取章节 |
| `CHAPTER_SNAPSHOT_EXPIRED` | 409 | 旧目录的请求章节未缓存，无法再取得该版本 |
| `CHAPTER_TOO_LARGE` | 413 | 章节正文或声明大小超过 2 MiB |
| `MANIFEST_TOO_LARGE` | 413 | 章节目录超过 10,000 项或 2 MiB |
| `INVALID_MANIFEST` | 400 | 章节目录版本字段不合法 |
| `INVALID_RESOURCE` | 400 | 获取内容为空、媒体类型不匹配或解析失败 |
| `PLUGIN_TRUST_REQUIRED` | 400 | 安装受信任进程插件时未显式确认权限 |
| `PLUGIN_UNAVAILABLE` | 404 / 503 | 来源插件未注册，或进程不可用 |
| `RATE_LIMITED` | 429 | 上游限流或宿主来源并发达到上限 |
| `PLUGIN_TIMEOUT` | 504 | 插件单次 RPC 超过 30 秒 |
| `PLUGIN_PROTOCOL_ERROR` | 502 | 插件返回了不符合协议的 JSON |
| `PLUGIN_INCOMPATIBLE` | 400 | 安装包的 API 版本或运行时不受支持 |
| `PLUGIN_PACKAGE_NOT_FOUND` | 404 | 插件目录、清单或入口文件不存在 |
| `PLUGIN_INVALID_MANIFEST` | 400 | 插件清单 JSON 或字段不合法 |
| `PLUGIN_PATH_ESCAPE` | 400 | 插件目录不在 `DATA_DIR/plugins` 内 |
| `PLUGIN_ALREADY_INSTALLED` | 409 | 插件 ID 或目录已安装 |
| `BUILTIN_PLUGIN_IMMUTABLE` | 400 | 内置来源不能停用、卸载或替换 |
| `SOURCE_TIMEOUT` | 504 | 宿主来源调用超过 60 秒 |
| `SOURCE_CANCELLED` | 499 | 客户端断开或主动取消来源调用 |
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
5. **403 不等于会话失效**。服务端用 403 表达两类事：「你的账号/令牌不行了」
   （`ACCOUNT_DISABLED`、`TOKEN_INVALID`），和「这个操作被拒绝」
   （`ADMIN_REQUIRED`、`PATH_TRAVERSAL`、`READ_ONLY_MOUNT`）。
   只有前者该清掉凭据跳登录页；把后者也当会话失效，会把读者在读只读挂载上
   改个文件名时踢下线，顺手把他存的令牌也删了。按 `error.code` 判断，不要只看状态码。


### 插件扩展与换源

- 管理员 `GET /api/v1/plugins/:id/pages/:pageId`：已声明配置页，返回通用 title/description/forms/sections。
- 管理员 `POST /api/v1/plugins/:id/pages/:pageId`：`{action,values}`，返回更新后的页面。插件清单的 extensions.pages 提供入口。
- `GET /api/v1/sources/:id/search-filters`：插件声明的选择字段；搜索接口接受 JSON 编码的 `filters` 查询参数，值为字符串映射。
- `GET /api/v1/books/:id/source-options`：`{canSwitch}`，限本人有权限的书籍。
- `GET /api/v1/books/:id/alternatives?cursor=…`：候选 CatalogPage。
- `POST /api/v1/books/:id/switch-preview`：`{entryRef}` → `{chapters:[{id,title}]}`。
- `POST /api/v1/books/:id/switch-source`：`{entryRef,chapterId,revision}` → `{content,href}`；所选正文验证成功后事务切换，保留 bookId。目录变更返回冲突，客户端刷新再选择。

后台任务 RPC、持久化及限制见[插件扩展设计](plugin-extensions.md)。页面只接受声明式数据，不执行插件提供的浏览器脚本。
