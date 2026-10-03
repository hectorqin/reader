# 前端 React 架构重构方案

## 目标

将 `web` 从 Preact + 自研 Screen/Router 的混合实现迁移为完整的 React 19 应用。路由、页面生命周期、服务端状态、客户端共享状态和基础交互组件分别由成熟方案负责，业务页面按领域拆分。

第一阶段优先迁移影音模块；第二阶段迁移登录、书架、书库、书源、设置等非阅读页面；最后只保留阅读内容引擎的命令式 DOM 实现，并由 React 页面托管其生命周期。

## 已确定的技术选择

| 能力 | 方案 | 责任 |
| --- | --- | --- |
| UI 运行时 | React 19 + React DOM | 所有页面和组件的唯一 UI 运行时 |
| 路由 | React Router 7 `createHashRouter` | Hash URL、嵌套路由、Layout、Outlet、错误边界和权限守卫 |
| 服务端状态 | `@tanstack/react-query` | 查询缓存、去重、mutation、失效和预取 |
| 客户端共享状态 | Zustand | 认证、设置、同步、播放等跨页面状态 |
| 基础组件 | Mantine | 对话框、表单、菜单、选择器、通知、加载和管理界面 |
| 图标 | `lucide-react` | React 图标组件 |
| 构建 | Vite + TypeScript | 保持 `base: './'` 和 Android 单 Bundle 约束 |

Hash 路由继续使用，因为同一份构建产物由 H5 服务和 Android WebView 消费，Android 资源地址不支持任意路径 fallback。旧路由兼容不是目标；新路由以 React Router 的标准嵌套路由为准。

## 目录约定

```text
web/src/
  app/
    App.tsx
    providers/
    router/
    layouts/
  features/
    auth/
    shelf/
    library/
    sources/
    media/
      pages/
      components/
      api/
      queries/
      mutations/
      stores/
      services/
      styles/
    reader/
      pages/
      components/
      services/
  shared/
    api/
    query/
    stores/
    ui/
    hooks/
    platform/
    types/
```

页面组件只处理页面展示和交互。API 调用通过领域 query/mutation hooks；跨页面状态通过领域 store；页面临时状态留在组件内部。路由页面不得通过布尔字段判断其它页面。

影音领域的 React 组件、API 类型、跨页面服务和样式统一放在 `features/media` 下；旧的 `src/media` 目录已删除，测试与 Android 诊断也直接引用新目录，没有旧媒体路径转导层。领域内同目录组件使用 `./` 导入，跨职责目录使用 `../api`、`../services`、`../styles` 等明确路径；样式唯一存放在 `styles`，避免组件目录与样式目录维护重复副本。路由入口集中在 `app/router/routes.tsx`。

阅读器的命令式引擎和 Android 宿主仍保留在 `ui`/`core` 边界，由 `features/reader/pages/ReaderPage` 明确托管生命周期。`app.ts` 的诊断兼容接口只提供平台、flush 等宿主能力，不参与生产页面调度。

## 生命周期边界

播放器是应用级服务。`PlaybackService` 管理 audio/video/native bridge、播放队列和进度保存，`playback.store` 暴露可观察状态。离开播放页面只卸载控制界面，不销毁播放会话。

阅读器内容仍由 `ReaderEngine`、分页器、Shadow DOM、朗读和 Android fixed-page host 负责。`ReaderPage` 使用 React effect 创建、更新和销毁引擎；React 不介入书籍内容的布局量测。

## 影音路由边界

`MediaLayout` 只提供公共导航、频道上下文和 `<Outlet />`。每个可刷新、可返回的页面有独立组件，包括频道首页、分类、搜索、收藏、历史、队列、详情、元数据、匹配、章节、播放器、歌词、设置、媒体库管理、权限、任务、文件夹和文件。

## 迁移顺序

1. React 运行时、Vite 插件、React Router、React Query、Zustand、Mantine 和应用 Provider。
2. React 根应用、Hash Router、错误边界和权限边界。
3. 影音 Layout、路由树、Query/Mutation 层和目录页面。
4. 详情、元数据、章节、媒体库管理、设置和任务页面。
5. PlaybackService、播放器页和 MiniPlayer。
6. 删除 `MediaScreen`、旧媒体路由分支、旧 `media` 目录和媒体侧 `mountUI` 使用。
7. 迁移其它非阅读页面。
8. React 化阅读器外围页面，保留 ReaderEngine。
9. 删除 Preact、`lucide-preact`、旧 `mountUI` 和旧 Screen 调度链。

## 验收标准

- 所有页面由 React Router 管理，`App` 不再手写页面 switch。
- `MediaScreen` 删除，旧 `src/media` 目录删除，媒体页面按 route/page/query/mutation 拆分。
- React Query 统一管理服务端状态，Zustand 管理客户端共享状态。
- 播放器跨路由持续播放，阅读引擎拥有明确的 React 托管生命周期。
- Mantine 负责基础交互组件；品牌样式只做必要覆盖，不强行改写组件内部实现。
- 保持 Android WebView 单 Bundle、相对资源和 PWA 能力。
- 现有媒体、认证、同步、播放器、阅读器关键回归测试通过。
- 新增页面不需要修改一个巨型 Screen 文件。

## 当前实施状态

已完成第一轮可运行切换：

- `main.tsx` 使用 `createRoot`、`AppProviders` 和 `RouterProvider`，应用启动不再经过旧 `App.start()`。
- 路由已改为 `createHashRouter`，影音的频道、分类、搜索、收藏、历史、队列、详情和设置入口拥有独立 React 路由。
- 媒体列表和详情页面通过 React Query 查询层访问 `MediaApi`，基础交互使用 Mantine。
- 书架、书库、书源和设置已建立独立 React 页面与路由，旧 Screen 不再参与新的入口调度。
- `MediaPlayer` 已由 `PlaybackService` 管理并在 Provider 中启动，跨路由播放状态通过 Zustand 暴露，播放器 DOM 不随页面路由销毁。
- 已用浏览器验证开发服务器能够启动并显示 React 登录页面；`npm run typecheck` 与 `npm run build` 通过。

当前迁移已完成生产入口切换和影音目录收敛。影音管理、播放器控制、登录、书架、书库、书源、设置和阅读路由均由 React Router 管理；旧 `MediaScreen`、旧媒体路由、旧 `mountUI`、Preact 适配层、旧 Screen 页面和 `src/media` 目录已删除。阅读内容引擎仍作为 `ReaderPage` 的命令式服务边界存在，并由 React effect 负责创建、刷新和销毁。

最终验证结果：

- `npm run typecheck` 通过。
- `npm run build` 通过；Vite 完成 2634 个模块构建，产物仍为 Android WebView 可加载的相对资源单 Bundle。仅保留大 chunk 的性能提示，未阻断构建。
- `npm test` 通过：95 个 Vitest 测试文件、803 个测试全部通过；Node 测试 29 项全部通过。
- `git diff --check` 通过；输出的换行符提示属于工作区 CRLF 转换提示，不是 whitespace error。

至此生产入口已经完成 React 化。后续新增页面应继续按 `app / features / shared` 边界实现，由 React Router 接入路由，不再向旧 Screen 调度链添加逻辑。

