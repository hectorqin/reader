# 本地影音验收素材

本次 Windows 素材目录为 `C:\Users\hector\Downloads\reader-media-acceptance-20260926`，同目录旁有 ZIP。素材不进入 Git，不依赖在线刮削。

在影视、音乐、有声书频道分别添加对应媒体库，填写服务器目录并选择“创建并扫描”：

| 类型 | 目录末级（接在上述目录后） | 正常识别结果 |
| --- | --- | --- |
| 影视 | `video` | 6 部电影，1 部剧集、2 季、4 集 |
| 音乐 | `music` | 6 张专辑、6 位样例艺人、12 首曲目 |
| 有声书 | `audiobooks` | 3 部作品、4 个版本、12 个章节 |

32 个正常媒体文件约 21 MiB，ZIP 约 14.3 MiB。视频为 45 秒 H.264/AAC 图形片段，音乐为 60 秒原创合成旋律（MP3/FLAC），有声书为原创文本的中文系统合成朗读（MP3/M4B）。附本地封面、NFO、音频标签、SRT 和 LRC。`empty` 用于空内容场景，`edge-cases` 中故意损坏的 MP3 应单独建库，不计入正常文件。

包内 README 提供播放、字幕、歌词、倍速、章节、进度恢复等验收步骤；manifest.json 记录时长、编码和 SHA-256；scan-verification.json 记录实际扫描器的识别结果。验证使用内存数据库，没有写入用户运行中的数据库。

### 本机 Windows 启动服务

已将本轮验证使用的 ffprobe/ffmpeg 放到 `C:\Users\hector\Downloads\reader-media-tools-20260926`。启动服务的 PowerShell 窗口先执行下列命令，然后使用原来的启动命令启动或重启服务：

```powershell
. 'C:\Users\hector\Downloads\reader-media-acceptance-20260926\Set-MediaTools.ps1'
```

脚本只设置当前窗口的 `MEDIA_FFPROBE_PATH` 与 `MEDIA_FFMPEG_PATH`，不修改系统 PATH 或数据库；已运行的进程不会自动获取这些变量。此工具目录独立于素材 ZIP，换机器时需配置当地工具路径。这里的 FFmpeg 用于读取内嵌封面/字幕，未启用转码功能。

## 重新生成

需要 Node.js 22+、已安装项目依赖、FFmpeg/ffprobe、Playwright Chromium，以及 Windows 的 Microsoft Huihui Desktop 中文语音。输出目录必须尚不存在，脚本不会覆盖已有素材。

在仓库根目录的 PowerShell 中运行（工具路径改为本机实际位置）：

```powershell
$env:MEDIA_TEST_FFMPEG = 'C:\tools\ffmpeg\bin\ffmpeg.exe'
$env:MEDIA_FFPROBE_PATH = 'C:\tools\ffmpeg\bin\ffprobe.exe'
# 使用自定义浏览器时再设置 PROTOTYPE_CHROMIUM；否则使用 Playwright 自带浏览器。
node server/tools/media-sample-pack.cjs C:/media/reader-acceptance-new
node --import ./server/node_modules/tsx/dist/loader.mjs server/tools/media-sample-check.ts C:/media/reader-acceptance-new
```

生成器先打包，扫描检查随后写入目录中的 scan-verification.json；重新分发时可将该报告一并加入 ZIP。本次交付 ZIP 已包含报告。应用服务启动进程需能执行 ffprobe；不在 PATH 时设置 `MEDIA_FFPROBE_PATH`，提取内嵌封面或字幕还需 `MEDIA_FFMPEG_PATH`。

## 空媒体库页面

未建库时隐藏空下拉框、文件夹和计数，显示频道图标与“添加媒体库”入口；已有库但分类为空时提供管理入口；普通用户只显示可访问内容提示。创建并提交扫描后进入任务管理。没有修改阅读器或书架设置。

空媒体库可运行 `node web/tools/media-empty-review.cjs` 重新验证，结果写入 `artifacts/media/empty-library-review`；参见[验证方式](media-validation.md)。

验证范围：

- 32 个正常媒体通过 ffprobe；实际扫描器验证电影、分季、专辑、封面、版本和章节结构。
- 19 项定向测试覆盖空态、创建重试、分页和阅读隔离。
- 浏览器检查入口、取消、创建并扫描、任务返回和已有空库管理，检查无横向溢出及浏览器异常。
- Web 构建成功。运行中的服务需使用本工作区 `web/dist` 并刷新页面；本轮没有部署服务或重建 Android/Docker。

这些短片段用于基础交互验收；在线刮削、真实影片编码兼容性、联网来源及长时间播放需另行验收。
