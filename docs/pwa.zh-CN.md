# PWA 安装与离线使用

生产构建（`cd web && npm run build`）自动生成应用清单、桌面图标和 Service Worker，随现有 Web 服务一起部署，无需额外服务。

- 使用 HTTPS 访问；本机 `localhost` / `127.0.0.1` 可使用 HTTP。通过局域网 IP 的普通 HTTP 访问仍能在线阅读，但浏览器不会启用 PWA 离线缓存。
- Chrome / Edge：通过地址栏安装图标或浏览器菜单中的安装应用功能安装。
- iPhone / iPad：在 Safari 中选择“分享 → 添加到主屏幕”。
- 首次联网打开后，等待页面资源缓存完成，再离线使用。书籍正文需要在书架中提前下载；页面缓存不会自动下载整个书库。
- 离线时保留原有登录状态即可打开已缓存书架和已下载书籍。首次登录、未下载内容和需要服务器的功能仍需联网。
- 新版本会在访问时后台下载，关闭该站点的所有页面及独立应用窗口，再次打开后生效。更新不会强制刷新正在阅读的页面。
- Service Worker 仅缓存应用静态资源，不缓存 API、令牌或书籍响应；书籍和阅读数据继续使用原有按账号隔离的存储。

开发服务器不注册 Service Worker；Android 原生 WebView 继续使用本地资源。清理站点数据会同时删除离线页面及本地阅读缓存。

验证：`cd web && npm run build && node tools/pwa/smoke.mjs`。测试需要 Playwright 的 Chromium，可通过 `npx playwright install chromium` 安装。
