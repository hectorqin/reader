# Android 外壳

Kotlin 写的 WebView 外壳：加载与 H5 **同一份** `web/` 构建产物，只补 WebView 做不到
或做不好的部分——连接状态、设备名、原生整页图片、系统 TTS、Media3 后台播放与原生视频。
排版的唯一实现在 `web/`，**外壳不重写排版**；两条实现只会让「最小覆盖 CSS」的策略分叉。

与 H5 的接口见 [contract.md](contract.md)。

## 构建

需要 JDK 17+、Android SDK 35、Build Tools 35.0.1（AGP 8.7.3、Kotlin 2.0.21、
Gradle Wrapper 8.11.1，`compileSdk`/`targetSdk` 35，`minSdk` 24）。从仓库根目录：

```sh
sh android/scripts/build-web-assets.sh   # 构建 web/ 并复制到 app/src/main/assets/web-assets/
cd android
./gradlew :app:assembleDebug             # Windows 原生终端用 gradlew.bat
```

产物为 `android/app/build/outputs/apk/debug/app-debug.apk`。编译通过不等于真机阅读、
播放验证通过。

- **服务地址**：默认留空，首次启动在登录页填写并记住。个人构建可预设：
  `./gradlew :app:assembleDebug -PdefaultServerUrl=http://nas.local:5888`
  （写入 `BuildConfig.DEFAULT_SERVER_URL`，经桥接方法 `configuredServerUrl()` 交给 H5 预填）。
- **资源目录**：`app/build.gradle.kts` 把 assets 根目录**替换**为 `src/main/assets/web-assets`，
  所以 `web/dist` 的内容平铺在 APK 的 `assets/` 下。该目录除 `README.txt` 占位外被 Git 忽略。
- release 构建在没有提供 keystore 时使用 debug 签名。
- **包名**：`applicationId` 与 `namespace` 均为 `com.htmake.readerpro`，Kotlin 源码在
  `app/src/main/java/com/htmake/readerpro/`（媒体快捷方式的 action 也以此为前缀）。旧包名
  `cool.cnb.reader` 的安装与新包是两个不同的应用，不能覆盖升级，也不迁移其本地数据。

### 不需要 JDK 的检查

```sh
sh android/scripts/check-shell.sh        # 秒级
sh android/scripts/verify-web-assets.sh  # 在 build-web-assets.sh 之后运行
```

- `check-shell.sh`：包名与目录一致；`com.htmake.readerpro.*` 导入都能解析；JS 桥接契约双向一致
  （只把 `ReaderBridge.kt`、`SpeechBridge.kt` 里紧跟 `@JavascriptInterface` 的方法算作桥接方法，
  每个都必须在 `web/src/android-bridge.d.ts` 中声明，反之亦然；没有注解的 Kotlin 方法页面调不到，
  不应声明）；`ReaderBridge.kt` 分支用到的渲染模式都在 `web/src/formats/types.ts` 的 `RenderMode` 中；
  `NativePageView` 能解码 JPEG/PNG/WebP。
- `verify-web-assets.sh`：确认暂存的 Web 产物正是 Gradle 会打进 APK 的那份——否则 APK
  能构建成功却启动即白屏。
- `scripts/verify-web-apk.ps1`（PowerShell）：逐文件比对已构建 APK 的 `assets/` 与 `web/dist` 的哈希。

CI：GitHub Actions `ci.yml` 的 Android 任务依次运行 `check-shell.sh`、`build-web-assets.sh`、
`verify-web-assets.sh` 和 `./gradlew --no-daemon :app:assembleDebug`，并上传 debug APK 制品；

---

## 宿主与来源

`WebHost.kt` 用 `WebViewAssetLoader` 把打包的客户端从
`https://appassets.androidplatform.net/assets/index.html` 提供，而不是 `file://`：
`file://` 下对服务端的 `fetch()` 是不透明跨域请求，常见绕法是关掉 Web 安全。HTTPS 资源来源让
请求成为普通 CORS 请求（服务端 `server/src/http/cors.ts` 放行该来源），`isSecureContext` 为真，
IndexedDB 等 API 与浏览器一致。因为资源加载器不能为任意路径回退到 `index.html`，客户端只用哈希路由。

- 登录、会话与离线数据都由 H5 自己管理（与浏览器相同的存储层）；外壳不注入令牌。
- 服务端通常是局域网 `http://`，所以清单允许明文流量，WebView 允许混合内容。
- 书内外链交给系统浏览器打开；`reader-res:`、`blob:`、`data:`、`about:` 与资源来源留在 WebView 内。
- 返回键先走 WebView 历史，没有历史时才退出。
- `onPause` 调用 `window.__readerFlush()`，让阅读进度在切到后台前落盘。
- 桌面快捷方式 `OPEN_VIDEO` / `OPEN_MUSIC` / `OPEN_AUDIOBOOK` 分别打开 `#/media/video`、
  `#/media/music`、`#/media/audiobook`。
- debug 构建开启 WebView 远程调试；页面 console 输出到 logcat（标签 `ReaderWeb`）。

## 分工：谁渲染什么

| 内容 | 渲染方 | 说明 |
| --- | --- | --- |
| EPUB、TXT 等可重排内容 | **WebView** | 只有 WebView 实现了 CSS 多栏、内嵌字体、竖排、振假名；原生重做只会更差。 |
| 整页图片（漫画页、图片页，`RenderMode = 'image'`） | **原生 `NativePageView`**（shell ≥ 2） | 平台解码并按视口采样，避免 WebView 每页一次解码和布局。仅在「适应整页」(`contain`) 时使用；外壳返回 `false` 就由 WebView 照常绘制，没有第三种结果。 |
| PDF（`document`） | **WebView** | `canOpenDocument()` 目前总是返回 `false`：系统查看器是独立页面，会把读者带出应用。 |

路由由 H5 决定（`web/src/ui/reader-view.ts` 通过 `pageHost` 询问外壳），外壳不嗅探扩展名或 UA。

## 朗读与影音

- **朗读**：`SpeechBridge.kt` 封装系统 `TextToSpeech`（shell ≥ 3），注册为独立接口
  `window.ReaderAndroidSpeech`，H5 把它挂到 `ReaderAndroid.speech`。队列和句子游标留在 JS；
  没有原生朗读时回退到 WebView 的 `speechSynthesis`。
- **影音**：`media/` 下的 `MediaPlaybackService`（Media3 `MediaSessionService`，前台服务、通知与
  后台播放）、`MediaVideoActivity`（原生视频画面，支持画中画）和 `MediaBridge`。`MediaBridge` 不是
  `@JavascriptInterface`，而是只对资源来源、只对主框架开放的 `WebMessageListener`（`window.ReaderMedia`），
  需要 WebView 支持 `WEB_MESSAGE_LISTENER`，否则 H5 使用网页播放器。播放与朗读互相打断。

## 分发

AGPL 免费、无收入，不走应用商店，直接侧载 APK。当前 CI 只产出 debug APK 制品；Docker 镜像发布
（`release.yml`）不包含 APK。iOS 不在本目录范围内。
