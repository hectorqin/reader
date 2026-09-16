# Android 外壳

**状态：契约已定义，实现未开始。**

这个目录目前只有设计契约，没有可编译的代码。原因很直接：本次开发环境没有
JDK 与 Android SDK，写一个编译不过、跑不起来的 APK 只是往仓库里堆未经验证
的代码。宁可把边界写清楚，等有构建环境时一次写对。

下面是已经定死、并且**已被 H5 侧验证过**的部分。

---

## 分工：谁渲染什么

用户的问题原话是：**「Android 端 epub 书籍可以使用 H5 渲染，但是其他类型的
书籍需要使用原生来渲染，提升性能。」** 这条已经落进代码
（`web/src/ui/reader-view.ts` 的 `capabilities()`），外壳只需要认这个契约：

| `kind` | 渲染方 | 为什么 |
| --- | --- | --- |
| `reflowable`（epub） | **WebView** | 设备上只有 WebView 实现了 CSS 多栏、内嵌字体、竖排、振假名。原生文本栈要把这些重做一遍，只会更差。 |
| `text`（txt） | **WebView** | 同上，且它只是纯文本，没有原生收益。 |
| `paged`（cbz / 漫画目录 / 单图） | **原生 Pager** | 一页是一个 JPEG。原生 `ImageView` 走硬件解码并复用 bitmap；WebView 每页一个合成层并在主线程解码。真正的原因是内存：300MB 的画册在 WebView 里是中端机 OOM，在原生里没事。 |
| `document`（pdf） | **系统查看器** | 系统已经有一个了。在 WebView 里套 iframe 只是把同样的事做两遍。 |

**API 已经提供了路由所需的全部信息**，不需要外壳自己嗅探扩展名或 UA：

```
GET /api/v1/books/:id/manifest
→ { content: { kind: "reflowable" | "paged" | "text" | "document" | "single-image", ... } }
```

H5 侧在没有外壳时的降级路径也已实测通过（`paged` → 内置翻页器、
`document` → iframe），所以外壳缺失或被停用不会让 App 白屏。

---

## 桥接契约

外壳在 WebView 加载 assets 之前，往 `window` 上写一个对象
（`web/src/bridge.ts` 是唯一的定义处）：

```js
window.readerBridge = {
  serverUrl: 'http://192.168.1.10:8080',  // file:// 下没有 origin，必须给
  platform: 'android',
  deviceName: 'Pixel 8',                  // 写进进度，多设备同步时能看出是哪台
  onBookOpened(bookId) {},                // 外壳接管输入（硬件键、原生翻页）
  onTurnPage(turn) {},                    // 外壳把翻页手势交回给 H5
  cacheBook(bookId) {},                   // 请求离线缓存
};
```

三条约定：

1. **外壳只写这一个对象，不 eval 字符串。** 同进程，走对象比走
   `addJavascriptInterface` 的字符串协议简单，也不会因为转义出错。
2. **`platform: 'android'` 是唯一的路由开关。** 不嗅探 UA —— UA 是猜的，
   桥是事实。
3. **H5 不碰 refresh token。** 令牌由外壳的加密存储管理；WebView 的
   `localStorage` 里放长期凭证，任何被注入的脚本都能读。

`web/src/bridge.ts` 已实现读取侧，并且**无桥时正常工作**（纯 H5 部署即如此）。

---

## 离线缓存

服务端已经把「按书缓存」所需的接口准备好了，外壳侧直接可用：

- `GET /books/:id/content` — 整本书文件流式下载，带 `ETag` 与 `Range`。
  书内容按哈希不可变，所以缓存永不失效，**断点续传也是免费的**。
- 目录型书籍（漫画目录）没有单一文件，返回 `400 DIRECTORY_BOOK`；
  这类书按 `items?group=N` 逐卷取图。

进度与笔记走 `GET /sync?since=<serverTime>` 增量拉取。服务端是唯一真相源，
冲突是 last-writer-wins —— 一台设备属于一个读者，多设备之间不存在「编辑
冲突」，只存在「某台设备落后了」。离线期间本地记录，恢复后合并。

---

## 分发

AGPL 免费、无收入，所以不走应用商店：直接发 APK。

- 侧载 APK 到 GitHub Releases / CNB 制品库
- 没有审核周期，没有 Apple 的 99 美元
- iOS 按设计文档的判断等有赞助再说，本目录不涉及

## 开工前需要的东西

1. JDK 17+ 与 Android SDK（`ANDROID_HOME`）
2. AGP + Kotlin 版本对齐（建议 AGP 8.x / Kotlin 2.x）
3. `web/dist` 的产物打进 `app/src/main/assets/www/` —— 第一步是把
   `web/` 的构建产物复制进去，**不是**在 Android 侧重写渲染
4. 一个可连的服务端实例（`docker compose up` 即可）

第 3 条是这个仓库的结构性约束：**外壳不重写排版**。排版的唯一实现在
`web/`，两条实现只会让「最小覆盖 CSS」的策略分叉。
