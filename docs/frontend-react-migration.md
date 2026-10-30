# 前端 React 架构说明

本文保留原“前端 React 迁移”文件名以避免已有链接断开，内容描述当前实现约定。生产 Web 入口已经使用 React 19；后续页面和组件应遵循本文及[架构与数据边界](architecture.md)中的边界，不再向旧的 Screen 调度链添加代码。

## 当前技术栈

| 能力 | 当前实现 | 责任 |
| --- | --- | --- |
| UI 运行时 | React 19 + React DOM | 页面、组件和生命周期 |
| 路由 | React Router 7 `createHashRouter` | Hash URL、嵌套路由、Outlet、参数、错误边界和导航 |
| 服务端状态 | `@tanstack/react-query` | 查询缓存、去重、mutation、失效和预取 |
| 客户端共享状态 | Zustand | 认证、设置、同步和播放状态 |
| 基础组件 | 项目自有组件（`ui/toolkit.tsx`、`ui/sheet.tsx`、`ui/action-menu.tsx`、`ui/dialog.tsx`、`ui/pager.tsx`） | 按钮、表单行、提示、弹层、「⋯」菜单和分页；Mantine 已移除 |
| 全局提示 | `ui/notifications.ts`（Notyf 封装）、`ui/floating-notice.tsx` | 全局消息与单个操作的状态提示 |
| 主题 | `shared/theme/` + `styles/theme-tokens.css` | V3 语义颜色令牌；字号、圆角等按角色命名的令牌 |
| 图标 | `lucide-react` 与项目图标字体（`ui/icon.tsx`） | 图标组件 |
| 构建 | Vite + TypeScript | H5 与 Android WebView 共用：相对资源（`base: './'`）、固定入口 `assets/client.js`、单一样式表，少用的屏幕拆成懒加载块 |

继续使用 Hash 路由是因为同一份产物同时由 H5 服务和 Android WebView 加载；两个宿主都不能为任意路径提供客户端回退。新的链接应使用 `#/...` 形式。

## 启动与运行时

`web/src/main.tsx` 创建 `AppRuntime`，然后调用 `createRoot()` 渲染 `AppProviders` 和 `RouterProvider`。`web/src/app/runtime.ts` 只负责组装共享资源，不选择页面：

- 根据环境选择 Web 或 Android 平台，创建 `ReaderApi`、`MediaApi`、`MediaPlayer`、`PlaybackService`、`SyncEngine`、`OfflineStore`、`SettingsStore` 和 Query Client；
- 恢复本地会话、服务地址、离线作用域和同步状态；
- 暴露 flush、登录状态、阅读器注册和设置更新等宿主能力。

`AppProviders` 只提供 `RuntimeContext` 和 `QueryClientProvider`。Provider 生命周期负责启动/停止播放服务、连接会话与同步监听，并在页面隐藏或离开时刷新进度、离线数据和播放器状态，重新联网时续期会话。全局提示不需要 Provider：`ui/notifications.ts` 按需创建唯一的提示宿主。

## 目录边界

当前 Web 代码按以下实际目录组织：

```text
web/src/
  app/                         # AppShell、AppNav、Provider、运行时和 React Router（含 lazy-pages）
  features/
    account/pages/             # 我的（设置入口）
    auth/pages/                # 登录
    home/pages/                # 首页
    library/pages/             # 书库浏览和文件管理
    media/                     # 影音 API、页面、组件、查询、变更、服务、状态和样式
    reader/pages/              # 阅读路由页面
    search/pages/              # 书籍与影音的全局搜索
    shelf/pages/,queries/      # 书架
    sources/components/,hooks/,pages/  # 书源、插件管理及扩展页面
  shared/query/,stores/,theme/,ui/    # 跨领域查询、状态、主题和交互 hook（如 use-swipe-tabs）
  api/, core/, formats/, net/  # API、平台、格式和网络基础能力
  render/                      # 分页、PDF、文本、朗读等渲染服务
  store/                       # 离线、出版物、设备设置存储
  ui/                          # 阅读器命令式舞台及可复用组件（toolkit、sheet、action-menu 等）
  styles/                      # 应用和阅读器全局样式
```

页面组件只组合页面展示、查询和交互。API 请求通过领域 API、query 或 mutation 访问；跨页面状态放在 Zustand store；播放器、主题和阅读器等长生命周期行为放在 service。旧的 `web/src/media`、旧 Screen 页面、旧手写生产路由和 `mountUI` 已从生产入口移除。`web/src/app.ts` 与 `app/legacy-compat.ts` 仅保留 Android 诊断和旧测试所需的兼容形状，不负责生产页面调度。

## 路由与兼容

路由定义集中在 `web/src/app/router/routes.tsx`，根级 `AppShell` 先经过 `AuthBoundary`，认证后由 `AuthenticatedShell` 渲染页面 Outlet 和唯一的导航 `AppNav`（手机底部标签栏、宽屏侧栏；阅读器和播放器隐藏导航，二级页面在手机上用返回箭头代替标签栏）。`MediaLayout` 现在只是 `/media` 与 `/me` 两组嵌套路由的 Outlet，主题和导航都由 `AuthenticatedShell` 统一负责。

阅读器和管理员屏幕（媒体库管理、扫描与刮削、条目管理子页、书源编辑、凭据、扩展页）通过 `web/src/app/router/lazy-pages.tsx` 拆成懒加载块：每个页面包成带 `Suspense` 的同名组件，路由表照常引用。新增少用的屏幕时加到这里，不要在页面中临时 `import()`。

保留的兼容入口是有意的：

- `/settings` 重定向到 `/shelf`，兼容旧书架设置深链接；用户设置在「我的」（`/me`、`/me/:panel`）；
- 影音设置页已移除：`/media/:channel/settings` 与 `/media/:channel/settings/:panel` 重定向到「我的」，媒体库管理（`.../settings/libraries`）和扫描与刮削（`.../settings/tasks`）保留；
- `/sources/search` 仍打开书源中心；
- `/sources/:sourceId/:pageId` 与新的 `/sources/:sourceId/pages/:pageId` 都可打开扩展页；
- `/media`、`/media/music` 和 `/media/audiobook` 重定向到对应频道默认页，未知路径回到 `/media/video`。

兼容路由只保证旧链接仍能进入正确的 React 页面；新代码应直接使用当前路由树中的命名空间和嵌套路径。

## 阅读器托管边界

`features/reader/pages/ReaderPage.tsx` 是 React 与阅读器命令式实现之间的边界。页面取得书籍后，在 effect 中创建 `ReaderScreen`，把 `screen.element` 放入 route host，并通过 `runtime.registerReader()` 注册进度刷新回调。清理 effect 时先注销回调，再调用 `screen.dispose()` 并清空 host。

`ReaderScreen` 内部仍负责章节加载、Shadow DOM、分页量测、手势、朗读和阅读工具；React 只托管它的创建、更新和销毁，不介入书籍正文的布局量测。ReaderScreen 的 chrome 使用 React 组件，正文舞台保持命令式 DOM，以确保 `getBoundingClientRect()` 和章节分页的节点生命周期稳定。

## 播放器和主题生命周期

播放器是应用级资源。`AppProviders` 把 `runtime.player.element` 挂到 `document.body`，调用 `runtime.playback.start()` 建立 `PlaybackService` 对 `MediaPlayer` 的监听；路由切换只卸载控制界面，不销毁播放会话。`AuthenticatedShell` 根据当前 URL 控制播放器可见性，并处理播放器发出的 `open-controls` 事件，将用户带到带有 `item` 和 `part` 查询参数的播放器路由。Provider 卸载时停止监听并移除播放器节点。

应用主题由 `AuthenticatedShell` 创建 `ThemeController`（`web/src/shared/theme/theme.ts`），作用域来自 `runtime.mediaApi.preferenceScope()`。控制器只在 `<html>` 上写 `data-theme`（warm、blue、green）与 `data-mode`（light、dark），组件只读 `web/src/styles/theme-tokens.css` 的 `--color-*` 令牌（`--reader-*` 和影音别名映射到它们）；响应系统深浅色、同页保存和存储变化，退出登录时清理属性和监听器。阅读器的黑白灰主题只写在阅读器容器上。主题偏好通过 `readThemePreference`、`saveThemePreference`、`resolveAppTheme`（React 中用 `shared/theme/use-theme.ts` 的 `useThemeState`）读写，不直接访问存储。

## 后续改动约定

- 新页面放入对应的 `features/<domain>/pages`，通过 `routes.tsx` 接入；少用的屏幕经 `lazy-pages.tsx` 懒加载；
- 弹层一律用 `ui/sheet.tsx` 的 `Sheet`/`ConfirmSheet`，「⋯」菜单一律用 `ui/action-menu.tsx`，不引入第三方组件库；
- 新的颜色、间距、字号、圆角、时长写成令牌，不写字面量（见 [`ui.md`](ui.md) §2）；
- 领域组件、查询、变更、服务和样式留在各自 feature 内，跨领域依赖经过 `shared` 或 `app` 边界；
- 需要长生命周期的资源必须由 Provider 或明确的 service 管理，并在清理阶段释放；
- 阅读器正文继续通过 `ReaderScreen` 托管，不把命令式舞台改写为普通 React 子树；
- 新链接使用 Hash 路由和当前嵌套路由，不新增旧 Screen 或手写 pathname 分支。
