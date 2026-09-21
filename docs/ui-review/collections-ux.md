# 书架与书库样式优化

日期：2026-09-21。

- 标题、辅助文字、设置入口统一；书架的“书库 / 书源”和书库的“文件管理 / 上传书籍”使用同样的图标文字入口。子目录的面包屑单列显示。
- 搜索框统一圆角与高度；空书架隐藏排序栏，刷新移至标题栏。
- 空状态统一为图标、标题、说明和主操作卡片。空书架可去搜书或打开书库；空书库可上传第一本书；存在未识别文件时引导查看文件管理；只读目录不显示上传操作。空库不再显示单独的“0 本”状态栏。
- 保留搜索、排序、目录导航和有书时的封面网格。

验证：Web 构建及 38 项书架、书库、权限相关测试通过。生产 bundle 在 Chromium 中检查 320/390/1280px 空状态、有书、子目录、无搜索结果、只读和深色主题；验证书源、书库、文件管理、上传文件选择器、排序、搜索清除操作，以及页面和导航无横向溢出。

浏览器脚本使用可控 API fixture；没有上传实际文件，也未进行 Android/iOS 真机测试。

```powershell
npm --prefix web run build
$env:CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
node web/tools/ui-review/collections.mjs
```

截图输出到本目录 `collections-*.png`，重点预览：`collections-shelf-empty-390.png`、`collections-library-empty-390.png`、`collections-shelf-books.png`、`collections-library-books.png`。
