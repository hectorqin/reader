# 影音验证方式

验证记录只适用于执行时的源码、构建和环境。旧截图、旧 APK 哈希、旧 Docker 镜像 ID 和历史测试数量不作为当前版本结论。

## 自动测试与构建

分别在 web 和 server 目录执行 npm test、npm run build。依赖 ffmpeg/ffprobe 的真实媒体测试需显式配置相应工具；跳过的测试不计为通过。CI 配置见[.cnb.yml](../.cnb.yml)。

## 浏览器与原型

先构建 web，再从 web 目录运行：

- `npm run ui:review:only`：启动真实服务端媒体夹具，使用生产 React bundle 在 390/1120px 检查书架、书库、影音频道、详情、收藏、播放器、设置和权限页面；同时覆盖搜索、收藏筛选分页、收藏写回、播放会话恢复、媒体库增改和普通用户权限边界。报告写入忽略的 `artifacts/ui-review/react-app/verification.json`，要求 `passed=true`、38 张截图、无页面错误和横向溢出。

- node tools/media-desktop-openlist-review.cjs：桌面分类、选择器、收藏、OpenList 表单及视口边界。
- node tools/media-openlist-e2e.cjs：生产页面、真实 Reader 服务、临时数据库，以及本机模拟 OpenList 的建库、扫描、播放和凭据维护闭环。
- node tools/media-v2-matched-review.cjs：与冻结 v2 原型使用相同内容的布局对照。
- node tools/media-v2-review.cjs：读取 MEDIA_REVIEW_SAMPLE_PACK 指定的[验收媒体包](media-acceptance-pack.md)，进行较完整页面对照。
- node tools/media-playback-review.cjs：实际音视频播放、刷新恢复、歌词队列切换与视频控件检查。

通过 PROTOTYPE_CHROMIUM 指定 Chromium。生成结果写入忽略的 artifacts/media 目录，截图不自动入库。提交中只保留明确选定的最新参考资料；本轮参考见[原型入口](prototypes/media/README.md)。

原型自身检查：node docs/prototypes/media/v2-review/verify.cjs（从仓库根目录）。原型检查、布局断言和生产功能检查需要分别解释，截图数量不代表逐张视觉验收。

## 容器与部署

构建使用仓库根目录作为 Docker 上下文。server/tools/media-docker-smoke.cjs 要求显式指定 MEDIA_DOCKER_IMAGE，启动临时容器验证只读媒体目录、非 root、Range、身份和进度持久化；不应对真实部署目录直接运行合成夹具。

server/tools/media-local-deployment-smoke.cjs 验证本地编译服务的相同 HTTP/重启协议，需要 MEDIA_FFPROBE_PATH；它不能替代 Docker 挂载和 UID 检查。

真实升级前备份整个 DATA_DIR。升级后验证 /api/v1/health、现有账号登录、阅读列表及进度，并使用已授权账号检查 /api/v1/media/libraries、媒体详情及播放。不要在生产环境为验收新增虚假账号或覆盖真实资料。

## 验证边界

OpenList 模拟服务证明 API 契约与 Reader 整体流程，不等于验证用户真实网盘驱动。Android JVM 或 APK 构建不能替代真机后台、锁屏、系统回收与 PiP 检查。性能边界见[测量方法](media-catalog-performance.md)。
