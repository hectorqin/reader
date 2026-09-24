# OPDS 服务端与 WebDAV 备份

## 在其他阅读器中打开 Reader 书架

1. 登录 Reader，打开“书架设置 → 连接外部阅读器”。
2. 填写客户端名称并创建 OPDS 凭据。复制目录地址、OPDS 用户名和密码到支持 OPDS 1.2 / HTTP Basic 的阅读器。
3. 密码只显示一次，有效期一年。丢失后撤销并创建新的；不使用 Reader 登录密码。

目录地址通常为 `https://你的域名/opds`。反代含路径前缀时，将 `PUBLIC_URL` 配置为完整外部地址，并确保反代转发 OPDS 路由与 Authorization 头。对外部署须使用 HTTPS。

首版提供当前账号未隐藏书架中的文件书籍、搜索、每页 50 本、封面与支持 Range 的原文件下载。章节书和目录漫画暂不发布。目录和下载请求都重新验证客户端凭据及账号状态，并设为 private/no-store。撤销或禁用账号后，新请求立即失效；已经下载到外部设备的文件无法远程删除。

只读应用凭据存储为 SHA-256 摘要，不可用于 Reader 普通 API 或写入。每个账号最多 20 个客户端。第三方客户端支持程度不同，本轮已对接 Reader 内置 OPDS 客户端，尚未对 Calibre、iOS 或电纸书客户端逐一实测。

接口：

| 接口 | 认证 | 作用 |
| --- | --- | --- |
| GET/POST `/api/v1/opds/credentials` | Reader Bearer | 列出/创建自己的客户端凭据；创建返回一次性 password |
| DELETE `/api/v1/opds/credentials/:id` | Reader Bearer | 撤销自己的凭据 |
| GET `/opds?search=关键词&page=1` | OPDS Basic | Atom acquisition feed |
| GET `/opds/search.xml` | OPDS Basic | OpenSearch 描述 |
| GET `/opds/books/:id/content`、`/cover` | OPDS Basic | 原文件/封面，均检查账号书架权限 |

## 上传一致性备份到 WebDAV

这是管理员 CLI，上传已完成的备份目录；不直接同步运行中的 DATA_DIR，也不是 Legado 进度互通。先按 [备份指南](backup.zh-CN.md) 停止全部相关服务和插件、创建并验证备份。上传阶段可重新启动 Reader，备份目录保持不变。

在编译后的服务端目录运行：

```sh
# 从安全的环境/秘密管理器注入，不要把密码写进仓库或 URL
export WEBDAV_URL='https://dav.example.com/reader-backups/'
export WEBDAV_USERNAME='backup-user'
# WEBDAV_PASSWORD 由运行环境注入
node dist/maintenance/webdav-cli.js /backups/reader-20260924 reader-20260924.zip
```

目标 WebDAV collection 必须已存在，账号需有 HEAD、PUT、GET、MOVE、DELETE 权限。仅接受 HTTPS（loopback 测试允许 HTTP），不跟随重定向转发凭据。原始文件及最终 ZIP 默认限 2 GiB，可通过 `WEBDAV_MAX_BYTES` 设置；ZIP32 上限小于 4 GiB，最多 60000 条目录记录。打包使用本地临时磁盘，服务端需有足够空间。

流程为：验证目录 → 流式 ZIP 打包 → 再次验证目录 → 检查同名目标 → 上传随机临时文件 → 下载并核对大小/SHA-256 → `MOVE` 且 `Overwrite: F` 发布。暂时性 PUT 错误最多尝试三次；身份验证失败、校验失败或最终 MOVE 错误不会强行覆盖。最终发布结果不确定时须核对远端，不自动重试 MOVE。

取消/失败会尝试删除此次随机临时文件；网络持续故障时可能残留 `.reader-upload-*.zip`，管理员核对后清理。首版不自动删除历史备份、不设定计划任务。密码仅存在调用进程环境，不写入配置和日志。

恢复时，下载并在新的空目录解压 ZIP（Linux 上保留权限和内部符号链接），运行 `maintenance/cli.js verify`，通过后按备份指南恢复到新的 DATA_DIR。请使用可信工具解压；备份包含账号数据和 token.secret，应使用私有 WebDAV 存储及受控下载权限。
