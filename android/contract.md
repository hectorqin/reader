# 外壳与 H5 的接口

这份文件是外壳实现时必须照抄的部分。它很短，因为两边只在一个对象上耦合。

## 1. 启动流程

```
外壳启动
  → 读加密存储里的 serverUrl + refreshToken
  → 通过 /auth/refresh 换一个 accessToken（失败则显示登录）
  → 把 web/dist 的 index.html 加载进 WebView
      · 注入 window.readerBridge（见下）
      · 注入 accessToken 到 localStorage 的 `reader.session`
  → H5 自己完成后续所有请求
```

H5 只从 `localStorage['reader.session']` 读会话（`web/src/net/api.ts` 的
`defaultStorage()`）。外壳必须在页面脚本执行前把它写好 —— 用
`WebViewClient.onPageStarted` 或 `evaluateJavascript` 在 `loadUrl` 之前
注入都可以，但**必须在 `index.html` 的 module script 之前**。

## 2. 路由

H5 会自己解析 manifest 并决定谁来渲染。外壳只要监听：

```kotlin
// 外壳侧：H5 请求原生接管分页内容
webView.addJavascriptInterface(object {
    @JavascriptInterface fun openPaged(bookId: String) { /* 起原生 Pager */ }
}, "readerNative")
```

H5 侧分发的时机在 `ReaderView.open()` 里（`caps.paged === 'native'` 分支），
目前通过 `CustomEvent('reader:native-page')` 触发。外壳把它接成上面那个
接口即可。

## 3. 返回

原生 Pager 退出时回到 WebView，并通知 H5 重新拉一次进度：

```js
window.dispatchEvent(new CustomEvent('reader:native-return'))
```

H5 侧的监听尚未实现（`reader-view.ts` 里留了位置），因为尚无外壳可测。
第 1 条之所以只写「已实现的部分」，就是因为这类回调**没测过就不能算数**。

## 4. 硬件键

音量键翻页是阅读器的基本期待。外壳把它转成：

```js
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
```

H5 的键盘处理已经被浏览器实测过（`bindGestures()`），所以这条路不用新增
代码。

## 5. 离线

```
GET /api/v1/books/:id/content
  → 200，带 ETag 与 Accept-Ranges: bytes
  → 中断后用 Range: bytes=<已收字节>- 续传
```

`/data` 里的书架元数据由客户端自己缓存（`GET /api/v1/books` 的响应）。
服务端离线时，外壳读本地缓存渲染书架，并静默降级 —— 设计文档 §8.2
要求「客户端必须优雅处理服务端不可达」，这条不能靠报错弹窗实现。
