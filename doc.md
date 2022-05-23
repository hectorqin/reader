# 文档

- [文档](#文档)
  - [免责声明（Disclaimer）](#免责声明disclaimer)
  - [数据存储](#数据存储)
    - [本地书仓](#本地书仓)
  - [自定义阅读主题](#自定义阅读主题)
  - [自定义样式](#自定义样式)
  - [接口服务配置](#接口服务配置)
  - [WebDAV同步配置](#webdav同步配置)
  - [客户端](#客户端)
    - [Windows / MacOS / Linux](#windows--macos--linux)
      - [配置文件](#配置文件)
    - [手机端](#手机端)
    - [服务器版](#服务器版)
    - [Docker版](#docker版)
    - [Docker-Compose版(推荐)](#docker-compose版推荐)
  - [Nginx反向代理](#nginx反向代理)
  - [开发编译](#开发编译)
    - [编译脚本](#编译脚本)
    - [编译前端](#编译前端)
    - [编译接口](#编译接口)
  - [接口文档](#接口文档)
    - [新增接口](#新增接口)
      - [加入书架](#加入书架)
      - [获取书籍书源](#获取书籍书源)
      - [搜索书籍更多书源](#搜索书籍更多书源)
      - [书籍换源](#书籍换源)

## 免责声明（Disclaimer）

阅读是一款提供网络文学搜索的工具，为广大网络文学爱好者提供一种方便、快捷舒适的试读体验。

当您搜索一本书的时，阅读会将该书的书名以关键词的形式提交到各个第三方网络文学网站。各第三方网站返回的内容与阅读无关，阅读对其概不负责，亦不承担任何法律责任。任何通过使用阅读而链接到的第三方网页均系他人制作或提供，您可能从第三方网页上获得其他服务，阅读对其合法性概不负责，亦不承担任何法律责任。第三方搜索引擎结果根据您提交的书名自动搜索获得并提供试读，不代表阅读赞成或被搜索链接到的第三方网页上的内容或立场。您应该对使用搜索引擎的结果自行承担风险。

阅读不做任何形式的保证：不保证第三方搜索引擎的搜索结果满足您的要求，不保证搜索服务不中断，不保证搜索结果的安全性、正确性、及时性、合法性。因网络状况、通讯线路、第三方网站等任何原因而导致您不能正常使用阅读，阅读不承担任何法律责任。阅读尊重并保护所有使用阅读用户的个人隐私权，您注册的用户名、电子邮件地址等个人资料，非经您亲自许可或根据相关法律、法规的强制性规定，阅读不会主动地泄露给第三方。

阅读致力于最大程度地减少网络文学阅读者在自行搜寻过程中的无意义的时间浪费，通过专业搜索展示不同网站中网络文学的最新章节。阅读在为广大小说爱好者提供方便、快捷舒适的试读体验的同时，也使优秀网络文学得以迅速、更广泛的传播，从而达到了在一定程度促进网络文学充分繁荣发展之目的。阅读鼓励广大小说爱好者通过阅读发现优秀网络小说及其提供商，并建议阅读正版图书。任何单位或个人认为通过阅读搜索链接到的第三方网页内容可能涉嫌侵犯其信息网络传播权，应该及时向阅读提出书面权力通知，并提供身份证明、权属证明及详细侵权情况证明。阅读在收到上述法律文件后，将会依法尽快断开相关链接内容。

## 数据存储

接口服务使用文件存储书源及目录等信息，存储位置为 storage 目录(可通过运行时添加 `-Dreader.app.storagePath=/path/to/storage` 修改)。

> MacOS客户端的存储目录是 `~/.reader/storage`，Window和Linux客户端为 `运行目录/storage`

数据存储目录结构如下：

> 书籍缓存目录由 `书名` 变为 `书名_作者名`，这个变动需要手动编辑，否则书籍书源列表缓存信息无法使用

```bash
storage
├── assets                                        # 静态资源
│   |── covers                                    # 本地 epub 书籍的封面图片目录
│   ├── hector                                    # 用户 hector 的资源目录
│   │   ├── background                            # 自定义阅读背景图片保存目录
│   │   │   └── 6.jpg
│   └── reader.css                                # 自定义CSS样式文件
├── cache                                         # 缓存目录
│   ├── 6190ac40068e74c2c82624e91a5f8a0c.jpg      # 书籍封面缓存
│   ├── bookInfoCache                             # 书籍搜索缓存 ACache 目录
│   └── ea11967236129bdae6133c3c9ff8c2dd.jpg
├── data                                          # 数据目录
│   ├── default                                   # 系统默认用户的数据目录 (reader.app.secure为false时)
│   │   ├── bookSource.json                       # 书源列表
│   │   ├── bookshelf.json                        # 书架书籍列表
│   │   ├── 斗罗大陆_唐家三少                        # 书籍缓存目录
│   │   │   ├── 5d01bc88d6b19ebbe974acaac1675811         # A书源章节缓存目录
│   │   │   ├── 5d01bc88d6b19ebbe974acaac1675811.json    # A书源目录列表
│   │   │   ├── 7e5ca1cc2a1ea2e09fdec4ee2e150f02         # B书源章节缓存目录
│   │   │   ├── 7e5ca1cc2a1ea2e09fdec4ee2e150f02.json    # B书源目录列表
│   │   │   └── bookSource.json                          # 书籍书源列表
│   ├── hector                                    # 用户 hector 的数据目录 (reader.app.secure为true时的用户目录)
│   │   ├── bookSource.json                       # 书源列表
│   │   ├── bookshelf.json                        # 书架书籍列表
│   │   ├── webdav                                # webdav 存储目录 可能会存在 legado 子目录
│   │   │   ├── backup2021-09-15.zip              # 阅读3备份文件
│   │   │   └── bookProgress                      # 阅读3书籍进度备份目录
│   │   │       └── 斗罗大陆_唐家三少.json           # 阅读3书籍进度
│   │   └── 斗罗大陆_唐家三少                        # 书籍缓存目录
│   │       |── 2d44d0ec2397b6c1d4010b97d914031e       # A书源章节缓存目录
│   │       └── 2d44d0ec2397b6c1d4010b97d914031e.json  # A书源目录列表
│   └── users.json                                # 用户列表
├── localStore                                    # 本地书仓，所有用户共享(用户需要开启书仓权限，才能访问)
│   |── 斗破苍穹.txt                               # 本地书仓书籍
│   └── 斗罗大陆.txt                               # 本地书仓书籍
└── windowConfig.json                             # 窗口配置文件
```

### 本地书仓

在 `storage/localStore` 中可以集中存放管理本地书籍，开启访问权限的用户可以在 `页面-浏览书仓` 中选择批量导入到自己的书架进行阅读。

## 自定义阅读主题

书架页面仅支持白天模式和黑夜模式。

阅读页面支持设置多款主题，还可以自定义主题。自定义阅读主题包括:

- 自定义页面背景颜色
- 自定义浮窗背景颜色
- 自定义阅读背景颜色
- 自定义阅读背景图片

## 自定义样式

页面还会加载应用目录下的 `reader-assets/reader.css` 这个CSS样式文件，在这个文件中可以自定义页面样式。

> 自定义样式可能需要配合 `!important` 来设定属性

## 接口服务配置

```yml
reader:
  app:
    storagePath: storage   # 数据存储目录
    showUI: false          # 是否显示UI
    debug: false           # 是否调试模式
    packaged: false        # 是否打包为客户端
    secure: false          # 是否需要登录鉴权，开启后将支持多用户模式
    inviteCode: ""         # 注册邀请码，为空时则开放注册，否则注册时需要输入邀请码
    secureKey: ""          # 管理密码，开启鉴权时，前端管理用户空间的管理密码
    proxy: false           # 是否使用代理
    proxyType: "HTTP"      # 代理类型
    proxyHost: ""          # 代理 Host
    proxyPort: ""          # 代理 port
    proxyUsername: ""      # 代理鉴权 用户名
    proxyPassword: ""      # 代理鉴权 密码
    cacheChapterContent: false # 是否缓存章节内容
    userLimit: 50          # 用户上限，最大 50
    userBookLimit: 200     # 用户书籍上限，默认最大 200

  server:
    port: 8080             # 监听端口
    webUrl: http://localhost:${reader.server.port}    # web链接

```

## WebDAV同步配置

1. 首先需要在阅读App里面配置 `WebDAV备份`

    服务器地址： `http://IP:端口/reader3/webdav/`

    如果开启了 `reader.app.secure` 选项，那么使用网页注册的用户名和密码登录，否则使用用户名 `default` 和 密码 `123456` 登录

2. 然后在阅读App里面点击备份

3. 在网页里面查看WebDAV文件，确认是否备份成功

4. 备份成功之后
    - 服务器会自动同步书籍阅读进度(暂不支持章节内阅读位置，也不会自动同步书架信息变更)

    - 可以直接选择阅读App的备份文件进行恢复，这样会直接覆盖书源和书架信息

    - 可以备份当前书源和书架信息到WebDAV，但是必须要先备份成功

    - 需要通过恢复备份文件来同步书籍和书源信息

5. PS: 本地书源的书籍同步后无法打开，除非换源

## 客户端

### Windows / MacOS / Linux

从 [releases](https://github.com/hectorqin/reader/releases) 下载对应平台安装包安装即可，需要安装java10以上环境

MacOS 版 `storage` 默认是 `用户目录/.reader/storage`，其它版本 `storage` 默认是 `程序目录/storage`

#### 配置文件

`storage/windowConfig.json`

包含图形界面和接口服务的相关配置，JSON格式，修改后，程序重启才会生效

> 请仔细检查配置内容，不支持注释，此处注释只是为了方便理解

```json
{
    "serverPort": 8080,            // web服务端口，默认为 8080
    "showUI": true,                // 是否显示UI界面，默认为显示
    "debug": false,                // 是否调试模式，默认为否
    "positionX": 0.0,              // 窗口位置 横坐标
    "positionY": 0.0,              // 窗口位置 纵坐标
    "width": 1280.0,               // 窗口大小 宽度
    "height": 800.0,               // 窗口大小 高度
    "rememberSize": true,          // 改变窗口大小时，是否记住窗口大小，默认记住
    "rememberPosition": false,     // 移动窗口时，是否记住窗口位置，默认不记住
    "setWindowPosition": false,    // 启动时是否设置窗口位置，默认不设置，窗口默认居中
    "setWindowSize": true,         // 启动时是否设置窗口大小，默认按照配置文件进行设置
    "serverConfig": {                // 接口服务配置，此处配置会被 `serverPort|showUI|debug` 等覆盖
        "reader.app.secure": false,  // 是否需要登录鉴权，开启后将支持多用户模式
        "reader.app.inviteCode": "",  // 注册邀请码，为空时则开放注册，否则注册时需要输入邀请码。仅多用户模式下有效
        "reader.app.secureKey": "",  // 管理密码，开启鉴权时，前端管理用户空间的管理密码。仅多用户模式下有效
    }
}
```

### 手机端

使用docker版本或者服务器版本，访问web页面

可以添加为桌面应用

### 服务器版

从 [releases](https://github.com/hectorqin/reader/releases) 下载 `reader-$version.jar` 运行即可，需要安装java10以上环境

```bash
# 创建目录
mkdir reader3
cd reader3

# 下载 jar
wget "xxxx"

# 安装jdk10以上环境...

# 运行

# 自用版
java -jar reader-$version.jar

# 多用户版
java -jar reader-$version.jar --reader.app.secure=true --reader.app.secureKey=管理密码 --reader.app.inviteCode=注册邀请码

# web端 http://localhost:8080/
# 接口地址 http://localhost:8080/reader3/
```

### Docker版

```bash
# 自行编译
# docker build -t reader:latest .

# 使用环境变量覆盖服务配置，环境变量采用大写字母，不允许使用.-符号，采用下划线“_”取代点“.”  减号“-”直接删除

# docker run -d --restart=always --name=reader -e "SPRING_PROFILES_ACTIVE=prod" -v $(pwd)/logs:/logs -v $(pwd)/storage:/storage -p 8080:8080 reader:latest

# 跨平台镜像

# 新建构建器
# docker buildx create --use --name mybuilder
# 启动构建器
# docker buildx inspect mybuilder --bootstrap
# 查看构建器及其所支持的cpu架构
# docker buildx ls
# 构建跨平台镜像
# docker buildx build -t reader:latest --platform=linux/arm,linux/arm64,linux/amd64 . --push

# 使用预编译的镜像

# 自用版(建议修改映射端口)
docker run -d --restart=always --name=reader -e "SPRING_PROFILES_ACTIVE=prod" -v $(pwd)/logs:/logs -v $(pwd)/storage:/storage -p 8080:8080 hectorqin/reader

# 多用户版(建议修改映射端口)
docker run -d --restart=always --name=reader -v $(pwd)/logs:/logs -v $(pwd)/storage:/storage -p 8080:8080 hectorqin/reader java -jar /app/bin/reader.jar --spring.profiles.active=prod --reader.app.secure=true --reader.app.secureKey=管理密码 --reader.app.inviteCode=注册邀请码

# 多用户版 使用环境变量(建议修改映射端口)
docker run -d --restart=always --name=reader -e "SPRING_PROFILES_ACTIVE=prod" -e "READER_APP_SECURE=true" -e "READER_APP_SECUREKEY=管理密码" -e "READER_APP_INVITECODE=注册邀请码" -v $(pwd)/logs:/logs -v $(pwd)/storage:/storage -p 8080:8080 hectorqin/reader

# 更新docker镜像
# docker pull hectorqin/reader

#:后面的端口修改为映射端口
# web端 http://localhost:8080/
# 接口地址 http://localhost:8080/reader3/
```

### Docker-Compose版(推荐)

```bash
#安装docker-compose
#Debian/Ubuntu
apt install docker-compose -y
#CentOS
curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
docker-compose --version

# 下载项目里的 docker-compose.yaml
wget https://raw.githubusercontent.com/hectorqin/reader/master/docker-compose.yaml
# 更具 docker-compose.yaml 里面的注释编辑所需配置
# 启动 docker-compose
docker-compose up -d

# 停止 docker-compose
docker-compose stop
```

## Nginx反向代理

```nginx
server {
    listen 80;
    server_name 域名;
    #开启ssl解除注释
    #不使用宝塔获取证书脚本  https://github.com/Misaka-blog/acme-1key
    #listen 443 ssl;
    #ssl_certificate 证书.cer;
    #ssl_certificate_key 证书.key;
    #ssl_protocols TLSv1.1 TLSv1.2 TLSv1.3;
    #ssl_ciphers EECDH+CHACHA20:EECDH+CHACHA20-draft:EECDH+AES128:RSA+AES128:EECDH+AES256:RSA+AES256:EECDH+3DES:RSA+3DES:!MD5;
    #ssl_prefer_server_ciphers on;
    #ssl_session_cache shared:SSL:10m;
    #ssl_session_timeout 10m;
    #if ($server_port !~ 443){
    #    rewrite ^(/.*)$ https://$host$1 permanent;
    #}
    #error_page 497  https://$host$request_uri;

    gzip on; #开启gzip压缩
    gzip_min_length 1k; #设置对数据启用压缩的最少字节数
    gzip_buffers 4 16k;
    gzip_http_version 1.0;
    gzip_comp_level 6; #设置数据的压缩等级,等级为1-9，压缩比从小到大
    gzip_types text/plain text/css text/javascript application/json application/javascript application/x-javascript application/xml; #设置需要压缩的数据格式
    gzip_vary on;

    location / {
        proxy_pass  http://127.0.0.1:4396; #端口自行修改为映射端口
        proxy_http_version	1.1;
        proxy_cache_bypass	$http_upgrade;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Port  $server_port;
    }
}
```

## 开发编译

### 编译脚本

```bash
$ ./build.sh

USAGE: ./build.sh build|run|win|linux|mac|serve|cli|yarn|web|sync

build   调试打包
run     桌面端编译运行，需要先执行 sync 命令编译同步web资源
win     打包 windows 安装包
linux   打包 linux 安装包
mac     打包 mac 安装包
serve   服务端编译运行
cli     服务端打包命令
yarn    web页面 yarn 快捷命令，默认 install
web     开发web页面
sync    编译同步web资源
```

### 编译前端

```bash
cd web
# 启动开发服务 访问 http://localhost:8081/
# yarn serve

# 编译，并拷贝到 src/main/resources/web 目录
yarn sync
```

### 编译接口

```bash
./gradlew assemble --info

java -jar build/libs/reader-${version}.jar

# 指定 storage 路径  默认为相对路径 storage
# java -Dreader.app.storagePath=cacheStorage  -jar build/libs/reader-${version}.jar

# web端 http://localhost:8080/
# 接口地址 http://localhost:8080/reader3/
```

## 接口文档

与 [阅读3Web接口](https://github.com/gedoor/legado/blob/master/api.md) 基本一致，只是多了接口前缀 `/reader3/`

### 新增接口

#### 加入书架

- URL `http://localhost:8080/reader3/saveBook`
- Method `POST`
- Body `json 格式`

```JSON
{
    "infoHtml": "",
    "tocHtml": "",
    "bookUrl": "https://www.damixs.com/book/dmfz.html",
    "origin": "https://www.damixs.com",
    "originName": "🎉大米小说",
    "type": 0,
    "name": "道门法则",
    "author": "八宝饭",
    "kind": "02-14",
    "intro": "在道门掌控的天下，应该怎么修炼？符箓、丹药、道士、灵妖、斋醮科仪......想要修仙，很好，请从扫厕所开始做起！符诏到来的时候，你需要站在什么位置？Q群：1701556（需验证订阅截图）、954782460“盟主群”",
    "wordCount": "",
    "latestChapterTitle": "番外四（贺消脱止-M荣升盟主）",
    "tocUrl": "",
    "time": 1628756214810,
    "originOrder": 16
}
```

- Response Body

[Book字段参考](https://github.com/gedoor/legado/blob/master/app/src/main/java/io/legado/app/data/entities/Book.kt)

```JSON
{
    "isSuccess": true,
    "errorMsg": "",
    "data": Book
}
```

#### 获取书籍书源

- URL `http://localhost:8080/reader3/getBookSource?url=xxx`
- Method `GET`

获取指定URL对应的书源信息, 和 `阅读3Web接口` 的 `getSource` 接口相同

- Response Body

[SearchBook字段参考](https://github.com/gedoor/legado/blob/master/app/src/main/java/io/legado/app/data/entities/SearchBook.kt)

```JSON
{
    "isSuccess": true,
    "errorMsg": "",
    "data": [SearchBook]
}
```

#### 搜索书籍更多书源

- URL `http://localhost:8080/reader3/searchBookSource?name=xxx&lastIndex=0`
- Method `GET`

搜索指定name对应的书源列表信息

lastIndex 是上次搜索结果中返回的字段，默认为 0，可以传入 `getBookSource` 接口返回的SearchBook列表长度

- Response Body

[SearchBook字段参考](https://github.com/gedoor/legado/blob/master/app/src/main/java/io/legado/app/data/entities/SearchBook.kt)

```JSON
{
    "isSuccess": true,
    "errorMsg": "",
    "data": [SearchBook]
}
```

#### 书籍换源

- URL `http://localhost:8080/reader3/saveBookSource`
- Method `POST`
- Body `json 格式`

```JSON
{
    "newUrl": "新源书籍链接",
    "name": "书籍名称",
    "bookSourceUrl": "书源链接"
}
```

- Response Body

[Book字段参考](https://github.com/gedoor/legado/blob/master/app/src/main/java/io/legado/app/data/entities/Book.kt)

```JSON
{
    "isSuccess": true,
    "errorMsg": "",
    "data": Book
}
```
