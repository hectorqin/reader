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

实例扩展在 manifest 的 `sourceTypes[].extensions` 下声明（以下为扩展示意）：

GET 调用 `extension.page`；POST 调用 `extension.action`，参数为 `{sourceType,context:{instance,userId},pageId,action,values}`。宿主根据 sourceId 从数据库解析插件与实例，客户端不能伪造上下文；暂停的来源仍可管理，停用插件则不可访问页面。普通读者无页面读取及写入权限。

返回 Page DTO：`title/description/notice/forms/sections/tabs/activeTab`。每个 Tab 包含 `id/title/description/forms/sections`，页面公共内容和当前 Tab 同时渲染。Form 包含 `id/title/submit/fields/values`，fields 支持 text、textarea、number、boolean、select；values 携带不透明行 ID。section 支持 `emptyText`，item 支持 `collapsible`。一次动作返回新页面；可选 activeTab 请求切换到指定 Tab，否则保留当前选择。纯 Tab 切换保留输入草稿，提交或刷新后以服务端新页面为准。

宿主校验声明、页面结构、选项和输入配额；未声明页面拒绝访问。渲染器只呈现文本，不接受 HTML、JS、iframe 或任意前端代码。授权在 HTTP 层执行，隐藏入口不代替鉴权。

## 后台任务

宿主每分钟检查启用插件及启用来源实例的声明任务。实例任务调用 `extension.task({taskId,sourceType,context:{instance,userId:""}})`，不携带个人凭据；全局任务继续使用 `{taskId}`。任务串行、同轮合并，执行前重新确认实例仍存在且启用。同一实例的后台任务与管理写入互斥，不阻塞其它实例的配置；下一执行时点和失败次数以插件、实例、任务组合键保存在通用 `plugin_storage`，重启恢复，失败退避。暂停/删除实例后不再调度它，停用插件或关闭宿主会终止进程。此调度独立于章节追更。

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

## 验证方式

生产 bundle 的 Chrome 验证脚本覆盖 390px 手机和 1280px 桌面布局、从自定义来源入口进入、三个 Tab、规则展开与编辑、订阅启停、搜索筛选和目录换源。运行 `node web/tools/ui-review/plugin-extensions.mjs`（仓库根目录，预先构建 Web；CHROME_PATH 可指定浏览器），截图输出到 docs/ui-review/plugin-*.png。

## 本次验证（2026-09-21）

- 服务端全量 287 通过，1 项 Windows 文件权限位测试跳过；类型检查与构建通过。
- Web 全量 532 项 Vitest（maxWorkers=2）及 29 项 Node 测试通过，生产构建通过。
- 插件原有 14 项测试通过（含真实 Chromium 和独立 tarball 安装）；新增 Tab 声明测试及 Catalog 回归 3 项通过，共覆盖 15 项插件测试。
- Chrome 生产界面检查通过：390px 手机、1280px 桌面、来源实例入口、Tab 切换、规则编辑、订阅启停、筛选及换源。
