# 插件扩展页面、搜索与换源

Reader 保留 local 与 OPDS 内置，通过通用协议接入独立 Node.js 插件。宿主负责能力校验、权限、进程与任务调度、缓存和通用界面；来源业务由插件实现。一个插件可添加成多个独立配置的来源实例。

## 页面与存储

实例页面和后台任务在清单的 `sourceTypes[].extensions` 中声明，全局入口使用顶层 `extensions`。实例页面地址为 `#/sources/<sourceId>/<pageId>`，从自定义书源的管理入口打开。插件管理页负责安装、启停和卸载。

GET 调用 `extension.page`；POST 调用 `extension.action`，参数为 `{sourceType,context:{instance,userId},pageId,action,values}`。宿主根据 sourceId 从数据库解析插件与实例，客户端不能伪造上下文；暂停的来源仍可管理，停用插件则不可访问页面。普通读者无页面读取及写入权限。

返回 Page DTO：`title/description/notice/forms/sections/tabs/activeTab`。每个 Tab 包含 `id/title/description/forms/sections/outputs`，页面公共内容和当前 Tab 同时渲染。Form 包含 `id/title/submit/fields/values`，可选 `layout: "inline"` 和 `confirm` 声明紧凑布局及行内二次确认，fields 支持 text、password、textarea、number、boolean、select；values 携带不透明行 ID。Field 可选 `placeholder/min/max`，Page 可选 `noticeKind: "info" | "error"`；所有字段由宿主验证。section 支持 `emptyText`，item 支持 `collapsible`。`outputs` 用于调试日志、JSON 或普通文本，格式为 `{title,text,format:"text"|"log"|"json"}`，宿主以纯文本块渲染并限制数量与大小，不执行内容。一次动作返回新页面；可选 activeTab 请求切换到指定 Tab，否则保留当前选择。纯 Tab 切换保留输入草稿。提交后保留其它声明未变化的表单草稿；服务端改变表单声明或主动刷新时以新页面为准。

操作中的状态、`notice` 和请求错误由宿主统一显示为紧凑浮动提示，不占用页面内容高度。完成提示可关闭并自动消失；错误保留 `alert` 语义，操作完成后的焦点回到内容面板，不滚动到提示。需要持续查看的日志和结果仍放在 `outputs`。

宿主校验声明、页面结构、选项和输入配额；未声明页面拒绝访问。渲染器只呈现文本，不接受 HTML、JS、iframe 或任意前端代码。授权在 HTTP 层执行，隐藏入口不代替鉴权。

启用 storage 权限后，RPC 获得 `host.dataDir = DATA_DIR/plugin-data/<SHA256(pluginId)>`；带实例上下文时还获得 `host.instanceDataDir = host.dataDir/sources/<SHA256(sourceId)>`。插件负责创建目录和原子写入；数据与 npm 包目录分离，停用、升级、卸载均保留。这是受信任插件的约定，不是操作系统沙箱。

## 后台任务

宿主每分钟检查启用插件及启用来源实例的声明任务。实例任务调用 `extension.task({taskId,sourceType,context:{instance,userId:""}})`，不携带个人凭据；全局任务继续使用 `{taskId}`。任务串行、同轮合并，执行前重新确认实例仍存在且启用。同一实例的后台任务与管理写入互斥，不阻塞其它实例的配置；下一执行时点和失败次数以插件、实例、任务组合键保存在通用 `plugin_storage`，重启恢复，失败退避。暂停/删除实例后不再调度它，停用插件或关闭宿主会终止进程。此调度独立于章节追更。

## 搜索

声明 `search.filters`，实现 `searchFilters(ctx)`，返回带不透明 key/value 的选择字段；`SearchRequest.filters` 为字符串映射，宿主只验证结构与大小。搜索历史与下一页保留筛选条件。

前端通过 `POST /api/v1/sources/:id/search` 建立一次 Streamable HTTP 请求，使用 `text/event-stream` 持续接收 `results`，并以 `done` 或 `error` 结束；收到结果后立即合并展示。宿主在服务端按插件返回的 `nextCursor` 拉取后续批次或普通分页，直到游标耗尽、达到请求的 `resultLimit` 或被取消。插件内部的游标分页仍保留，前端不再通过轮询获取结果。停止搜索或断开连接会取消在途搜索，已收到的结果保留。

远程搜索结果按规范化后的书名和作者集合合并显示，数量按合并后的书籍计数；作者缺失或不同作者不合并。点击“X 条书源”查看实时更新的书源列表，再选择具体条目查看详情或获取。合并仅影响展示，每条结果的不透明 `ref`、获取选项和流游标均保留，单次结果上限仍按原始唯一条目计数。

`CatalogPage.errors` 使用 `{source,code,message}` 表达部分失败，由宿主校验。成功条目保留；插件提供脱敏信息，宿主不解释业务错误码。声明 `search.session` 时须同时声明 `search.cancel` 并实现取消接口。宿主按用户与来源隔离会话，前端保留查询、筛选和已收到结果。Web 通过断开结果流停止搜索，宿主负责取消在途调用与暂停插件会话；继续搜索沿用会话及最后收到的游标，重新搜索使用新会话。插件应将搜索轮询与详情/获取操作解耦，并把请求取消信号传到底层任务，避免停止后留下阻塞队列。

## 换源

声明 `content.alternatives` 并实现 `alternatives(ctx,{publicationRef,query,authors,cursor,sessionId,resultLimit})`，返回普通 CatalogPage。宿主从当前用户私有书籍解析绑定与标题，不接受客户端指定他人的来源上下文。

1. 阅读顶部工具栏根据 `source-options.canSwitch` 显示换源图标。打开面板即通过 POST 流持续加载候选；关闭面板断开连接，取消后台搜索。插件按书名、作者校验候选，排除当前来源，并在匹配后应用结果上限。
2. 点击候选取得其目录。唯一同名章节可预选，否则必须手动选择；确认后从所选章开头阅读，不推测百分比或沿用旧章内偏移。
3. 请求携带旧 revision。宿主与刷新共用书籍串行队列，版本不符返回冲突。获取新目录、确认章节存在、读取正文并清洗/内嵌图片全部成功后才提交数据库事务。
4. 事务保存新快照和已验证正文、替换 publicationRef、保留 bookId、书架与订阅，清零新增章计数并推进订阅 generation。失败保留原绑定、目录与缓存。
5. 客户端读到落点正文后才替换阅读视图，并保存新进度。旧修订缓存继续可读；旧笔记/书签保留原 href，不自动迁移到相似章节。其它已打开客户端仍需刷新目录，未缓存旧章节返回快照过期。

重新获取现绑定复用当前书籍 ID；重新加入换源前版本创建独立记录，不会误返回换源后的版本。换源限同一来源实例内提供的候选，跨插件/跨实例不是本版功能。如果目标版本已作为另一条书籍记录入库，返回 SOURCE_ALREADY_ACQUIRED，需从书架打开已有版本，以免合并或覆盖另一本书的笔记和进度。

CatalogEntry 可提供 `sourceName`、`latestChapter`，用于详情弹窗和换源列表。ManifestSnapshot 可提供 `sourceName`，章节可提供 `sourceUrl`（仅 HTTP/HTTPS、无用户名密码）；宿主保存并投影到阅读 DTO，在顶部栏下展示来源和当前章节链接。宿主不解析插件的不透明引用。

目录标题栏的刷新图标仅刷新目录；顶部工具栏的刷新图标强制重新获取当前正文，经过相同的媒体校验、HTML 清洗和图片处理后才覆盖缓存。失败保留原正文和缓存。

## 验证

服务端测试覆盖实例隔离、页面与任务权限、暂停、删除、重启、协议校验和换源事务；Web 测试覆盖通用 Tab、表单草稿、错误反馈与搜索取消。浏览器验证入口见[UI/UX 评审](ui-review/sources-ux.md)。插件业务测试由插件维护者负责。

登录字段使用 `password`：服务端拒绝返回非空的默认密码，客户端不保留密码草稿，提交失败后清空密码。页面及 Tab 可声明 `links: [{title,url}]`，仅支持不包含内嵌凭据的 HTTP(S) 地址，以新窗口和 `noopener noreferrer` 打开。
