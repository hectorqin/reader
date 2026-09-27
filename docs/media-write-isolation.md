# 影音数据与线程隔离

## 启动和迁移

阅读与账号使用 reader.db，影音业务使用 media.db。主线程先开放阅读监听，再启动独立影音 Worker。迁移复制、完整性检查和 schema 初始化在 Worker 中执行；配对身份和激活标记由主线程串行处理。Worker 准备完成并收到激活确认后才开放影音路由。

准备中返回 503 / MEDIA_STARTING，不自动重放写请求；启动失败返回 503 / MEDIA_UNAVAILABLE，阅读仍可用。启动保护上限为 5 分钟。已激活影音库丢失或身份不匹配时拒绝回退、重建或重新导入，必须恢复有效成对备份。关闭最多等待 10 秒后终止 Worker。

## 扫描、发布与查询

扫描阶段不持有阅读数据库写锁。发布使用独立线程和影音数据库事务，整批新快照原子可见；失败或取消不以部分扫描结果替换旧目录。资源身份、人工元数据、归属、版本和进度由发布规则合并。

目录只读查询通过独立查询线程执行，后台发布和大目录排序不会占用阅读主线程。HTTP 代理限制在途请求；客户端断开时取消上游请求。文件流采用背压，不把慢客户端暂停误判为远端无响应。

## 账号与权限

账号身份以阅读服务的权威账号源为准，影音侧只持有必要投影。访问、播放、进度及流读取时重新核对权限，不能只依赖初次扫描或播放时的授权。删除账号的个人引用由后台分批清理；禁用账号不删除共享作品，账号查询失败不清空投影。

## 备份与验证

停服后备份完整 DATA_DIR，包括 reader.db、media.db、WAL 与签名密钥；恢复时成对恢复，禁止单独删除 media.db 触发重建。见[备份说明](backup.zh-CN.md)。

可执行的回归位于 server/test 中的 media-startup-isolation、media-startup-failure、media-migration、media-migration-crash、media-publication-runner、media-catalog-reader、media-proxy 和 media-account-cleanup 测试。性能复验见[测量方法](media-catalog-performance.md)。历史某次运行的时间和测试数量不作为当前版本保证。
