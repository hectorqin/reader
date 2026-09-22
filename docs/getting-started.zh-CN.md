# 入门指南

[项目首页](../README.md) · [文档中心](README.md) · [English](getting-started.en.md)

本文带你完成 Docker 部署、注册账号和读取第一本书。直接从源码运行请看[开发指南](development.zh-CN.md)。

## 1. 准备环境

- 安装 Docker Engine 或 Docker Desktop，以及 Docker Compose 插件。
- 准备一个书籍目录和一个独立的数据目录。
- 确保主机的 `8080` 端口可用；也可修改 Compose 左侧端口，例如 `8090:8080`。

容器同时提供 API 和 Web 界面，无需单独部署前端。以下命令从仓库根目录执行。

## 2. 获取部署配置

```sh
git clone https://cnb.cool/hectorqin/reader.git
cd reader
```

编辑 [docker-compose.yml](../docker-compose.yml)，把宿主机书籍路径替换为自己的路径：

```yaml
volumes:
  - /path/to/your/books:/books:ro
  - ./data:/data
```

例如 Linux 使用 `/srv/books:/books:ro`，Windows Docker Desktop 可使用 `"D:/books:/books:ro"`。相对路径 `./data` 位于 Compose 文件所在目录。

| 目录 | 用途 |
| --- | --- |
| `/books`（`BOOKS_DIR`） | 现有书籍文件 |
| `/data`（`DATA_DIR`） | 数据库、账号、阅读记录、封面缓存、上传暂存、下载文件和插件数据 |

`DATA_DIR` 不能与 `BOOKS_DIR` 相同，也不能位于其中；启动时会检查这项约束。元数据保存在数据目录，不会在书旁生成封面或 `.calibre` 文件。

### 选择只读或可写书库

- **只浏览和阅读**：保留 `:ro`。通过宿主机或 NAS 放入新书，等待扫描。
- **在网页管理文件**：改为 `:rw`，并确保服务进程对该目录有写权限。管理员可以在书库文件管理页上传、改名、移动、删除和新建目录。

只读书库不会妨碍进度、笔记或书架保存，这些数据写入 `/data`。挂载和权限的详细说明见[部署配置](configuration.zh-CN.md)。

## 3. 启动与首次登录

```sh
docker compose up -d
docker compose ps
docker compose logs --tail=100 reader
```

打开 `http://localhost:8080`；在另一台设备上使用 `http://<服务器IP>:8080`。

1. 注册第一个账号，该账号自动成为管理员。
2. 等待初次扫描，在书架或书库中打开一本书。
3. 为家人或其他成员创建账号。首个账号创建后默认关闭公开注册。

如需开放后续注册，在 Compose 的 `environment` 中设置 `ALLOW_REGISTRATION: "true"`，然后执行 `docker compose up -d`。

健康检查地址为 `/api/v1/health`。若启动失败、目录为空或无法写入，请看[故障排查](configuration.zh-CN.md#故障排查)。

### 不使用 Compose

在 Linux/macOS 的 POSIX shell 中，也可使用绝对路径启动容器：

```sh
mkdir -p ./data
docker run -d --name reader --restart unless-stopped \
  -p 8080:8080 \
  -v /path/to/your/books:/books:ro \
  -v "$(pwd)/data:/data" \
  cnb.cool/hectorqin/reader:latest
```

Windows 推荐使用上面的 Compose 配置，避免不同 shell 的路径和换行语法差异。

## 4. 添加书籍与来源

### 本地书籍

把 EPUB、TXT、PDF、CBZ/ZIP 或漫画图片目录放到挂载的书库中。默认每 30 分钟定时扫描，每 60 秒检查变化；管理员也可手动触发扫描。可写挂载下，上传入口位于管理员文件管理页。

书架显示可阅读的书籍；书库按磁盘目录浏览。从书架移除书籍与删除磁盘文件是两种不同操作。详见[使用手册](user-guide.zh-CN.md)。

### OPDS

管理员在「书源」添加 OPDS 来源并设置服务地址。需要认证时填写当前账号的来源凭据。打开来源后可浏览或搜索目录，获取书籍并加入书架。

### 外部书源插件

管理员打开「书源 → 插件管理」，确认信任插件代码后，输入 npm 包名（可带版本或标签），或上传 `npm pack` 生成的 `.tgz` 安装包（最大 100 MiB），安装成功后自动启用。无需手动部署包目录。随后在「书源管理」选择插件提供的来源类型创建实例，从该实例的管理入口配置。一个插件可创建多个独立实例；具体功能与运行依赖由插件声明。

插件拥有服务端进程权限，请只安装可信代码。服务端需要 Node.js 和 npm；npm 包及未打包的依赖需要联网下载。安装期间禁用 npm 生命周期脚本，插件应预先构建并打包运行所需文件。所有安装文件与临时文件保存在 `DATA_DIR`，不会写入书库目录。

开发与配置协议见[来源插件](source-plugins.md)和[扩展页面](plugin-extensions.md)。

## 5. 更新与备份

更新前备份书籍目录和数据目录。对 SQLite 采用简单文件备份时，先停止服务，再复制完整 `/data`（包括数据库及其辅助文件），避免复制运行中的不一致状态。

```sh
docker compose stop
# 在此备份宿主机上的书籍目录和 ./data
docker compose pull
docker compose up -d
```

不要删除数据目录：其中包含账号、阅读记录、签名密钥和插件状态。插件包需单独升级；替换包前先在界面停用插件。

## 下一步

- [使用手册](user-guide.zh-CN.md)：阅读设置、书架、书源、朗读和离线。
- [部署配置](configuration.zh-CN.md)：环境变量、HTTPS、目录权限和故障排查。
- [开发指南](development.zh-CN.md)：本地运行、验证、构建镜像和 Android。
- [API 文档](api.md)：自动化与集成。
