# 文档中心 · Documentation

[项目首页](../README.md) · [English overview](../README.en.md)

项目首页介绍阅读与影音能力；安装、日常使用、运维和开发步骤分别放在下面的指南中。
The project README introduces reader. Use the guides below for installation, everyday use, operations, and development.

## 使用与部署 · Using and deploying reader

| 内容 / Topic | 简体中文 | English |
| --- | --- | --- |
| 安装、首次登录、添加书籍、更新 / Installation and first steps | [入门指南](getting-started.zh-CN.md) | [Getting started](getting-started.en.md) |
| 书架、阅读、朗读、来源和离线 / Shelves, reading, TTS, sources, offline | [使用手册](user-guide.zh-CN.md) | Chinese only |
| 电影、剧集、音乐与有声书 / Movies, series, music and audiobooks | [影音手册](media-user-guide.zh-CN.md) | Chinese only |
| 远端媒体目录 / Remote media directories | [OpenList 接入](media-openlist.md) | Chinese only |
| 安装到桌面、离线启动和版本更新 / PWA installation, offline startup and updates | [PWA 指南](pwa.zh-CN.md) | Chinese only |
| 环境变量、目录权限、HTTPS、排错 / Settings, permissions, HTTPS, troubleshooting | [部署配置](configuration.zh-CN.md) | [Configuration](configuration.en.md) |
| 页面业务配置、服务连接与迁移 / Business settings, service connections and migration | [业务配置](business-settings.zh-CN.md) | Chinese only |
| 数据备份、校验与恢复 / Data backup, verification and restore | [备份恢复](backup.zh-CN.md) | Chinese only |
| 本地开发、验证、镜像与 Android 构建 / Development, checks, Docker and Android builds | [开发指南](development.zh-CN.md) | [Development](development.en.md) |

## 技术参考 · Technical reference

以下参考文档目前以中文维护。The following reference documents are currently maintained in Chinese.

| 文档 / Document | 内容 / Contents |
| --- | --- |
| [架构与数据边界 / Architecture](architecture.md) | 数据目录、身份、同步和客户端架构 / Data boundaries, identity, sync, client architecture |
| [前端 React 架构](frontend-react-migration.md) | Web 入口、Provider、路由、feature 边界和长生命周期资源 |
| [API](api.md) | 鉴权、书籍、资源、进度、文件管理、OPDS 与影音 / Auth, books, resources, progress, file management, OPDS and media |
| [界面规范 / UI guidelines](ui.md) | 布局、交互、可访问性 / Layout, interaction, accessibility |

## 验证记录 · Review records

特定功能的验证产物写入被 Git 忽略的 `artifacts/` 目录；当前结果以对应提交的测试和 CI 输出为准。
Feature review artifacts are written to the ignored `artifacts/` directory. Use tests and CI for the current commit's results.

- [互通与客户端覆盖](ecosystem-roadmap.zh-CN.md)

- [OPDS 服务端接入与 WebDAV 备份上传](opds-webdav.zh-CN.md)

## 影音模块

- [使用指南](media-user-guide.zh-CN.md)与 [OpenList 接入](media-openlist.md)
- [架构与实现](media-implementation.md)、[导航规则](media-navigation.md)与[写入隔离](media-write-isolation.md)
- [验证方式](media-validation.md)与[验收媒体包](media-acceptance-pack.md)
- [冻结原型与最新验收参考](prototypes/media/README.md)
