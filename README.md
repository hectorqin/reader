# reader

**自部署精品书库阅读器。** 把你自己磁盘上的书籍挂载成书库，用 Android 或浏览器以「精品级排版」阅读。

书文件始终留在你自己的磁盘上，不经过任何厂商服务器。开源免费，AGPL-3.0。

三个部分：

| 部分 | 位置 | 说明 |
| --- | --- | --- |
| 服务端 | `server/` | Node.js + TypeScript，单容器，扫描书库并同步进度 |
| 渲染层 | `web/` | TypeScript + Vite，EPUB 精排、TXT、漫画、PDF |
| Android 壳 | `android/` | Kotlin + WebView，复用上面那一份渲染层 |

---

## 一条命令跑起来

```bash
git clone https://cnb.cool/hectorqin/reader.git
cd reader

# 把 /path/to/your/books 换成你自己的书库目录
sed -i 's#/path/to/your/books#/home/me/books#' docker-compose.yml

docker compose up -d
```

打开 `http://<你的主机>:8080`，**第一个注册的账号自动成为管理员**。

这时你已经有一个能用的 H5 阅读器了——服务端镜像里已经带了客户端，不用再起第二个容器。
手机浏览器打开同一个地址即可阅读。要原生 App 见下面的「Android 客户端」。

> 只有第一次注册是开放的。之后新账号由管理员在后台创建（默认关闭公开注册），
> 这样你的实例不会被陌生人占用。想让家人自行注册，在 `docker-compose.yml` 里
> 把 `ALLOW_REGISTRATION` 设为 `"true"`。

### 最小化运行（不用 compose）

```bash
docker run -d --name reader \
  -p 8080:8080 \
  -v /path/to/your/books:/books:ro \
  -v ./data:/data \
  cnb.cool/hectorqin/reader:latest
```

---

## 书库目录：只读，永不写回

```yaml
volumes:
  - /path/to/your/books:/books:ro   # 你的书，只读挂载
  - ./data:/data                    # 服务端写的一切
```

服务端**绝不写入** `/books`。所有写操作——SQLite 数据库、封面缓存、扫描记录——都在 `/data`。
这一条是硬约束，代码里有断言保护：`DATA_DIR` 落在 `BOOKS_DIR` 里面时服务会直接拒绝启动。

你的书籍目录不会被污染：不会多出封面文件、`.calibre` 之类的元数据文件、转换产物。

---

## 支持格式

| 格式 | 状态 | 说明 |
| --- | --- | --- |
| EPUB | 精排 | 保留出版方样式、嵌入字体、脚注跳转、图文混排、竖排、振假名 |
| TXT | 支持 | 自动识别 UTF-8 / GB18030 / Big5 / UTF-16，按章节标题切分 |
| CBZ / ZIP | 支持 | 按页自然排序，逐页铺满屏幕 |
| 图片目录 | 支持 | 一个文件夹里全是图片时，按文件夹当一本书 |
| PDF | 保底可读 | 用浏览器自带阅读器，页数与进度照常上报，服务端不解析内容 |

> TXT 是本地书库里最容易被忽视的一块。相当一部分中文 TXT 没有 BOM、没有编码声明，
> 解码成 UTF-8 会满屏乱码。客户端先严格校验 UTF-8，失败再依次尝试 GB18030 与 Big5，
> 并**在界面上告诉你选了哪个编码**，可手动覆盖。
> 章节同样没有结构，只能从标题推断——推测不出时按长度分段，不会整本卡死。

---

## 书库扫描

- **增量扫描**：先用 `mtime + size` 快速判断，再用内容哈希确认。绝大多数文件在第一阶段就被跳过。
- **目录挂载**：递归扫描挂载目录，自动跳过 `.git`、`@eaDir`、`#recycle` 等目录，不跟随符号链接。
- **自动扫描**：默认每 30 分钟全量、每 60 秒增量轮询。设 `SCAN_INTERVAL=0` / `WATCH_INTERVAL=0` 可关闭。
- **手动触发**：`POST /api/v1/library/scan`（管理员）。

### 书籍主键：为什么不按文件路径

书籍主键是 `sha256(dc:identifier + 文件内容哈希)`，**不是文件路径**。

用路径做主键的话，用户重命名或移动一下文件，阅读进度和笔记就会全部丢失——
这是自建书库产品最常见的差评来源。当前设计下：

- 重命名 / 移动文件 → 主键不变，进度和笔记保留 ✅
- 同一本书的多份副本 → 自动合并成一条书架记录 ✅
- 重新编码过的同名文件 → 视为不同副本，不会被误认 ✅

### 元数据优先级

```
1. 用户手动修改      最高，永不自动覆盖
2. EPUB 内嵌元数据    次高，扫描不会覆盖手动修改
3. 在线刮削 provider  只填补空缺字段，标注来源，可一键撤销
4. 文件名解析        最弱，仅在以上都缺时使用
```

在线刮削是可插拔的 provider 机制。**第一版只做内嵌元数据 + 文件名解析 + 手动补全**，
不接任何在线源——避免引入网络依赖与限流问题，也避开豆瓣的合规风险。
后续接入 Google Books、Open Library 时，实现 `MetadataProvider` 接口注册即可，索引层不用改。

手动修改存在独立的覆盖层，扫描永远碰不到它。撤销单个字段用
`DELETE /api/v1/books/:id/metadata/:field`，会回落到内嵌值。

---

## 多用户

单个部署实例内的多账号，适合家庭或小圈子。两级权限：

- **admin**：创建/停用账号、触发扫描、查看实例信息
- **member**：只能看自己的书架、进度和笔记

每个账号有独立的书架、阅读进度、笔记与高亮。新账号注册后自动看到整个共享书库，
不需要逐本添加。

---

## 客户端三态

服务端是唯一真相源，客户端只做「渲染 + 缓存」。客户端有三种状态：

| 状态 | 行为 |
| --- | --- |
| 局域网直连 | 正常同步 |
| 公网可达 | 正常同步 |
| 完全离线 | 读本地缓存，恢复后合并进度 |

同步的只有轻量数据：书架元数据、阅读进度、笔记、高亮。书文件不走同步。

### 两端的关系

Android 端**不重写渲染**。它是一个 Kotlin 原生外壳，只负责文件缓存、手势、账号与书架，
渲染复用同一份 `web/` 产物。原因很直接：排版策略一旦出现两份实现，就一定会分叉，
而「忠于精排」正是这个产品的差异点。外壳只做 WebView 做不到或做不好的事：

- **连通性**：WebView 里的 `navigator.onLine` 只要有网卡就说「在线」——
  连上一个没有出口的 Wi-Fi 时它会骗人，客户端于是转圈而不是读缓存。
  Android 侧用系统的 `NET_CAPABILITY_VALIDATED` 判断。
- **稳定的设备名**：UA 里的型号会随 Chrome 升级变化，作为「上次在哪个设备读的」标签不可靠。
- **原生提示**：一行 Kotlin 的 Toast，不用在 Web 层造一套通知 UI。

### 离线合并语义

进度和笔记都带 `updatedAt`，冲突按 **last-writer-wins** 解决：

- 离线设备重连后推的旧数据**不会**回滚你在别处读到的新进度
- 笔记删除是**墓碑（tombstone）**而不是硬删除，所以离线设备无法让已删除的笔记复活
- `GET /api/v1/sync?since=<上次的 serverTime>` 只返回增量，重连很便宜

---

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `BOOKS_DIR` | `/books` | 书库目录，只读挂载 |
| `DATA_DIR` | `./data` | 服务端写入目录，**不能**在 `BOOKS_DIR` 内 |
| `PORT` | `8080` | 监听端口 |
| `PUBLIC_URL` | 空 | 对外地址，反代后设置 |
| `SCAN_INTERVAL` | `1800` | 全量扫描间隔（秒），0 关闭 |
| `WATCH_INTERVAL` | `60` | 增量轮询间隔（秒），0 关闭 |
| `ALLOW_REGISTRATION` | `false` | 是否允许公开注册 |
| `ACCESS_TOKEN_TTL` | `86400` | 访问令牌有效期（秒） |
| `REFRESH_TOKEN_TTL` | `31536000` | 刷新令牌有效期（秒） |
| `READER_TOKEN_SECRET` | 自动生成 | 签名密钥。留空则生成并持久化到 `/data` |
| `LOG_LEVEL` | `info` | 日志级别 |

> `READER_TOKEN_SECRET` 留空时会在首次启动生成并存到 `DATA_DIR/token.secret`。
> 只要 `/data` 还在，重启不会踢掉所有客户端。**删掉 `/data` 会清空所有账号和进度。**

---

## 让外网访问（内网穿透 / 域名 / HTTPS）

自部署最大的门槛在这里，所以单独说清楚。三种常见做法：

**1. 只在局域网用**（最简单）
不用做任何事，直接访问 `http://<NAS的局域网IP>:8080`。

**2. 反向代理 + HTTPS**（推荐）
用 Caddy 最省事，自动申请证书：

```caddyfile
reader.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

然后设置 `PUBLIC_URL=https://reader.example.com`，下载链接才会正确。

**3. 内网穿透**（没有公网 IP）
用 frp / Tailscale / Cloudflare Tunnel 任选一个。Tailscale 最简单：
在 NAS 和手机上装 Tailscale，直接用 Tailscale 分配的 IP 访问，不用配证书。

> 服务端设计上不依赖域名和 HTTPS，所以三种方式都能工作。但公网暴露时
> **务必**套一层 HTTPS，否则令牌是明文传输的。

---

## Android 客户端

APK 走 GitHub Releases / 侧载分发，不上商店。开源项目没有收入覆盖 Apple 的
99 美元开发者账号，所以 Android 先做、iOS 等有赞助再说（这条是设计文档 §5 定的）。

### 自己构建

```bash
# 1. 先把 H5 渲染层构建好并放进 assets
sh android/scripts/build-web-assets.sh

# 2. 构建 APK
cd android
./gradlew :app:assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk

# 想预置服务端地址（个人自用构建）：
./gradlew :app:assembleRelease -PdefaultServerUrl=http://nas.local:8080
```

不预置地址是刻意的：没有人知道你会用什么 IP 访问自己的 NAS，
所以首次启动时问一次、之后记住。

### 装好之后

打开 App → 填服务端地址（如 `http://192.168.1.10:8080`）→ 登录。
之后所有书和进度都跟着账号走，与浏览器端互通。

### 为什么允许明文 HTTP

主要部署场景就是局域网 IP，而私有 IP 拿不到证书。要求 HTTPS 等于把用户挡在门外，
这正是设计文档里说的「部署门槛是最大的获客阻力」。
**但对公网暴露时请务必套一层 HTTPS**，否则令牌是明文传输的。

## 从源码开发

```bash
# 服务端
cd server
npm install
npm test            # 27 个测试用例
npm run typecheck
npm run dev         # 开发模式，热重载

# 指向一个测试书库
BOOKS_DIR=/tmp/books DATA_DIR=/tmp/data npm run dev
```

```bash
# 客户端（另开一个终端）
cd web
npm install
npm test            # 147 个测试用例
npm run dev         # http://localhost:5174，自动把 /api 代理到 8080
npm run build       # 产出 web/dist，服务端会在 / 上直接托管
```

### 项目结构

```
server/src/
  config/      运行时配置（含「DATA_DIR 不得在 BOOKS_DIR 内」的启动断言）
  db/          SQLite schema 与访问层（node:sqlite，无原生依赖）
  indexer/
    identity.ts   书籍主键：dc:identifier + 内容哈希
    filename.ts   文件名解析（保守策略，宁可留空不猜错）
    metadata.ts   EPUB/PDF 元数据与封面提取
    scanner.ts    增量扫描、变更检测、清理
  providers/   可插拔刮削 provider 接口
  services/
    users.ts     账号、角色、令牌
    shelf.ts     书架查询、手动覆盖层
    sync.ts      进度/笔记同步与冲突合并
    merge.ts     元数据优先级链
  http/        Fastify 路由（含 CORS 与 H5 静态托管）

web/src/
  api/         服务端契约与请求层（令牌刷新在这里，全局只做一次）
  core/        平台抽象、同步引擎
    platform.ts      两端共同接口：传输、存储、连通性
    sync.ts          待发送队列 + 增量拉取 + 退避重试
    android-platform.ts  Android 侧的实现（很薄）
  store/
    offline.ts   本地镜像与待发送队列
    idb.ts       IndexedDB 包装，不可用时降级到内存
  formats/     格式层：拆包、编码识别、章节切分
    epub.ts      OPF/spine/nav 解析、资源重写
    txt.ts       编码探测 + 章节推断 + 超长分段
    comic.ts     CBZ / 图片目录
    detect.ts    魔数优先的格式识别
  ui/
    reader-view.ts   分页、滚动、手势、定位
    locator.ts       阅读位置格式
    shadow.ts        书的样式与 App 样式隔离
    resources.ts     资源按需解出，不预展开
  styles/reader.css  ← 干预策略都在这里，注释说明每条为什么必要

android/app/src/main/java/cool/cnb/reader/
  MainActivity.kt            单 Activity，只做三件事
  web/WebHost.kt             WebView 配置与资源装载
  bridge/ReaderBridge.kt     暴露给 JS 的原生方法
  bridge/ConnectivityMonitor.kt  真正的连通性判断
```

### 技术选型说明

- **Node.js 24 + TypeScript + Fastify**：单容器体积可控（约 150MB），迭代最快，
  `node:sqlite` 与 `scrypt` 都是内置模块，**没有原生编译依赖**——这让镜像构建稳定，
  也兑现了「一条命令跑起来」。
- **不用 better-sqlite3 / argon2 / bcrypt**：它们需要构建时工具链（`make`、`gcc`），
  会把镜像撑大并让安装变脆。
- **SQLite 存 metadata，不存书**：schema 里的 `books` 表可以随时重建，书本身才是真相源。

### 客户端技术选型说明

- **不用框架**：渲染层是命令式 DOM 操作——分页、注入文档、shadow root、量测列宽。
  引一个虚拟 DOM 只在代码和它要量测的布局之间多加一层，而这一层恰好是这个产品最不该
  透过它去调试的东西。产物是一个 169KB 的单文件 bundle。
- **单文件 bundle、相对路径**：产物要被两个宿主消费——服务端托管给浏览器、Android 打进
  assets。`file://` 或 WebView 里加载同源分片会踩平台特异性，所以 `inlineDynamicImports`
  打成一份，`base: './'`。
- **不注入 reset 样式**：见 `web/src/styles/reader.css` 顶部。整个产品的差异点是「忠于
  出版方的排版」，而一份 reset 正好会抹掉出版方的字体、缩进和行距。
  可调项全部是可继承的自定义属性，默认值是 `inherit`——「关」的意思是「不动它」，
  不是「用我们的默认值」。
- **书的样式装进 shadow root**：书里一条 `p { color: red }` 不能改到书架。
  用 iframe 也能隔离，但每次换章要重建文档，会丢滚动位置、在 Android 上多花几倍内存。
- **书的内容不允许联网**：章节里所有本地引用在加载时被改写成内部 `reader-res:` 协议，
  由渲染层从内存里的资源表解出。绝对 URL 原样保留，然后被 CSP 挡掉——
  一本来路不明的书不能把阅读行为报到远端。

---

## API

所有业务接口在 `/api/v1` 下，用 `Authorization: Bearer <token>` 认证。
响应错误统一为 `{ "error": { "code": "...", "message": "..." } }`。

服务端 API 承诺**长期向后兼容**：自部署用户不会及时升级，破坏性变更只允许
「加新字段 / 加新端点」，不允许改已有字段语义。

<details>
<summary>端点列表</summary>

**公开**
- `GET  /api/v1/health` — 健康检查
- `GET  /api/v1/instance` — 实例信息（是否开放注册、账号数）
- `POST /api/v1/auth/register` — 注册（仅首次或开启 ALLOW_REGISTRATION）
- `POST /api/v1/auth/login` — 登录
- `POST /api/v1/auth/refresh` — 刷新令牌

**需认证**
- `GET  /api/v1/auth/me`
- `POST /api/v1/auth/password`
- `POST /api/v1/auth/logout`
- `GET  /api/v1/books` — 书架列表，支持 `search` `author` `series` `tag` `format` `sort` `page`
- `GET  /api/v1/books/:id`
- `GET  /api/v1/books/:id/manifest` — 渲染器需要的清单
- `GET  /api/v1/books/:id/content` — 书文件流
- `GET  /api/v1/books/:id/cover` — 封面
- `PATCH  /api/v1/books/:id/metadata` — 手动补全元数据
- `DELETE /api/v1/books/:id/metadata/:field` — 撤销单个字段
- `GET  /api/v1/library/facets` — 作者/系列/标签/格式聚合
- `GET  /api/v1/library/continue` — 继续阅读
- `GET  /api/v1/sync?since=<ms>` — 增量拉取
- `POST /api/v1/sync` — 批量合并
- `GET/PUT /api/v1/sync/progress/:bookId`
- `GET  /api/v1/notes` / `POST /api/v1/notes` / `DELETE /api/v1/notes/:id`

**管理员**
- `POST /api/v1/library/scan`
- `GET  /api/v1/library/scan`
- `GET  /api/v1/library/stats`
- `GET/POST/PATCH /api/v1/admin/users`
- `GET  /api/v1/providers`

</details>

---

## 范围边界（第一版）

**做**：目录挂载扫描、元数据刮削、两级权限、同步 API、Docker 单容器、Android 客户端、EPUB 精排、PDF 保底、按书离线缓存。

**不做**：在线书城、iOS、桌面端、社交、AI 问答、全格式转换、移动端批注输入。

---

## 许可

AGPL-3.0。选择 AGPL 而非 GPL：自部署产品最怕别人拿去做闭源付费服务，
AGPL 的网络分发条款正好卡住这条路径（Kavita、Audiobookshelf 用的 GPL-3.0 更松一档）。

## 贡献

欢迎提交 Issue 和 PR。请先跑通 `npm test`，并为新行为补测试。
