# reader

**自部署精品书库阅读器。** 把你自己磁盘上的电子书挂载成书库，用移动端以「精品级排版」阅读。

书文件始终留在你自己的磁盘上，不经过任何厂商服务器。开源免费，AGPL-3.0。

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

| 格式 | 扩展名 | 状态 | 客户端怎么读 |
| --- | --- | --- | --- |
| EPUB | `.epub` | 精排支持（内嵌元数据、封面、calibre 系列、dc:identifier） | 按章节流式加载，章节内资源自动重写为可访问地址 |
| 漫画压缩包 | `.cbz` `.zip` | 按页序翻页，磁盘上不解压 | 逐页取图；页序按自然序（`page10` 排在 `page2` 之后） |
| 漫画目录 | 目录 | 一个目录一本书，子目录为卷 | 卷/页两级寻址，`manifest?group=N` 单取一卷 |
| 纯文本 | `.txt` | 自动识别编码并分章 | 按「第X章」跳转，或按字节偏移流式读 |
| 单张图片 | `.jpg` `.png` `.webp` … | 按单页读物 | 直接取图 |
| PDF | `.pdf` | 保底可读，原样下发 | 交给客户端自己的 PDF 渲染 |

**不支持**：`.cbr` / `.rar`。RAR 需要非自由的解压实现或外部二进制，两者都会破坏
「单容器、零原生依赖」这条约束。遇到 `.rar` 会明确提示，而不是解出损坏的页面。

### 书库可以长这样

```
/books
├── 三体 - 刘慈欣.epub            → 书名《三体》 作者「刘慈欣」
├── 长篇小说 - 张三.txt            → 按「第X章」自动分章
├── 海贼王 Vol.1.cbz              → 漫画，按包内页序排列
├── 进击的巨人/                   → 一本漫画，第01卷/第02卷 是它的卷
│   ├── 第01卷/ 001.jpg 002.jpg ...
│   └── 第02卷/ 001.jpg 002.jpg ...
└── 技术手册.pdf                  → 原样下发
```

整理建议：

- **文件名带作者**能显著提升元数据质量，`书名 - 作者.epub` 是最推荐的命名。
- EPUB 内嵌元数据优先级最高，文件名只在字段空缺时兜底。
- 漫画**一个目录一本书**：`进击的巨人/` 是一本书，里面的子目录是卷。
- `.md` 不入库（书库里的 README 太多，会污染列表）。

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

## 从源码开发

```bash
cd server
npm install
npm test            # 27 个测试用例
npm run typecheck
npm run dev         # 开发模式，热重载

# 指向一个测试书库
BOOKS_DIR=/tmp/books DATA_DIR=/tmp/data npm run dev
```

### 项目结构

```
server/src/
  config/      运行时配置（含「DATA_DIR 不得在 BOOKS_DIR 内」的启动断言）
  db/          SQLite schema 与访问层（node:sqlite，无原生依赖）
  indexer/
    identity.ts   书籍主键：dc:identifier + 内容哈希
    filename.ts   文件名解析（保守策略，宁可留空不猜错）
    metadata.ts   EPUB 元数据与封面提取
    scanner.ts    增量扫描、变更检测、清理
    formats/      格式处理器注册表（新增格式只动这里）
      registry.ts       handler 契约 + 扩展名路由
      epub.ts           EPUB：spine、章节资源重写
      pdf.ts            PDF：原样下发
      comic-archive.ts  .cbz / .zip 按页翻
      comic-directory.ts 图片目录按卷组织
      text.ts           TXT：编码探测 + 分章
      image.ts          单张图片
      zip-reader.ts     自研只读 ZIP（只用 node:zlib）
      natural-sort.ts   页序/卷序的自然排序
      image-types.ts    图片扩展名与 content-type 单一来源
  providers/   可插拔刮削 provider 接口
  services/
    users.ts     账号、角色、令牌
    shelf.ts     书架查询、手动覆盖层
    sync.ts      进度/笔记同步与冲突合并
    merge.ts     元数据优先级链
  http/        Fastify 路由
```

### 新增一种格式

写一个 handler 并注册即可，扫描器与 HTTP 层不用改：

```ts
// server/src/indexer/formats/mobi.ts
import { registerFileHandler } from './registry.ts';

export const mobiHandler = registerFileHandler({
  format: 'mobi',
  kind: 'document',
  extensions: ['mobi', 'azw3'],
  label: 'Mobipocket',
  async parse(ctx, buf) { /* 返回 metadata / pageCount / cover */ },
  async manifest(ctx) { /* 返回 groups 与 items */ },
  async asset(ctx, { ref }) { /* 返回 data / contentType */ },
});
```

然后在 `server/src/indexer/formats/index.ts` 里 `import './mobi.ts'`。
扩展名列表、`/capabilities` 声明、扫描时的文件过滤都会自动跟上。

### 技术选型说明

- **Node.js 24 + TypeScript + Fastify**：单容器体积可控（约 150MB），迭代最快，
  `node:sqlite` 与 `scrypt` 都是内置模块，**没有原生编译依赖**——这让镜像构建稳定，
  也兑现了「一条命令跑起来」。
- **不用 better-sqlite3 / argon2 / bcrypt**：它们需要构建时工具链（`make`、`gcc`），
  会把镜像撑大并让安装变脆。
- **SQLite 存 metadata，不存书**：schema 里的 `books` 表可以随时重建，书本身才是真相源。

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
- `GET  /api/v1/books/:id/items` — 可寻址结构（章节/页/卷），`?group=N` 取单卷
- `GET  /api/v1/books/:id/assets?ref=<ref>` — 单个资源（章节文档、页图、字体）
- `GET  /api/v1/library/formats` — 本实例支持的格式清单
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

**做**：目录挂载扫描、元数据刮削、两级权限、同步 API、Docker 单容器、Android 客户端、
EPUB 精排、TXT / 漫画（CBZ、图片目录）支持、PDF 保底、按书离线缓存。

**不做**：在线书城、iOS、桌面端、社交、AI 问答、全格式转换、移动端批注输入、`.cbr`/`.rar`。

### 已知边界

写在明处，避免预期错位：

- **PDF 只做保底可读**：不解析页数、书签，也不重排。页数上报 `null` 而不是猜一个数字 ——
  猜错会让客户端的进度条错乱，比没有更糟。
- **文本不做精品排版**：TXT 按行渲染，不折行重排、不调字号。精品排版是 EPUB 的承诺。
- **不做全格式转换**：不把 epub 转 pdf、不把 txt 转 epub。
- **ZIP 不支持 ZIP64 / 加密 / 分卷**：超限会明确报错，不会静默解出坏数据。
- **漫画目录只认一层嵌套**：再深会把一个杂乱目录变成几千页的巨型漫画。
- **没有内置 HTTPS 与限流**：给反向代理留位置，不重复造轮子。

---

## 许可

AGPL-3.0。选择 AGPL 而非 GPL：自部署产品最怕别人拿去做闭源付费服务，
AGPL 的网络分发条款正好卡住这条路径（Kavita、Audiobookshelf 用的 GPL-3.0 更松一档）。

## 贡献

欢迎提交 Issue 和 PR。请先跑通 `npm test`，并为新行为补测试。
