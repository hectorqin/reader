# 文档中心 · Documentation

[项目首页](../README.md) · [English overview](../README.en.md)

项目首页介绍用途与能力；安装、日常使用、运维和开发步骤分别放在下面的指南中。
The project README introduces reader. Use the guides below for installation, everyday use, operations, and development.

## 使用与部署 · Using and deploying reader

| 内容 / Topic | 简体中文 | English |
| --- | --- | --- |
| 安装、首次登录、添加书籍、更新 / Installation and first steps | [入门指南](getting-started.zh-CN.md) | [Getting started](getting-started.en.md) |
| 书架、阅读、朗读、来源和离线 / Shelves, reading, TTS, sources, offline | [使用手册](user-guide.zh-CN.md) | Chinese only |
| 安装到桌面、离线启动和版本更新 / PWA installation, offline startup and updates | [PWA 指南](pwa.zh-CN.md) | Chinese only |
| 环境变量、目录权限、HTTPS、排错 / Settings, permissions, HTTPS, troubleshooting | [部署配置](configuration.zh-CN.md) | [Configuration](configuration.en.md) |
| 数据备份、校验与恢复 / Data backup, verification and restore | [备份恢复](backup.zh-CN.md) | Chinese only |
| 本地开发、验证、镜像与 Android 构建 / Development, checks, Docker and Android builds | [开发指南](development.zh-CN.md) | [Development](development.en.md) |

## 技术参考 · Technical reference

以下参考文档目前以中文维护。The following reference documents are currently maintained in Chinese.

| 文档 / Document | 内容 / Contents |
| --- | --- |
| [架构与数据边界 / Architecture](architecture.md) | 数据目录、身份、同步和客户端架构 / Data boundaries, identity, sync, client architecture |
| [API](api.md) | 鉴权、书籍、资源、进度、文件管理、来源 / Auth, books, resources, progress, file management, sources |
| [来源插件系统 / Source plugins](source-plugins.md) | 契约、宿主职责及实施状态 / Contracts, host responsibilities, implementation status |
| [通用插件扩展 / Plugin extensions](plugin-extensions.md) | 配置页面、任务、搜索、换源 / Configuration pages, tasks, search, source switching |
| [界面规范 / UI guidelines](ui.md) | 布局、交互、可访问性 / Layout, interaction, accessibility |

## 验证记录 · Review records

这些是特定功能交付时的验证记录，当前结果以对应提交的测试和 CI 输出为准。
These records describe checks at specific delivery points. Use tests and CI for the current commit's results.

- [UI 评审工具 / UI review tooling](ui-review/README.md)
- [书源界面 / Source UI](ui-review/sources-ux.md)
- [书库与阅读界面 / Library and reader UI](ui-review/collections-ux.md)
- [书源搜索 / Source search](ui-review/source-search.md)

- [P1 阅读工具实施与验证](p1-progress-2026-09-23.md)

- [P2 交付与验证记录](p2-progress-2026-09-24.md)
- [生态互通与客户端覆盖方案](ecosystem-roadmap.zh-CN.md)

- [OPDS 服务端接入与 WebDAV 备份上传](opds-webdav.zh-CN.md)
