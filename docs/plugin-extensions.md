# 插件页面、多书源搜索与换源

## 目标与职责

| 模块 | 职责 |
| --- | --- |
| PluginManager / ProcessPlugin | 校验扩展声明、管理员页面 RPC、独立数据目录、持久任务时点与退避、进程启停 |
| SourceProvider | 动态搜索选项、透传筛选条件、返回同书候选 |
| ChapterPublications | 校验私有书籍、换源事务、稳定 bookId、目录修订和旧缓存 |
| PluginPageScreen / ReaderScreen | 通用表单列表、搜索选择框、候选目录与明确章节选择 |
| Catalog / Library（npm 包） | 订阅拉取与合并、多规则管理、搜索调度、引用路由、账号引擎隔离 |

## 声明式页面与持久化

manifest 可选声明：

```json
{
  "permissions": { "storage": true },
  "extensions": {
    "pages": [{ "id": "library", "title": "书源订阅与管理" }],
    "tasks": [{ "id": "subscriptions", "intervalMinutes": 1 }]
  }
}
```

第一版页面均为管理员共享配置。独立地址 `#/plugins/<pluginId>/<pageId>`，从插件管理入口打开。GET 调用 `extension.page`；POST 调用 `extension.action`，参数为 `{pageId,userId,action,values}`。返回同一 Page DTO：`title/description/forms/sections`。Form 包含 `id/title/submit/fields/values`，fields 支持 text、textarea、number、boolean、select；values 携带不透明行 ID。一次动作完成后返回新页面，客户端不推断订阅或书源结构。

宿主校验声明、页面结构、选项和输入配额；未声明页面拒绝访问。渲染器只呈现文本，不接受 HTML、JS、iframe 或任意前端代码。授权在 HTTP 层执行，隐藏入口不代替鉴权。普通账号可搜索和管理自己的书籍，但不能修改共享规则。

storage 权限启用后，每个 RPC 获得 `host.dataDir = DATA_DIR/plugin-data/<SHA256(pluginId)>`。数据与 npm 包目录分离，停用、升级、卸载均保留。插件自行管理数据格式及原子写入；书源订阅不进入 reader 专属业务表。

## 后台任务

宿主每分钟检查启用插件的声明任务，调用 `extension.task({taskId})`，单实例串行、同轮合并。下一执行时点和失败次数持久保存在通用 `plugin_storage`；重启后恢复，失败延迟重试。停用或关闭会终止插件，停用期间不执行。此调度器独立于章节追更。

## 通用搜索选项

声明 `search.filters`，实现 `searchFilters(ctx)`，返回带不透明 key/value 的选择字段；`SearchRequest.filters` 为字符串映射，宿主只验证结构与大小。搜索历史与下一页保留筛选条件。

## 通用换源

1. 目录面板根据 `source-options.canSwitch` 显示换源入口，用户搜索候选。
2. 点击候选取得其目录。唯一同名章节可预选，否则必须手动选择；确认后从所选章开头阅读，不推测百分比或沿用旧章内偏移。
3. 请求携带旧 revision。宿主与刷新共用书籍串行队列，版本不符返回冲突。获取新目录、确认章节存在、读取正文并清洗/内嵌图片全部成功后才提交数据库事务。
4. 事务保存新快照和已验证正文、替换 publicationRef、保留 bookId、书架与订阅，清零新增章计数并推进订阅 generation。失败保留原绑定、目录与缓存。
5. 客户端读到落点正文后才替换阅读视图，并保存新进度。旧修订缓存继续可读；旧笔记/书签保留原 href，不自动迁移到相似章节。其它已打开客户端仍需刷新目录，未缓存旧章节返回快照过期。

重新获取现绑定复用当前书籍 ID；重新加入换源前版本创建独立记录，不会误返回换源后的版本。换源限同一来源实例内提供的候选，跨插件/跨实例不是本版功能。如果目标版本已作为另一条书籍记录入库，返回 SOURCE_ALREADY_ACQUIRED，需从书架打开已有版本，以免合并或覆盖另一本书的笔记和进度。

## 升级及验证

## 本次验证（2026-09-21）

服务端全量 285 通过、1 项 Windows 文件权限位测试跳过；Web 531 项 Vitest 与 29 项 Node 测试通过；包 14 项测试通过，含真实 Chromium 规则和独立 tarball 安装。Web 既有图标测试在默认高并发下超时，使用 `npx vitest run --maxWorkers=2 --minWorkers=1` 全量复核通过。服务端类型检查、构建与 Web 生产构建通过。

生产 bundle 的 Chrome 实测覆盖 390px 手机和 1280px 桌面配置页、订阅启停、搜索筛选、失败换源保持原文和成功换源选章，无水平溢出或页面脚本错误。可运行 `node web/tools/ui-review/plugin-extensions.mjs`（仓库根目录，预先构建 Web；可通过 CHROME_PATH 指定浏览器）。截图位于 docs/ui-review/plugin-*.png。

示例公网订阅链接本次检查返回 22 条文本书源，已通过插件真实订阅流程导入，保存了下次检查时间且无订阅错误；没有对 22 个采集站点逐一认证。npm 版本 0.2.0 已打包，未发布公共 registry，未构建 Android APK。
