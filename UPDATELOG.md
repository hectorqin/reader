# Update Log

## v3.2.6

### Features

- 新增清除最近阅读功能
- 新增编辑文章内容功能
- 优化多个弹窗显示
- 优化书源导入逻辑
- 优化订阅同步逻辑

## v3.2.5

### Features

- 新增simple-web书架排序
- 优化文件读写锁
- 开启连读优化后缓存后三段TTS

### Bug Fixes

- 修改simple-web书架搜索bug

## v3.2.4

### Features

- 修改服务器版本脚本
- 去掉gc，优化文件读写锁
- 测试 iOS 朗读
- 修改接口请求默认超时时间为30秒

## v3.2.3

### Features

- 新增直接添加书签
- 新增simple-web页面设置
- 添加定时gc逻辑
- 优化simple-web页面
- 新增服务器端脚本

### Bug Fixes

- 修改后端链接状态bug

## v3.2.2

### Features

- 优化自动阅读
- 优化书海,书源管理样式
- 优化simple-web兼容性
- 新增PC端设置提示

### Bug Fixes

- 修复windows环境漫画路径问题
- 修复往前翻页bug

## v3.2.1

### Features

- 新增kindle7天试用申请
- 优化epub阅读位置记忆跳转

### Bug Fixes

- 尝试修复PC端启动jvm参数bug

## v3.2.0

### Features

- 新增视频源支持
- epub支持朗读和自动阅读，优化阅读界面
- 新增simple-web搜索及RSS页面，优化simple-web页面样式
- 修改epub导入兼容性
- 新增书源管理搜索功能
- 修改桌面端jvm启动参数
- 新增书源订阅管理
- 优化探索样式
- 优化书源调试页面

### Bug Fixes

- 修复epub书名包含+号时注入js失败问题
- 修复simple-web分页组件
- 修复remote-webview不能访问https问题
- 修改封面上传后弹窗无法关闭的bug
- 修改上下滚动模式目录跳转bug

## v3.1.1

### Features

- 新增在线TTS朗读（Edge大声朗读）

### Bug Fixes

- 修复朗读bug

## v3.1.0

### Features

- 新增下载数据备份功能,新增自动备份功能。通过 --reader.app.autoBackupUserData=true 启用，每天23:50开始会自动备份用户数据到webdav目录
- 延长kindle试用期至 2023-06-30，过期以后需要购买授权来使用kindle页面
- 新增书籍设置pdf图片宽度选项
- 新增朗读时跳过全标点段落，跳过段末标点符号
- 新增更新错误分组排除不追更书籍

### Bug Fixes

- 修复用户管理界面排序bug

## v3.0.5

### Features

- 去掉书籍上限启动参数
- 延长kindle试用期

## v3.0.4

### Features

- 新增封面代理设置
- 优化文件并发读写加锁逻辑
- 优化多源搜索
- 延长kindle试用期

## v3.0.3

### Features

- 新增章节请求超时设置
- 新增simple—web搜索书架功能
- 桌面端新增jvm配置
- 尝试修复音频音量bug,尝试优化pwa
- 页面优化
- 延长kindle试用期

### Bug Fixes

- 修复simple-web端bug

## v3.0.2

### Features

- 支持pdf格式
- 页面优化
- 延长kindle试用期15天

### Bug Fixes

- 修复用户默认书源bug
- simple-web兼容kindle

## v3.0.1

### Features

- 新增书架布局设置，新增分列布局
- 修改书籍分组的字段类型，支持更多分组
- 新增用户更多设置项
- 优化simple-web分页逻辑
- 优化simple-web兼容性
- 优化音频音量设置

### Bug Fixes

- 修复simple-web渲染器bug
- 修复删除书籍未刷新书架bug

## v3.0.0

### Features

- 新增epub iframe模式自定义字体支持
- 新增simple-web端，支持kindle使用（限时免费）
- 新增授权管理，多用户版用户上限降低至 15（已超出的无法再注册，但可以继续使用）
- 新增用户管理、书籍管理、书签管理等分页排序过滤功能
- 新增书源请求头设置
- 新增书籍批量缓存操作
- 新增contextPath设置项
- 新增书架搜索作者及分类
- 优化书籍信息页面
- 优化阅读界面功能按钮

### Bug Fixes

- 修复音频播放bug
- 修复调试书源跳转链接bug

## v2.7.4

### Features

- 新增一键导入本地书籍功能
- 添加新增替换规则入口,优化替换逻辑
- 新增更新错误内置分组
- 优化日志跟踪
- 优化音频时长获取逻辑

### Bug Fixes

- 修复Windows环境webdav路径判断bug
- 尝试修复音频时长获取bug
- 修复书架刷新并发bug
- 修复书籍封面接口bug

## v2.7.3

### Features

- 新增书仓搜索及解析书籍功能
- 修改语音库选择样式
- 优化书源分组
- 优化协程逻辑,拆分解析库和控制层库
- 新增原文阅读模式,优化缓存判断逻辑

### Bug Fixes

- 尝试修复自动切换主题bug

## v2.7.2

### Features

- 新增Epub解析模式， 支持简繁切换、左右翻页
- 新增Epub iframe 模式左右翻页功能
- 修改日志配置，仅保留7天
- 新增书仓文件管理筛选功能
- 修改简繁切换库，样式优化，感谢 [@terry3041](https://github.com/hectorqin/reader/pull/227)

### Bug Fixes

- 修复桌面端bug

## v2.7.1

### Bug Fixes

- 修复书仓下载bug
- 修复书籍追更选项设置bug

## v2.7.0

### Features

- 新增远程webview镜像，支持使用 `hectorqin/remote-webview` 镜像作为远程 `webview`，使用 --reader.app.remoteWebviewApi="http://0.0.0.0:8050" 启用。
- 新增书源`cookie`,`cache`功能支持
- 新增上下左右边距设置

## v2.6.4

### Features

- 新增远程 `webview` 支持，目前仅支持 `scrapinghub/splash` 镜像作为远程 `webview`，使用 --reader.app.remoteWebviewApi="http://0.0.0.0:8050" 启用。
- 优化听书逻辑

### Bug Fixes

- 修复清理用户bug

## v2.6.3

### Features

- 新增清理不活跃用户功能，使用 --reader.app.autoClearInactiveUser=31 (不活跃天数) 启用
- 优化书架更新逻辑
- 新增书架更新间隔设置选项，使用 --reader.app.shelfUpdateInteval=10 (更新间隔分钟，必须是10的倍数) 启用

### Bug Fixes

- 修复加入书架bug
- 修改CI
- 修复配置方案失效bug

---
## v2.6.2

### Features

- 添加用户并发修改锁

### Bug Fixes

- 修改CI

---
## v2.6.1

### Bug Fixes

- 修改CI

---
## v2.6.0

### Bug Fixes

- 修复本地书籍路径问题

---
## v2.5.8

### Features

- 测试CI

---

## v2.5.7

### Features

- 临时书籍使用临时缓存
- 新增支持mongodb存放数据

---

## v2.5.6

### Bug Fixes

- 修复书架路径bug

---

## v2.5.5

### Features

- 统一文件管理
- 优化书籍内容使用缓存图片

### Bug Fixes

- 修复书架绝对路径bug

---

## v2.5.4

### Features

- 新增分组排序功能
- 新增朗读定时功能
- 新增音频音量调整功能

### Bug Fixes

- 修复书架更新并发bug
- 修复window环境问题
- 修复书源调试bug
- 修复音频bug

---

## v2.5.3

### Features

- 新增 webdav 书仓功能,新增修改目录规则功能,优化本地书籍换源功能

---

## v2.5.2

### Bug Fixes

- 修复jdk8编译依赖

---

## v2.5.1

### Features

- 新增自定义字体功能,优化阅读设置功能,新增书签同步功能

---

## v2.5.0

### Features

- 新增全文搜索功能,本地书籍生成封面优化,epub设置增强
- 新增书签功能

---

## v2.4.1

### Features

- 完善注册登录,新增删除用户书源和恢复默认书源功能,测试CI
- 新增本地书仓功能,新增自定义书籍封面功能,新增用户上限和用户书籍上限
- 更新阅读内核
- 新增清空书源功能,新增自动缓存下一章
- 优化本地导入逻辑
- 完成替换规则改版逻辑,新增配置方案设置功能,修复bug,优化页面
- 新增上下滚动翻页模式,优化页面
- 新增简繁转换功能,新增替换规则导入功能,新增设置默认书源功能,新增像素滚动自动翻页,兼容ie
- 新增书源调试功能,优化书海功能,优化缓存功能
- 新增支持CBZ书籍,新增支持卷名,优化调试功能
- 新增书籍管理功能,新增缓存及导出功能,优化书海功能

### Bug Fixes

- 页面优化
- bug修复

---

## v2.0.3

### Features

- 更新阅读解析库
- 优化多源搜索和书源搜索功能
- 新增服务器缓存章节内容功能,优化阅读宽度设置
- 迁移缓存到indexdb
- 新增简洁模式

### Bug Fixes

- 修复书源分组搜索选择bug
- 页面优化
- bug修复

---

## v1.9.4

### Features

- 新增缓存管理，优化缓存逻辑
- 新增页面模式设置
- 新增自定义主题模式设置
- 新增远程书源导入功能
- 新增读取epub封面，优化导入逻辑，优化书源错误标记
- 新增书源导出功能
- 新增按分组搜索书源功能
- 新增刷新章节内容功能
- 新增翻页动画时长设置

### Bug Fixes

- 修复iPad兼容问题
- 修复精确搜索bug,优化json序列化
- 页面优化
- bug修复

---

## V1.8.0

### Features

- 新增点击翻页和选择文字过滤关闭选项
- 支持设置代理（待测试）
- 修复旧版本自动迁移bug
- 修复搜索bug
- 完善失败源标记和恢复逻辑
- 优化ios pwa样式
- 优化书籍标签显示

### Bug Fixes

- 页面优化
- bug修复
