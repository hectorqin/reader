# 影音性能测量

性能结论必须记录代码版本、CPU、存储、数据规模、缓存状态以及是否实际运行 ffprobe。旧机器或旧实现的时间数据不作为当前版本基线。

## 测量工具

在 server 目录运行相应 TypeScript 工具。真实服务测量前先构建 server 和 web；真实首次探测需配置 MEDIA_FFPROBE_PATH。

| 工具 | 范围 |
| --- | --- |
| tools/media-catalog-benchmark.ts | 目录查询与数据规模 |
| tools/media-folders-benchmark.ts | 文件夹索引与分页 |
| tools/media-publication-benchmark.ts | 目录发布与事务 |
| tools/media-http-benchmark.ts | HTTP 查询和并发 |
| tools/media-production-benchmark.ts | 编译后的服务、阅读与影音并发 |

例如：npx tsx tools/media-production-benchmark.ts --first-probe。默认和 --large 的预置探测缓存场景与 --first-probe 的真实探测场景应分别报告，不能把已有探测缓存称为系统冷缓存。

输出保存到仓库外或忽略的 artifacts/media 目录。报告至少区分扫描、发布、查询、阅读书架、进度保存/回读，列出 P95、最大值、错误和样本数。

## 当前设计约束

阅读和影音分库、启动异步、目录查询及发布分线程。扫描过程中仍需验证阅读查询和进度写入可用。重扫保留未变化资源的探测资料及人工整理，避免每次重扫全量探测。

OpenList 在单次存储实例中缓存目录快照（最多 64 个目录、合计 20,000 项），合并同目录并发请求，失败不缓存，不跨扫描复用。每页最多 200 项，1000 个曲目同目录的枚举应是 5 页，而非逐曲重复列目录。网络延迟、OpenList 驱动限流和挂载缓存仍需实测。

NAS、远程盘、不同编解码组合、系统冷缓存及长时间并发不能由本机合成目录测试推断。架构说明见[写入隔离](media-write-isolation.md)。
