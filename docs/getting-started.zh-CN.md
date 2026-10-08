# 入门指南

[项目首页](../README.md) · [文档中心](README.md) · [English](getting-started.en.md)

本文带你完成 Docker 部署、注册账号和读取第一本书。直接从源码运行请看[开发指南](development.zh-CN.md)。

本指南对应当前 Node 版工作区。CI 发布 `main`（开发分支）和提交短哈希标签，没有发布 `latest` 的配置；标签可用性以对应构建成功为准。部署后核对版本，长期使用建议固定提交标签。旧 Java 版镜像、`/storage` 数据不与新版直接兼容。

## 1. 准备环境

- 安装 Docker Engine 或 Docker Desktop，以及 Docker Compose 插件。
- 准备一个书籍目录和一个独立的数据目录。
- 确保主机的 `5888` 端口可用；也可修改 Compose 左侧端口，例如 `5890:5888`。

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
| `/data`（`DATA_DIR`） | 数据库、账号、阅读记录、封面缓存、上传暂存、下载文件与影音数据 |

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

打开 `http://localhost:5888`；在另一台设备上使用 `http://<服务器IP>:5888`。

1. 注册第一个账号，该账号自动成为管理员。
2. 等待初次扫描，在书架或书库中打开一本书。
3. 为家人或其他成员创建账号。首个账号创建后默认关闭公开注册。

如需开放后续注册，在 Compose 的 `environment` 中设置 `ALLOW_REGISTRATION: "true"`，然后执行 `docker compose up -d`。

健康检查地址为 `/api/v1/health`。若启动失败、目录为空或无法写入，请看[故障排查](configuration.zh-CN.md#故障排查)。

若镜像尚未发布或无法拉取，可从当前检出的源码构建：

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

此方式仍需能下载 Node 基础镜像和 npm 依赖。后续管理该部署时继续使用同样的两个 `-f` 参数。发布镜像部署可在 `.env` 设置 `READER_IMAGE=cnb.cool/hectorqin/reader:<已发布的提交标签>` 固定版本。

### 不使用 Compose

在 Linux/macOS 的 POSIX shell 中，也可使用绝对路径启动容器：

```sh
mkdir -p ./data
docker run -d --name reader --restart unless-stopped \
  -p 5888:5888 \
  -v /path/to/your/books:/books:ro \
  -v "$(pwd)/data:/data" \
  cnb.cool/hectorqin/reader:main
```

Windows 推荐使用上面的 Compose 配置，避免不同 shell 的路径和换行语法差异。

## 4. 添加书籍与来源

### 本地书籍

把 EPUB、TXT、PDF、CBZ/ZIP 或漫画图片目录放到挂载的书库中。默认每 30 分钟定时扫描，每 60 秒检查变化；管理员也可手动触发扫描。可写挂载下，上传入口位于管理员文件管理页。

书架显示可阅读的书籍；书库按磁盘目录浏览。从书架移除书籍与删除磁盘文件是两种不同操作。详见[使用手册](user-guide.zh-CN.md)。

### OPDS

管理员从书架的「书源」入口进入书源中心，添加 OPDS 来源并设置服务地址。需要认证时填写当前账号的来源凭据。打开来源后可浏览或搜索目录，获取书籍并加入书架。

## 5. 添加影音媒体库

本地影音需单独挂载。在 Compose 的 volumes 中按需增加：

```yaml
  - /path/to/your/videos:/media/video:ro
  - /path/to/your/music:/media/music:ro
  - /path/to/your/audiobooks:/media/audiobook:ro
```

执行 `docker compose up -d` 后，打开影视页（`#/media/video`），从右上角「更多操作」进入「影音设置 → 媒体库管理」，选择影视、音乐或有声书，填写容器内目录（例如 `/media/video`）及访问范围。创建后自动扫描；扫描任务和失败原因可在「扫描与刮削」中查看。

Windows 直接运行服务时填本机绝对路径，例如 `D:\Media\Music`；Docker Desktop 则挂载该目录并填写容器内路径。

也可选择 OpenList，填写服务地址、远端目录及可选令牌/目录密码，无需把远端目录挂载到 Reader 容器。详见 [OpenList 接入](media-openlist.md)。

本地扫描可读取 NFO 和标签；在线匹配需按[部署配置](configuration.zh-CN.md)设置 TMDB 或 MusicBrainz。播放不转码，更多操作见[影音手册](media-user-guide.zh-CN.md)。

## 6. 更新与备份

推荐使用[离线备份与恢复工具](backup.zh-CN.md)，可验证文件清单和数据库完整性，并恢复到新目录。首次从没有维护命令的旧构建升级时，仍可按以下停机复制方式保留完整数据。

更新前备份书籍目录和数据目录。对 SQLite 采用简单文件备份时，先停止服务，再复制完整 `/data`（包括数据库及其辅助文件），避免复制运行中的不一致状态。

```sh
docker compose stop
# 在此备份宿主机上的书籍目录和 ./data
docker compose pull
docker compose up -d
```

不要删除数据目录：其中包含账号、阅读与播放进度、影音资料及签名密钥。备份完整目录，成对恢复 reader.db 和 media.db；书籍和原始媒体目录需单独备份。

从旧 Java 版迁移时，先保留其完整备份，使用独立的新数据目录部署新版。本地书文件可挂载到新书库；账号、书架、进度、笔记和旧书源配置目前没有自动迁移工具，不要直接用旧 `/storage` 覆盖新 `/data`。源码构建部署更新时使用两份 Compose 文件重新构建，不能仅执行 `pull`。

## 下一步

- [使用手册](user-guide.zh-CN.md)：阅读设置、书架、书源、朗读和离线。
- [部署配置](configuration.zh-CN.md)：环境变量、HTTPS、目录权限和故障排查。
- [开发指南](development.zh-CN.md)：本地运行、验证、构建镜像和 Android。
- [API 文档](api.md)：自动化与集成。
