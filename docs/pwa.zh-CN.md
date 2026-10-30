# PWA 安装与离线使用

生产构建（`cd web && npm run build`）自动生成应用清单、桌面图标和 Service Worker，随现有 Web 服务一起部署，无需额外服务。

- 使用 HTTPS 访问；本机 `localhost` / `127.0.0.1` 可使用 HTTP。通过局域网 IP 的普通 HTTP 访问仍能在线阅读，但浏览器不会启用 PWA 离线缓存。
- Chrome / Edge：通过地址栏安装图标或浏览器菜单中的安装应用功能安装。
- iPhone / iPad：在 Safari 中选择“分享 → 添加到主屏幕”。
- 首次联网打开后，等待页面资源缓存完成，再离线使用。书籍正文需要在阅读器「工具 → 离线缓存」中提前下载；页面缓存不会自动下载整个书库。
- 离线时保留原有登录状态即可打开已缓存书架和已下载书籍。首次登录、未下载内容和需要服务器的功能仍需联网。
- 新版本会在访问、回到页面、恢复联网时检查，持续打开的页面每小时检查一次。下载完成后显示“立即更新”，点击会先保存本地阅读进度，再启用新版并刷新当前页面，无需重启 Chrome 或关闭其他窗口。保存失败时保留页面并允许重试。其他已打开的页面不会被强制刷新。
- 首次从没有更新提示的旧版本升级，仍需关闭该站点的所有页面及独立应用窗口后重新打开一次，之后即可使用“立即更新”。
- Service Worker 仅缓存应用静态资源，不缓存 API、令牌或书籍响应；书籍和阅读数据继续使用原有按账号隔离的存储。

## 图标、启动画面与独立窗口

- 清单的 `background_color` / `theme_color`、`index.html` 的首屏底色与 `theme-color`、iOS 启动图的底色都是默认主题（暖陶浅色）的 `--color-bg` `#FDF9F6`。三处不一致时，启动时会先后看到两种颜色。运行起来之后 `theme-color` 由 `ThemeController` 按当前主题改写。
- 图标：`icon-192.png` / `icon-512.png`（`purpose: any`，圆角方块）和 `maskable-512.png`（`purpose: maskable`，底色铺满，图形在中央 80% 安全区内）。没有 maskable 图标时，Android 启动器会把圆角方块缩小后塞进一个白色圆形。
- 改了 `public/icons/reader.svg` 或底色后，运行 `node web/tools/pwa/branding.mjs`，一次重新生成 maskable 图标、APK 启动器图标和 iOS 启动图。
- `display_override` 只写 `standalone`，不用 `window-controls-overlay`：页面没有绘制标题栏区域（没有 `env(titlebar-area-*)` 和 `app-region: drag`），开了它，桌面版窗口会拖不动，窗口按钮也会盖住页面右上角。
- 清单**不写 `orientation`**。Android 版 Chrome 会把 `"any"` 映射为完全跟随重力感应，安装后的应用会无视手机的「自动旋转」开关；不写这个字段，应用就跟随系统设置。
- Service Worker 对 `manifest.webmanifest` 用**网络优先**（离线时才用缓存），其他静态资源仍是缓存优先。Chrome 会重新读取清单来更新已安装的应用（方向、图标、颜色）；如果用缓存优先，已安装的应用会一直停留在第一次缓存的清单上，直到读者点了「立即更新」。已安装的应用要等 Chrome 自己检查到清单变化后才会更新；想马上生效，可以卸载后重新安装。
- iOS 状态栏样式用 `default`（理由见 `docs/ui.md` §3.1）。手机上贴边的页头、底栏、侧栏怎么处理安全区，也在那一节。

开发服务器不注册 Service Worker；Android 原生 WebView 继续使用本地资源。清理站点数据会同时删除离线页面及本地阅读缓存。

验证：`cd web && npm run build && node tools/pwa/smoke.mjs`。测试需要 Playwright 的 Chromium，可通过 `npx playwright install chromium` 安装。
