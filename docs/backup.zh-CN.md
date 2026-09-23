# 数据备份与恢复

维护命令随服务端构建发布，覆盖整个 `DATA_DIR`：SQLite（含 WAL）、账号、书架、进度、笔记、签名密钥、插件包/状态、下载与缓存。SQLite 的共享内存文件会重新生成，不计入备份。**`BOOKS_DIR` 原书、Compose 配置和环境变量需另行备份。** 如果签名密钥由环境变量提供，也需保留原配置。

这是离线维护工具。运行 backup/restore 前停止所有使用该数据目录的服务和插件；`--server-stopped` 是操作者确认，不会自动检测或停止服务。校验和能发现意外损坏，不证明备份来自可信来源。

## 创建和校验

源码方式先在 `server` 运行 `npm run build`，之后执行：

```sh
node server/dist/maintenance/cli.js backup /absolute/data /absolute/backups/reader-20260923 --server-stopped
node server/dist/maintenance/cli.js verify /absolute/backups/reader-20260923
```

目标目录必须不存在，父目录必须已存在；不能与数据目录重叠。工具逐文件复制并计算 SHA-256，复制后再次核对源/目标，并检查 SQLite 完整性。不会覆盖旧备份。

Docker Compose（以下为 Linux/macOS shell；先确保当前镜像包含维护命令）：

```sh
mkdir -p ./backups
docker compose stop reader
docker compose run --rm --no-deps --user 0:0 --entrypoint node \
  -v "$(pwd)/backups:/backups" reader \
  dist/maintenance/cli.js backup /data /backups/reader-20260923 --server-stopped
docker compose run --rm --no-deps --user 0:0 --entrypoint node \
  -v "$(pwd)/backups:/backups" reader \
  dist/maintenance/cli.js verify /backups/reader-20260923
docker compose up -d reader
```

如果备份/校验失败，先处理错误，不要继续升级。只执行 `verify` 可以在原服务运行时检查独立的备份目录，但不要同时修改备份。

Windows 源码命令可使用 `"D:/reader/data"` 等绝对路径。Docker bind mount 用绝对路径替换 `$(pwd)`。

## 恢复到新目录

先验证备份，再恢复到尚不存在的新数据目录：

```sh
node server/dist/maintenance/cli.js restore /absolute/backups/reader-20260923 /absolute/data-restored --server-stopped
```

Docker 示例使用独立临时容器，不挂载旧数据目录。`READER_IMAGE` 替换为含维护命令的实际镜像标签：

```sh
docker compose stop reader
docker run --rm --user 0:0 --entrypoint node \
  -v "$(pwd)/backups:/backups" \
  -v "$(pwd):/restore" READER_IMAGE \
  dist/maintenance/cli.js restore /backups/reader-20260923 /restore/data-restored --server-stopped
# 上面的维护容器以 root 写入；只调整新恢复目录的所有权。
docker run --rm --user 0:0 --entrypoint chown \
  -v "$(pwd)/data-restored:/data" READER_IMAGE -R reader:reader /data
```

恢复成功且完成上述所有权调整后，把 Compose 的数据挂载改成 `./data-restored:/data`，保留原书挂载和环境变量，再启动同一版本服务。正常启动入口只处理 `/data` 根目录，不会递归修复恢复文件的所有权；源码运行时同样需保证运行账号可读写整个恢复目录。

验收：原账号可登录；书架、进度、笔记和来源配置正确；已下载内容可读。确认前保留旧数据目录，需要回退时停止服务并切回旧挂载。

## 失败与限制

- 失败目标保留 `.reader-backup-incomplete`，服务拒绝从该目录启动；不要手动删除标记绕过校验，应修复原因后重新操作到新目录。
- `reader-backup.json` 是完成备份的文件清单；不能直接把备份目录作为运行数据目录，必须执行 restore。
- 仅支持当前 Node 版 reader 数据库；不转换旧 Java 版 `/storage` 数据。
- 保留目录内部的相对符号链接；拒绝绝对链接、外部链接和特殊设备文件。Windows 创建符号链接可能需要开发者模式或相应权限。
- 本工具不保证在服务运行中复制的一致性；停机是使用前提。书籍多时备份可能较大，请确保目标空间充足。
- 备份含账号及插件凭据，应使用受限权限存放。

- [OPDS 服务端接入与 WebDAV 备份上传](opds-webdav.zh-CN.md)
