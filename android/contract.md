# 外壳与 H5 的接口

这份文件是外壳与 H5 之间的全部约定。两边分别用 Kotlin 和 TypeScript 写，互相无法类型检查，
所以以 `web/src/android-bridge.d.ts` 为准，由 `android/scripts/check-shell.sh` 双向核对。
改动任何一侧都要同步另一侧和本文件。

## 1. 启动流程

```
MainActivity 启动
  → WebHost 配置 WebView，注册 JS 接口与媒体消息通道
  → 加载 https://appassets.androidplatform.net/assets/index.html（+ 快捷方式对应的 #/media/... 片段）
  → H5 检测 window.ReaderAndroid，选择 Android 平台
  → 服务地址：用户已保存的地址 > configuredServerUrl()（构建时 -PdefaultServerUrl）> 留空待填
  → H5 自己完成登录、会话保存（存储层与浏览器相同）和后续所有请求
```

外壳**不**读写令牌、**不**向 `localStorage` 注入会话，也不 eval 业务脚本。资源来源
`https://appassets.androidplatform.net` 被 H5 视为无效的服务地址，服务端 CORS 单独放行它。

## 2. JS 接口

外壳用 `addJavascriptInterface` 注册两个对象。只有标注 `@JavascriptInterface` 的方法对页面可见。

### `window.ReaderAndroid`（`bridge/ReaderBridge.kt`，当前 `SHELL_VERSION = 3`）

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `shellVersion()` | number | H5 要求 ≥ `MIN_SHELL_VERSION`（1），否则按普通浏览器运行 |
| `configuredServerUrl()` | string | 构建时预设的服务地址，可为空；d.ts 中为可选方法 |
| `deviceLabel()` | string | 写进进度记录的设备名 |
| `connectivity()` | string | `online` / `offline`，来自系统连接管理器 |
| `watchConnectivity(cb)` | void | 见下文「回调」 |
| `toast(message)` | void | 原生 Toast |
| `hasNetwork()` | boolean | 当前是否有网络 |
| `viewport()` | string | JSON：物理像素视口与密度 |
| `cacheUsage()` | string | JSON：`webViewBytes`、`dataBytes`、`availableBytes` |
| `diagnostics()` | string | JSON：外壳版本、设备、系统、应用版本，用于问题报告 |
| `renderPage(request)` | boolean | shell ≥ 2。见第 3 节 |
| `hidePage()` | void | 移除原生页面，露出 WebView |
| `canOpenDocument(mediaType)` | boolean | 目前总是 `false`，PDF 留在 WebView |
| `speech()` | object | Kotlin 侧访问器；页面看到的是下面的独立接口 |

### `window.ReaderAndroidSpeech`（`bridge/SpeechBridge.kt`，shell ≥ 3）

`addJavascriptInterface` 只能暴露对象的方法，不能暴露属性，所以朗读接口单独注册；
H5 的 `promoteSpeechInterface`（`web/src/core/android-platform.ts`）把它挂到
`ReaderAndroid.speech`，d.ts 中声明为 `speech?: SpeechBridge`。

方法：`available()`、`init()`、`onSpeechEvent(cb)`、`onVoices(cb)`、`speak(text, utteranceId)`、
`pause()`、`stop()`、`setRate(rate)`、`setPitch(pitch)`、`setVolume(volume)`、`setVoice(voiceId)`、`shutdown()`。
朗读队列与游标在 JS；`utteranceId` 由 H5 生成，事件原样带回，用来丢弃过期句子的 `done`。
`interruptForMedia()` 没有注解，只供 Kotlin 侧在开始播放影音时调用，不属于页面契约。

### 回调

JS 接口只能传原始类型，所以 Kotlin 端的 `watchConnectivity`、`onSpeechEvent`、`onVoices`
接收的是**全局函数名**（须是安全标识符），之后用 `evaluateJavascript` 调用它。H5 包装层把函数注册为
`window.__readerConnectivity`、`__readerSpeechEvent`、`__readerSpeechVoices` 再把名字传过去；
连接状态传字符串，朗读事件与声音列表传 JSON。页面代码按 d.ts 直接传函数即可。

## 3. 原生整页图片

H5 在 `reader-view.ts` 中通过 `pageHost` 询问外壳，仅在页面为 `image` 模式且读者选择「适应整页」时：

```
ReaderAndroid.renderPage(JSON.stringify({ sectionId, mode: 'image', mediaType, bytes: <base64>, fit: 'contain' }))
  → true：NativePageView 已覆盖在 WebView 上绘制
  → false：外壳拒绝（模式/适配方式不支持、无法解码、超时 2 秒），H5 在 WebView 中照常绘制
```

外壳只解码请求里的 `bytes`（JPEG/PNG/WebP），不按 `path` 自行取图。离开该页时 H5 调用 `hidePage()`。
外壳分支用到的模式名必须在 `web/src/formats/types.ts` 的 `RenderMode` 中，`check-shell.sh` 会检查。

## 4. 影音通道 `window.ReaderMedia`

`media/MediaBridge.kt` 用 `WebViewCompat.addWebMessageListener` 注册，只接受资源来源、只接受主框架，
需要 WebView 支持 `WEB_MESSAGE_LISTENER`；不支持时不注册，H5 使用网页播放器。H5 发送 JSON 字符串
`{ action, ... }`（`web/src/features/media/services/native-audio.ts`），外壳通过回复通道回传播放状态。

`action`：`play`、`showVideo`、`pause`、`resume`、`stop`、`previous`、`next`、`selectQueue`、`editQueue`、
`seek`、`speed`（0.5–3.0）、`audioTrack`、`sleep`、`reconnect`、`status`。播放由
`MediaPlaybackService`（Media3）执行；视频画面在 `MediaVideoActivity` 中显示。消息超过约 900 KB 被忽略。

## 5. 生命周期与系统键

- `onPause` 时外壳执行 `window.__readerFlush && window.__readerFlush()`，H5 借此保存阅读位置。
- 返回键：WebView 有历史则后退，否则退出。
- 外壳**目前不拦截音量键**，也没有「原生翻页器退出后通知 H5」的事件；旧版文档中的
  `reader:native-page` / `reader:native-return` 事件并不存在。

## 6. 离线

离线下载与缓存由 H5 负责（与浏览器共用实现），外壳不另建书籍缓存。H5 使用的服务端接口：

```
GET /api/v1/books/:id/content
  → 整本书，带 ETag，可 Range 续传
  → 目录书（漫画目录）返回 400 DIRECTORY_BOOK；分章书返回 400 CHAPTER_BOOK

GET /api/v1/books/:id/file?path=<manifest files 中列出的 rel_path>
  → 单个文件；path 只能取 manifest 列出的值，其他值得不到别的文件
```

服务端不可达时客户端读本地缓存并静默降级，不能靠报错弹窗。
