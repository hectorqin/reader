# 开发指南

[项目首页](../README.md) · [文档中心](README.md) · [English](development.en.md)

## 环境

- Node.js 22 及以上（`server/package.json` 的 `engines`），推荐 24，与当前容器和 CI 保持一致；服务端使用内置 `node:sqlite`，TypeScript 通过 `tsx` 直接运行。
- npm、Git；服务端和 Web 各有独立 `package.json` 与锁文件，仓库根目录没有统一 npm 脚本。
- UI 评审需要 Chromium。
- 构建 Android 另需 JDK 17+、Android SDK 35、Build Tools 35.0.1；Web 资源构建脚本需要 POSIX shell（Windows 可使用 Git Bash 或 WSL）。

以下命令从仓库根目录执行。

## 安装依赖

```sh
npm ci --prefix server
npm ci --prefix web
```

界面评审使用 Chromium，在 Web 目录安装：

```sh
cd web
npx playwright install chromium
```

Linux CI 可使用 `npx playwright install --with-deps chromium` 安装所需系统库。也可设置 `CHROME_PATH` 指向现有 Chrome/Chromium。

## 启动开发服务

在仓库根目录开两个终端。使用测试书库，不要把数据目录放进书库里（`DATA_DIR` 位于 `BOOKS_DIR` 内时服务端拒绝启动）。

Linux/macOS：

```sh
mkdir -p /tmp/reader-dev-books /tmp/reader-dev-data
BOOKS_DIR=/tmp/reader-dev-books DATA_DIR=/tmp/reader-dev-data npm run dev --prefix server
```

PowerShell：

```powershell
$env:BOOKS_DIR = Join-Path $env:TEMP 'reader-dev-books'
$env:DATA_DIR = Join-Path $env:TEMP 'reader-dev-data'
New-Item -ItemType Directory -Force -Path $env:BOOKS_DIR, $env:DATA_DIR | Out-Null
npm run dev --prefix server
```

第二个终端：

```sh
npm run dev --prefix web
```

访问 `http://localhost:5174`。Vite 默认把 `/api` 代理到 `http://127.0.0.1:5888`；通过 `READER_SERVER` 环境变量可调整代理目标。

## 检查与测试

按修改范围执行，以下是各模块入口：

```sh
npm run typecheck --prefix server
npm test --prefix server
npm run build --prefix server

npm run typecheck --prefix web
npm test --prefix web
npm run build --prefix web
```

不要把历史测试数量当作当前验证结果。

运行单个测试：

```sh
# 服务端（node:test），可加 --test-name-pattern="..." 过滤
cd server && npx tsx --test test/media-api.test.ts

# Web 大多数测试使用 Vitest
cd web && npx vitest run test/foo.test.ts
# 少数为 node:test 编写的文件（api、asset-url、paginator、window、windowed-toc）
cd web && npx tsx --test test/paginator.test.ts
```

Web 有两套测试运行器：`npm test` 先跑 Vitest，再用 `tsx --test` 跑上述 node:test 文件；这些文件在 `web/vite.config.ts` 中被 Vitest 排除。新增 node:test 文件时，要同时加入 `test` 脚本和 Vitest 的 `exclude` 列表。Web 测试会引用服务端代码，运行前两端都需要 `npm ci`。

### UI 评审

UI 评审在真实 Chromium 中通过 CDP 截图并测量；浏览器缺失时按上面的步骤准备环境。评审脚本位于 `web/tools/ui-review/`，截图和报告写入被 Git 忽略的 `artifacts/ui-review/`；不要把一次运行的截图提交到 `docs/`。

| 命令 | 内容 | 输出 |
| --- | --- | --- |
| `npm run ui:review --prefix web` | 先构建，再评审应用各屏 | `artifacts/ui-review/react-app/`，结果在 `verification.json` |
| `npm run ui:review:only --prefix web` | 同上，但复用已有 `web/dist`（CI 使用） | 同上 |
| `npm run ui:review:reader --prefix web` | 阅读器场景；不自动构建，需先 `npm run build` | `artifacts/ui-review/reader/` |
| `npm run ui:sources --prefix web` | 先构建，再走书源流程；需已安装服务端依赖 | `artifacts/ui-review/sources/` |

可用 `UI_REVIEW_DIR` 改变输出目录。布局改动后运行评审并查看截图。评审不模拟安全区，贴边栏位需另用 CDP `Emulation.setSafeAreaInsetsOverride` 检查。

### 图标

图标统一在 `web/src/ui/icon.tsx` 的 `ICONS` 中把名称映射到 Lucide 图标（使用本项目自己的英文名，`test/icons.test.ts` 会拒绝借用其他图标集的名称，也只允许这个文件引入 `lucide-react`）。规则见 `docs/ui.md` §1。

## 持续集成与发布

- GitHub Actions `.github/workflows/ci.yml`：每个 PR 和每个分支的 push 都会运行。服务端与 Web 分别执行 install → typecheck → test → build；另有 UI 评审（复用 Web 产物，截图作为制品保留），以及 Android 的 `check-shell.sh`、Web 资源打包校验和 debug APK。
- `.github/workflows/release.yml`：只在推送 `v*` 标签或手动运行时触发，先跑 CI，再在 amd64 与 arm64 原生 runner 上构建镜像并发布到 Docker Hub `hectorqin/reader-pro`。标签发布 `x.y.z`、`x.y`、`latest` 与 `sha-*`；手动运行发布分支名与 `sha-*`。需要仓库机密 `DOCKER_USERNAME`、`DOCKER_PASSWORD`。`main` 是长期开发分支，push 到 `main` 不会发布。

## 构建与运行

### 单容器镜像

```sh
docker build -f server/Dockerfile -t reader:local .
```

构建上下文必须是仓库根目录，镜像会同时构建 Web 和服务端。可执行 `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build` 使用源码部署；后续管理也保留两个 `-f` 参数。

### 不使用容器

先执行两端的 `npm run build`，再从仓库根目录启动：

```sh
BOOKS_DIR=/tmp/reader-dev-books DATA_DIR=/tmp/reader-dev-data WEB_DIR="$PWD/web/dist" npm start --prefix server
```

PowerShell 中先设置 `$env:BOOKS_DIR`、`$env:DATA_DIR`，并将 `$env:WEB_DIR = (Resolve-Path 'web/dist').Path`，再运行 `npm start --prefix server`。`WEB_DIR` 需要指向产物目录，服务端不会自动猜测另一个项目中的 `web/dist`。

### Android

从仓库根目录构建 Web 资源，再构建 APK：

```sh
sh android/scripts/build-web-assets.sh
cd android
./gradlew :app:assembleDebug
```

Windows 原生终端使用 `gradlew.bat`。产物为 `android/app/build/outputs/apk/debug/app-debug.apk`。可通过 `-PdefaultServerUrl=http://nas.local:5888` 预设地址；未预设时由用户填写服务地址并登录。编译 APK 不等于完成真机阅读验证。

不需要 JDK 的检查：

```sh
sh android/scripts/check-shell.sh        # 包名、导入、JS 桥接契约、渲染模式词表
sh android/scripts/verify-web-assets.sh  # 在 build-web-assets.sh 之后，确认 Web 资源会被打进 APK
```

`check-shell.sh` 只把带 `@JavascriptInterface` 的方法算作桥接方法，并要求每个都在 `web/src/android-bridge.d.ts` 中声明（方法语法，可选方法写作 `name?(): T`）。外壳说明见 [android/README.md](../android/README.md)，契约见 [android/contract.md](../android/contract.md)。

## 代码导览

| 目录 | 责任 |
| --- | --- |
| `server/src/config`、`db`、`lib` | 运行时配置、SQLite schema 和访问层、路径约束（`lib/paths.ts`） |
| `server/src/indexer` | 文件格式、扫描、身份与元数据 |
| `server/src/services`、`http` | 业务服务、API、鉴权和资源交付 |
| `server/src/media` | 影音目录、扫描、资料与播放服务 |
| `web/src/app` | 运行时装配、Provider、哈希路由与懒加载页面（`app/router/lazy-pages.tsx`） |
| `web/src/features` | 按领域划分的页面与组件；`features/media` 为影音页面、服务与播放器 |
| `web/src/shared` | 跨领域的查询、状态、主题与 UI |
| `server/src/sources` | 本地书库、OPDS 与进程型扩展插件 |
| `web/src/formats` | EPUB、TXT、漫画等格式处理 |
| `web/src/ui`、`styles` | 共享交互、命令式阅读舞台和阅读样式 |
| `web/src/core`、`store` | 平台能力、同步、离线存储 |
| `android/app/src/main/java/com/htmake/readerpro` | Android Activity、WebView、原生图片、语音桥接与 Media3 播放 |

应用界面使用 React 19 和 React Router（仅哈希路由），服务端数据使用 React Query，共享客户端状态使用 Zustand；阅读内容布局与测量由命令式阅读舞台管理。基础交互组件为项目自有组件（`web/src/ui/toolkit.tsx`、`sheet.tsx`、`action-menu.tsx` 等，Mantine 已移除），图标使用 Lucide React 和项目自有图标字体，书籍样式通过 Shadow DOM 隔离。Web 产物固定入口为 `assets/client.js`、单一样式表，不常用的页面拆为懒加载分块；同一产物由服务端和 Android 共同使用。详细取舍见[架构文档](architecture.md)和[界面规范](ui.md)。

## 贡献流程

1. 描述问题、复现步骤和期望行为；日志、书源及示例请移除凭据。
2. 将修改限制在相关模块，参考已有错误语义和测试方式。
3. 为行为变更补充适当的回归验证；纯文档修改检查链接、命令和示例即可。
4. 提交变更时说明改动、验证方式和已知限制。

API 详见 [API 文档](api.md)；影音边界见[模块架构](media-implementation.md)，验证入口见[影音验证](media-validation.md)。
