# 媒体页面 UI/UX 端到端评审

日期：2026-10-01  
范围：媒体首页、视频/电影/剧集、音乐/专辑、设置/主题；移动端 390px、桌面端 1120px；原型对照与生产构建。

## 验证结果

- `npm run build`：通过。
- `npm run test`：114 个测试文件、995 项通过。
- `media-v2-review.cjs`：14 组移动/桌面对照通过，`errors: []`。
- 已验证：六套媒体主题、主题切换后的播放器/页面 token 一致性、视频与音乐分区布局、标题/列表的长文本处理、页面无横向溢出。
- 播放器专项：视频 Plyr 初始化在当前评审素材下 12 秒超时，需补充真实视频播放状态与加载失败态的 E2E 回归。

## 优化建议

### P0：播放器加载态与失败态

视频播放按钮触发后应立即进入“正在加载”状态，超过阈值显示“重试 / 返回详情”，避免按钮无反馈造成误判。音频播放器与视频播放器应共用状态语义：待播放、加载中、播放中、暂停、不可用。

验收：点击播放后 300ms 内出现加载反馈；媒体资源超时或 4xx/5xx 时出现可操作错误；重试不会重复创建队列。

### P1：主题 token 与控件层级

当前主题变量已能覆盖媒体页、频道入口和播放器。后续继续统一 `background / paper / surface / text / muted / border / accent / selection`，并为禁用态、焦点态、错误态建立对比度检查。主操作每个分区只保留一个强调按钮，收藏、更多、管理等动作降为次级。

### P1：分区布局与导航

视频分区建议固定“频道标签 → 筛选/排序 → 内容网格 → 分页”的节奏；详情页保持“封面/标题/主操作 → 简介 → 版本/章节/资源”。在 390px 下筛选控件允许换行，按钮触控区保持 44px。

### P1：按钮可见性与语义

图标按钮必须同时有可访问名称；失败任务优先展示“重试”，删除放在次级菜单；播放器的“打开控制、歌词、睡眠定时、播放队列”保持固定顺序，避免随状态跳动。

### P2：信息密度

长标题使用两行截断并保留完整可访问名称；封面下元信息只保留作者/类型等一行关键字段。设置页按“播放、界面、主题、媒体库”分组，组间使用 16–24px 间距。

## 原型

高保真原型位于 [`docs/prototypes/media/v2-review/index.html`](../prototypes/media/v2-review/index.html)，包含 42 个页面和状态、移动/桌面尺寸、六套主题，可直接在浏览器打开。其布局基准已用于本次 14 组生产页面对照。

## 复现命令

```powershell
$env:PROTOTYPE_CHROMIUM='C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:MEDIA_REVIEW_SAMPLE_PACK='C:\Users\hector\Downloads\reader-media-acceptance-20260926'
$env:MEDIA_V2_ONLY='video,movie,show,music,album,settings,themes'
node web/tools/media-v2-review.cjs
```

