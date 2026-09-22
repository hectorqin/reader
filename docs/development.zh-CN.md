# 开发指南

[项目首页](../README.md) · [文档中心](README.md) · [English](development.en.md)

## 环境

- 推荐 Node.js 24，与当前容器和 CI 保持一致；服务端使用内置 `node:sqlite`。
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

在仓库根目录开两个终端。使用测试书库，不要把数据目录放进书库里。

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

访问 `http://localhost:5174`。Vite 默认把 `/api` 代理到 `http://127.0.0.1:8080`；通过 `READER_SERVER` 环境变量可调整代理目标。

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

Web 测试同时包含 Vitest 和 Node 测试。UI 评审使用真实 Chromium；浏览器缺失时按上面的步骤准备环境。不要把历史测试数量当作当前验证结果。

UI 改动可运行 `npm run ui:review --prefix web`，书源流程可运行 `npm run ui:sources --prefix web`。评审工具及环境说明见 [UI 评审](ui-review/README.md)，会生成截图和报告；截图目录默认不纳入 Git。

## 构建与运行

### 单容器镜像

```sh
docker build -f server/Dockerfile -t reader:local .
```

构建上下文必须是仓库根目录，镜像会同时构建 Web 和服务端。部署时将 Compose 的镜像名改为 `reader:local`，或使用文件内的 `build` 配置。

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

Windows 原生终端使用 `gradlew.bat`。产物为 `android/app/build/outputs/apk/debug/app-debug.apk`。可通过 `-PdefaultServerUrl=http://nas.local:8080` 预设地址；未预设时由用户填写服务地址并登录。编译 APK 不等于完成真机阅读验证。

## 代码导览

| 目录 | 责任 |
| --- | --- |
| `server/src/config`、`db` | 运行时配置、SQLite schema 和访问层 |
| `server/src/indexer` | 文件格式、扫描、身份与元数据 |
| `server/src/services`、`http` | 业务服务、API、鉴权和资源交付 |
| `server/src/sources` | 内置来源和通用插件契约 |
| `web/src/formats` | EPUB、TXT、漫画等格式处理 |
| `web/src/ui`、`styles` | Preact 界面、阅读舞台和样式 |
| `web/src/core`、`store` | 平台能力、同步、离线存储 |
| `android/app/src/main/java/cool/cnb/reader` | Android Activity、WebView、原生图片和语音桥接 |

界面状态使用 Preact，阅读内容布局与测量由阅读舞台管理；书籍样式通过 Shadow DOM 隔离，图标使用 Lucide SVG。Web 产物由服务端和 Android 共同使用。详细取舍见[架构文档](architecture.md)和[界面规范](ui.md)。

## 贡献流程

1. 描述问题、复现步骤和期望行为；日志、书源及示例请移除凭据。
2. 将修改限制在相关模块，参考已有错误语义和测试方式。
3. 为行为变更补充适当的回归验证；纯文档修改检查链接、命令和示例即可。
4. 提交变更时说明改动、验证方式和已知限制。

API 详见 [API 文档](api.md)，插件开发见[来源架构](source-plugins.md)与[扩展协议](plugin-extensions.md)。
