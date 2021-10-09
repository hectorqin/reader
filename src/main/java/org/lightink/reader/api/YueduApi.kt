package org.lightink.reader.api

import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import io.legado.app.data.entities.SearchBook
import io.legado.app.data.entities.BookGroup
import io.legado.app.data.entities.BookSource
import io.legado.app.help.storage.OldRule
import io.legado.app.model.Debug
import io.legado.app.model.WebBook
import io.vertx.ext.web.Router
import io.vertx.ext.web.RoutingContext
import io.vertx.ext.web.handler.StaticHandler;
import mu.KotlinLogging
import org.lightink.reader.config.AppConfig
import org.lightink.reader.config.BookConfig
import org.lightink.reader.service.yuedu.constant.DeepinkBookSource
import org.lightink.reader.utils.error
import org.lightink.reader.utils.success
import org.lightink.reader.utils.getStorage
import org.lightink.reader.utils.saveStorage
import org.lightink.reader.utils.asJsonArray
import org.lightink.reader.utils.asJsonObject
import org.lightink.reader.utils.toDataClass
import org.lightink.reader.utils.toMap
import org.lightink.reader.utils.fillData
import org.lightink.reader.utils.getWorkDir
import org.lightink.reader.utils.getRandomString
import org.lightink.reader.utils.genEncryptedPassword
import org.lightink.reader.entity.User
import org.lightink.reader.utils.SpringContextUtils
import org.lightink.reader.utils.deleteRecursively
import org.lightink.reader.utils.unzip
import org.lightink.reader.utils.zip
import org.lightink.reader.utils.jsonEncode
import org.lightink.reader.utils.getRelativePath
import org.lightink.reader.verticle.RestVerticle
import org.lightink.reader.SpringEvent
import org.springframework.stereotype.Component
import io.vertx.core.json.JsonObject
import io.vertx.core.json.JsonArray
import io.vertx.core.http.HttpMethod
import org.lightink.reader.api.ReturnData
import io.legado.app.utils.MD5Utils
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.URL;
import java.util.UUID;
import io.vertx.ext.web.client.WebClient
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.core.env.Environment
import java.io.File
import java.lang.Runtime
import kotlin.collections.mutableMapOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat;
import io.legado.app.utils.EncoderUtils
import org.springframework.scheduling.annotation.Scheduled
import io.legado.app.localBook.LocalBook
import java.nio.file.Paths

private val logger = KotlinLogging.logger {}

@Component
class YueduApi : RestVerticle() {
    var bookInfoCache = mutableMapOf<String, Map<String, Any>>()

    @Autowired
    private lateinit var webClient: WebClient

    @Autowired
    private lateinit var appConfig: AppConfig

    @Autowired
    private lateinit var env: Environment

    override suspend fun initRouter(router: Router) {
        setupPort()

        // 旧版数据迁移
        migration()

        // 兼容阅读3 webapi
        router.post("/reader3/saveSource").coroutineHandler { saveSource(it) }
        router.post("/reader3/saveSources").coroutineHandler { saveSources(it) }

        router.get("/reader3/getSource").coroutineHandler { getSource(it) }
        router.get("/reader3/getSources").coroutineHandler { getSources(it) }
        router.post("/reader3/getSources").coroutineHandler { getSources(it) }

        router.post("/reader3/deleteSource").coroutineHandler { deleteSource(it) }
        router.post("/reader3/deleteSources").coroutineHandler { deleteSources(it) }

        router.get("/reader3/getBookshelf").coroutineHandler { getBookshelf(it) }
        router.get("/reader3/getShelfBook").coroutineHandler { getShelfBook(it) }
        router.post("/reader3/saveBook").coroutineHandler { saveBook(it) }
        router.post("/reader3/deleteBook").coroutineHandler { deleteBook(it) }

        // 探索
        router.post("/reader3/exploreBook").coroutineHandler { exploreBook(it) }
        router.get("/reader3/exploreBook").coroutineHandler { exploreBook(it) }

        // 搜索
        router.get("/reader3/searchBook").coroutineHandler { searchBook(it) }
        router.post("/reader3/searchBook").coroutineHandler { searchBook(it) }

        // 书籍详情
        router.get("/reader3/getBookInfo").coroutineHandler { getBookInfo(it) }
        router.post("/reader3/getBookInfo").coroutineHandler { getBookInfo(it) }

        // 章节列表
        router.get("/reader3/getChapterList").coroutineHandler { getChapterList(it) }
        router.post("/reader3/getChapterList").coroutineHandler { getChapterList(it) }

        // 内容
        router.get("/reader3/getBookContent").coroutineHandler { getBookContent(it) }
        router.post("/reader3/getBookContent").coroutineHandler { getBookContent(it) }

        // 封面
        router.get("/reader3/cover").coroutineHandlerWithoutRes { getBookCover(it) }

        // 搜索其它来源
        router.get("/reader3/searchBookSource").coroutineHandler { searchBookSource(it) }
        router.get("/reader3/getBookSource").coroutineHandler { getBookSource(it) }
        router.get("/reader3/getSource").coroutineHandler { getBookSource(it) }

        // 换源
        router.get("/reader3/saveBookSource").coroutineHandler { saveBookSource(it) }
        router.post("/reader3/saveBookSource").coroutineHandler { saveBookSource(it) }

        // 修改分组
        router.post("/reader3/saveBookGroupId").coroutineHandler { saveBookGroupId(it) }

        // web界面
        router.route("/*").handler(StaticHandler.create("web").setDefaultContentEncoding("UTF-8"));

        // assets
        var assetsDir = getWorkDir("storage", "assets");
        var assetsDirFile = File(assetsDir);
        if (!assetsDirFile.exists()) {
            assetsDirFile.mkdirs();
        }
        var assetsCss = getWorkDir("storage", "assets", "reader.css");
        var assetsCssFile = File(assetsCss);
        if (!assetsCssFile.exists()) {
            assetsCssFile.writeText("/* 在此处可以编写CSS样式来自定义页面 */");
        }
        router.route("/assets/*").handler(StaticHandler.create().setAllowRootFileSystemAccess(true).setWebRoot(assetsDir).setDefaultContentEncoding("UTF-8"));

        // epub资源
        var dataDir = getWorkDir("storage", "data");
        router.route("/epub/*").handler(StaticHandler.create().setAllowRootFileSystemAccess(true).setWebRoot(dataDir).setDefaultContentEncoding("UTF-8"));

        // 上传书源文件
        router.post("/reader3/readSourceFile").coroutineHandler { readSourceFile(it) }

        // 上传文件
        router.post("/reader3/uploadFile").coroutineHandler { uploadFile(it) }

        // 删除文件
        router.post("/reader3/deleteFile").coroutineHandler { deleteFile(it) }

        // 获取系统字体
        router.get("/reader3/getSystemInfo").coroutineHandler { getSystemInfo(it) }

        // 登录使用自定义书架
        router.post("/reader3/login").coroutineHandler { login(it) }

        // 获取用户信息
        router.get("/reader3/getUserInfo").coroutineHandler { getUserInfo(it) }

        // 用户备份本地配置
        router.post("/reader3/saveUserConfig").coroutineHandler { saveUserConfig(it) }

        // 用户恢复本地配置
        router.get("/reader3/getUserConfig").coroutineHandler { getUserConfig(it) }

        // 获取用户列表
        router.get("/reader3/getUserList").coroutineHandler { getUserList(it) }

        // 删除用户
        router.post("/reader3/deleteUsers").coroutineHandler { deleteUsers(it) }

        // 更新用户
        router.post("/reader3/updateUser").coroutineHandler { updateUser(it) }

        // 获取webdav备份列表
        router.get("/reader3/getWebdavFileList").coroutineHandler { getWebdavFileList(it) }

        // 下载webdav文件
        router.get("/reader3/getWebdavFile").coroutineHandlerWithoutRes { getWebdavFile(it) }

        // 删除webdav文件
        router.get("/reader3/deleteWebdavFile").coroutineHandler { deleteWebdavFile(it) }
        router.post("/reader3/deleteWebdavFile").coroutineHandler { deleteWebdavFile(it) }
        router.post("/reader3/deleteWebdavFileList").coroutineHandler { deleteWebdavFileList(it) }

        // 从webdav备份恢复
        router.post("/reader3/restoreFromWebdav").coroutineHandler { restoreFromWebdav(it) }

        // 备份到webdav
        router.post("/reader3/backupToWebdav").coroutineHandler { backupToWebdav(it) }

        // 导入本地文件
        router.post("/reader3/importBookPreview").coroutineHandler { importBookPreview(it) }

        // 书籍分组
        router.get("/reader3/getBookGroups").coroutineHandler { getBookGroups(it) }
        router.post("/reader3/saveBookGroup").coroutineHandler { saveBookGroup(it) }
        router.post("/reader3/deleteBookGroup").coroutineHandler { deleteBookGroup(it) }


        // webdav 服务
        router.route("/reader3/webdav*").handler {
            it.addHeadersEndHandler { _ ->
                var res = it.response()
                res.putHeader("DAV", "1,2")
                res.putHeader("Access-Control-Allow-Origin", "*")
                res.putHeader("Access-Control-Allow-Credentials", "true")
                res.putHeader("Access-Control-Expose-Headers", "DAV, content-length, Allow")
                res.putHeader("MS-Author-Via", "DAV")
                res.putHeader("Allow", "OPTIONS,DELETE,GET,PUT,PROPFIND,MKCOL,MOVE,COPY,LOCK,UNLOCK")
                if (appConfig.secure) {
                    res.putHeader("WWW-Authenticate", "Basic realm=\"Default realm\"")
                }
            }
            val rawMethod = it.request().rawMethod()
            if (!checkAuthorization(it)) {
                if (
                    rawMethod == "PROPFIND" ||
                    rawMethod == "MKCOL" ||
                    rawMethod == "PUT" ||
                    rawMethod == "GET" ||
                    rawMethod == "DELETE" ||
                    rawMethod == "MOVE" ||
                    rawMethod == "COPY" ||
                    rawMethod == "LOCK" ||
                    rawMethod == "UNLOCK"
                ) {
                    it.response().setStatusCode(401).end()
                    return@handler
                } else if(rawMethod == "OPTIONS") {
                    var authorization = it.request().getHeader("Authorization")
                    if (authorization != null) {
                        it.response().setStatusCode(401).end()
                        return@handler
                    }
                }
            }
            when (rawMethod) {
                "PROPFIND" -> launch(Dispatchers.IO) {
                    try {
                        webdavList(it)
                    } catch (e: Exception) {
                        onHandlerError(it, e)
                    }
                }
                "MKCOL" -> launch(Dispatchers.IO) {
                    try {
                        webdavMkdir(it)
                    } catch (e: Exception) {
                        onHandlerError(it, e)
                    }
                }
                "PUT" -> launch(Dispatchers.IO) {
                    try {
                        webdavUpload(it)
                    } catch (e: Exception) {
                        onHandlerError(it, e)
                    }
                }
                "GET" -> launch(Dispatchers.IO) {
                    try {
                        webdavDownload(it)
                    } catch (e: Exception) {
                        onHandlerError(it, e)
                    }
                }
                "DELETE" -> launch(Dispatchers.IO) {
                    try {
                        webdavDelete(it)
                    } catch (e: Exception) {
                        onHandlerError(it, e)
                    }
                }
                "MOVE" -> launch(Dispatchers.IO) {
                    try {
                        webdavMove(it)
                    } catch (e: Exception) {
                        onHandlerError(it, e)
                    }
                }
                "COPY" -> launch(Dispatchers.IO) {
                    try {
                        webdavCopy(it)
                    } catch (e: Exception) {
                        onHandlerError(it, e)
                    }
                }
                "LOCK" -> launch(Dispatchers.IO) {
                    try {
                        webdavLock(it)
                    } catch (e: Exception) {
                        onHandlerError(it, e)
                    }
                }
                "UNLOCK" -> launch(Dispatchers.IO) {
                    try {
                        webdavUnLock(it)
                    } catch (e: Exception) {
                        onHandlerError(it, e)
                    }
                }
                "OPTIONS" -> it.response().setStatusCode(200).end()
                else -> it.response().setStatusCode(405).end()
            }
        }

        // 加载书籍详情缓存
        loadBookCacheInfo();
    }

    suspend fun setupPort() {
        logger.info("port: {}", port)
        var serverPort = env.getProperty("reader.server.port", Int::class.java)
        logger.info("serverPort: {}", serverPort)
        if (serverPort != null && serverPort > 0) {
            port = serverPort;
        }
    }

    suspend fun migration() {
        try {
            var dataDir = File(getWorkDir("storage", "data", "default"))
            if (!dataDir.exists()) {
                var storageDir = File(getWorkDir("storage"))
                if (storageDir.exists()) {
                    var backupDir = File(getWorkDir("storage-backup"))
                    storageDir.renameTo(backupDir)
                    dataDir.parentFile.mkdirs()
                    backupDir.copyRecursively(dataDir)
                }
            }
        } catch(e: Exception) {
            e.printStackTrace()
        }
    }

    override fun started() {
        SpringContextUtils.getApplicationContext().publishEvent(SpringEvent(this as java.lang.Object, "READY", ""));
    }

    override fun onStartError() {
        SpringContextUtils.getApplicationContext().publishEvent(SpringEvent(this as java.lang.Object, "START_ERROR", "应用启动失败，请检查" + port + "端口是否被占用"));
    }

    override fun onHandlerError(ctx: RoutingContext, error: Exception) {
        val returnData = ReturnData()
        logger.error("onHandlerError: ", error)
        if (!ctx.response().headWritten()) {
            ctx.success(returnData.setData(error).setErrorMsg(error.toString()))
        } else {
            ctx.response().end(error.toString())
        }
    }

    private fun checkAuthorization(context: RoutingContext): Boolean {
        if (!appConfig.secure) {
            return true
        }
        var authorization = context.request().getHeader("Authorization")
        logger.info("authorization: {}", authorization)
        if (authorization == null || authorization.isEmpty()) {
            return false
        }

        // Basic YTox
        val auth = EncoderUtils.base64Decode(authorization.replace("Basic ", "", true)).split(":", limit=2)
        if (auth.size < 2) {
            return false
        }
        val username = auth[0]
        val password = auth[1]
        var userMap = mutableMapOf<String, Map<String, Any>>()
        var userMapJson: JsonObject? = asJsonObject(getStorage("data", "users"))
        if (userMapJson != null) {
            userMap = userMapJson.map as MutableMap<String, Map<String, Any>>
        }
        var existedUser = userMap.getOrDefault(username, null)
        if (existedUser == null) {
            return false
        }
        var userInfo: User? = existedUser.toDataClass()
        if (userInfo == null) {
            return false
        }
        var passwordEncrypted = genEncryptedPassword(password, userInfo.salt)
        if (passwordEncrypted != userInfo.password) {
            return false
        }

        if (!userInfo.enable_webdav) {
            return false
        }

        context.put("username", userInfo.username)

        return true
    }

    private suspend fun getUserWebdavHome(context: Any): String {
        var prefix = getWorkDir("storage", "data")
        var userNameSpace = ""
        when(context) {
            is RoutingContext -> userNameSpace = getUserNameSpace(context)
            is String -> userNameSpace = context
        }
        if (userNameSpace.isNotEmpty()) {
            prefix = prefix + File.separator + userNameSpace
        }
        prefix = prefix + File.separator + "webdav"
        var file = File(prefix)
        if (!file.exists()) {
            file.mkdirs()
        }
        return prefix
    }

    private suspend fun webdavList(context: RoutingContext) {
        var home = getUserWebdavHome(context)
        var path = context.request().path().replace("/reader3/webdav/", "/", true)
        path = URLDecoder.decode(path, "UTF-8")
        var file = File(home + path)
        if (!file.exists()) {
            context.response().setStatusCode(404).end()
            return
        }

        var xml =
        """<?xml version="1.0" encoding="utf-8"?>
            <D:multistatus xmlns:D="DAV:">
                %s
            </D:multistatus>
        """

        var dirResponse =
        """<D:response>
                <D:href>%s</D:href>
                <D:propstat>
                    <D:status>HTTP/1.1 200 OK</D:status>
                    <D:prop>
                        <D:getlastmodified>%s</D:getlastmodified>
                        <D:creationdate>%s</D:creationdate>
                        <D:resourcetype>
                            <D:collection />
                        </D:resourcetype>
                        <D:displayname>%s</D:displayname>
                    </D:prop>
                </D:propstat>
            </D:response>
        """

        var fileResponse =
        """<D:response>
                <D:href>%s</D:href>
                <D:propstat>
                    <D:status>HTTP/1.1 200 OK</D:status>
                    <D:prop>
                        <D:getlastmodified>%s</D:getlastmodified>
                        <D:creationdate>%s</D:creationdate>
                        <D:resourcetype />
                        <D:displayname>%s</D:displayname>
                        <D:getcontentlength>%s</D:getcontentlength>
                        <D:getcontenttype>%s</D:getcontenttype>
                    </D:prop>
                </D:propstat>
            </D:response>
        """

        var fileUrl = context.request().absoluteURI()

        // 只支持一级
        var formatter = { f: File, url: String, showName: Boolean ->
            var name = if(showName) f.name else ""
            var modifiedDate = SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(f.lastModified())
            if (f.isFile()) {
                String.format(fileResponse, url, modifiedDate, modifiedDate, name, f.length(), "")
            } else {
                String.format(dirResponse, url, modifiedDate, modifiedDate, name)
            }
        }

        var response = ""
        if (file.isFile()) {
            response = String.format(xml, formatter(file, fileUrl, true))
            context.response().setStatusCode(207).end(response)
            return
        }

        if (file.isDirectory()) {
            fileUrl = if (fileUrl.endsWith("/")) fileUrl else fileUrl + "/"
            response = formatter(file, fileUrl, false)
            file.listFiles().forEach {
                val fileName = URLEncoder.encode(it.name, "UTF-8")
                response = response + formatter(it, fileUrl + fileName, true)
            }
            response = String.format(xml, response)
            context.response().setStatusCode(207).end(response)
            return
        }

        context.response().setStatusCode(404).end()
    }

    private suspend fun webdavMkdir(context: RoutingContext) {
        var home = getUserWebdavHome(context)
        var path = context.request().path().replace("/reader3/webdav/", "/", true)
        path = URLDecoder.decode(path, "UTF-8")
        var file = File(home + path)
        if (file.exists()) {
            context.response().setStatusCode(405).end()
            return
        }
        try {
            file.mkdirs()
            context.response().setStatusCode(201).end()
        } catch(e: Exception) {
            context.response().setStatusCode(500).end()
        }
    }

    private suspend fun webdavUpload(context: RoutingContext) {
        var home = getUserWebdavHome(context)
        var path = context.request().path().replace("/reader3/webdav/", "/", true)
        path = URLDecoder.decode(path, "UTF-8")
        var file = File(home + path)
        if (!file.parentFile.exists()) {
            context.response().setStatusCode(409).end()
            return
        }
        if (file.isDirectory()) {
            context.response().setStatusCode(405).end()
            return
        }
        if (file.exists()) {
            file.delete();
        }
        try {
            file.writeBytes(context.getBody().getBytes())
            // 同步用户进度
            if (file.toString().indexOf("/bookProgress/") > 0 && file.toString().indexOf(".json") > 0) {
                val userNameSpace = getUserNameSpace(context)
                syncBookProgressFromWebdav(file, userNameSpace)
            }
            context.response().setStatusCode(201).end()
        } catch(e: Exception) {
            context.response().setStatusCode(500).end()
        }
    }

    private suspend fun webdavDownload(context: RoutingContext) {
        var home = getUserWebdavHome(context)
        var path = context.request().path().replace("/reader3/webdav/", "/", true)
        path = URLDecoder.decode(path, "UTF-8")
        var file = File(home + path)
        if (!file.exists()) {
            context.response().setStatusCode(404).end()
            return
        }
        if (file.isDirectory()) {
            context.response().setStatusCode(405).end()
            return
        }
        context.response().putHeader("Cache-Control", "86400").sendFile(file.toString())
    }

    private suspend fun webdavDelete(context: RoutingContext) {
        var home = getUserWebdavHome(context)
        var path = context.request().path().replace("/reader3/webdav/", "/", true)
        path = URLDecoder.decode(path, "UTF-8")
        var file = File(home + path)
        if (!file.exists()) {
            context.response().setStatusCode(404).end()
            return
        }
        file.deleteRecursively()
        context.response().setStatusCode(200).end()
    }

    private suspend fun webdavMove(context: RoutingContext) {
        var home = getUserWebdavHome(context)
        var path = context.request().path().replace("/reader3/webdav/", "/", true)
        path = URLDecoder.decode(path, "UTF-8")

        var file = File(home + path)
        if (!file.exists()) {
            context.response().setStatusCode(412).end()
            return
        }
        var destination = context.request().getHeader("Destination")
        if (destination == null) {
            context.response().setStatusCode(400).end()
            return
        }
        var destinationUrl = URL(destination)
        destination = destinationUrl.path?.replace("/reader3/webdav/", "/", true)
        if (destination == null) {
            context.response().setStatusCode(400).end()
            return
        }

        var overwrite = context.request().getHeader("Overwrite")
        var destinationFile = File(home + URLDecoder.decode(destination, "UTF-8"))
        if (destinationFile.exists()) {
            if (overwrite == null || overwrite.isEmpty()) {
                context.response().setStatusCode(412).end()
                return
            }
            destinationFile.deleteRecursively()
        }
        file.renameTo(destinationFile)

        context.response().setStatusCode(201).end()
    }

    private suspend fun webdavCopy(context: RoutingContext) {
        var home = getUserWebdavHome(context)
        var path = context.request().path().replace("/reader3/webdav/", "/", true)
        path = URLDecoder.decode(path, "UTF-8")

        var file = File(home + path)
        if (!file.exists()) {
            context.response().setStatusCode(412).end()
            return
        }
        var destination = context.request().getHeader("Destination")
        if (destination == null) {
            context.response().setStatusCode(400).end()
            return
        }
        var destinationUrl = URL(destination)
        destination = destinationUrl.path?.replace("/reader3/webdav/", "/", true)
        if (destination == null) {
            context.response().setStatusCode(400).end()
            return
        }

        var overwrite = context.request().getHeader("Overwrite")
        var destinationFile = File(home + URLDecoder.decode(destination, "UTF-8"))
        if (destinationFile.exists()) {
            if (overwrite == null || overwrite.isEmpty()) {
                context.response().setStatusCode(412).end()
                return
            }
            destinationFile.deleteRecursively()
        }
        file.copyRecursively(destinationFile)

        context.response().setStatusCode(201).end()
    }

    private suspend fun webdavLock(context: RoutingContext) {
        var response =
        """<?xml version="1.0" encoding="utf-8"?>
        <D:prop xmlns:D="DAV:">
            <D:lockdiscovery>
                <D:activelock>
                    <D:locktype>
                        <write />
                    </D:locktype>
                    <D:lockscope>
                        <exclusive />
                    </D:lockscope>
                    <D:locktoken>
                        <D:href>%s</D:href>
                    </D:locktoken>
                    <D:lockroot>
                        <D:href>%s</D:href>
                    </D:lockroot>
                    <D:depth>infinity</D:depth>
                    <D:owner>
                        <a:href xmlns:a="DAV:">http://www.apple.com/webdav_fs/</a:href>
                    </D:owner>
                    <D:timeout>%s</D:timeout>
                </D:activelock>
            </D:lockdiscovery>
        </D:prop>
        """
        var lockToken = "urn:uuid:" + UUID.randomUUID().toString()

        var timeout = context.request().getHeader("Timeout")
        if (timeout == null) {
            timeout = "Second-3600"
        }

        var fileUrl = context.request().absoluteURI()

        context.response().putHeader("Lock-Token", lockToken).setStatusCode(200).end(String.format(response, lockToken, fileUrl, timeout))
    }

    private suspend fun webdavUnLock(context: RoutingContext) {
        var lockToken = context.request().getHeader("Lock-Token")
        if (lockToken == null) {
            context.response().setStatusCode(400).end()
            return
        }
        context.response().putHeader("Lock-Token", lockToken).setStatusCode(204).end()
    }

    private suspend fun login(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        val username = context.bodyAsJson.getString("username") ?: ""
        val password = context.bodyAsJson.getString("password") ?: ""
        if (username.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入用户名")
        }
        if (password.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入密码")
        }
        var userMap = mutableMapOf<String, Map<String, Any>>()
        var userMapJson: JsonObject? = asJsonObject(getStorage("data", "users"))
        if (userMapJson != null) {
            userMap = userMapJson.map as MutableMap<String, Map<String, Any>>
        }
        var existedUser = userMap.getOrDefault(username, null)
        if (existedUser == null) {
            if (username.length < 5) {
                return returnData.setErrorMsg("用户名不能低于5位")
            }
            if (password.length < 8) {
                return returnData.setErrorMsg("密码不能低于8位")
            }
            if (username.equals("default")) {
                return returnData.setErrorMsg("用户名不能为非法字符")
            }
            val usernameReg = Regex("[a-z0-9]+", RegexOption.IGNORE_CASE)    //忽略大小写
            if (!usernameReg.matches(username)) {
                return returnData.setErrorMsg("用户名只能由字母和数字组成")
            }
            if (appConfig.inviteCode.isNotEmpty()) {
                // 需要填入邀请码才能注册
                val code = context.bodyAsJson.getString("code") ?: ""
                if (code.isNullOrEmpty()) {
                    return returnData.setErrorMsg("请输入邀请码")
                }
                if (!appConfig.inviteCode.equals(code)) {
                    return returnData.setErrorMsg("邀请码错误")
                }
            }

            // 自动注册
            var salt = getRandomString(8)
            var passwordEncrypted = genEncryptedPassword(password, salt)
            var newUser = User(username, passwordEncrypted, salt)

            val loginData = saveUserSession(context, userMap, newUser)
            return returnData.setData(loginData)
        } else {
            // 登录
            var userInfo: User? = existedUser.toDataClass()
            if (userInfo == null) {
                return returnData.setErrorMsg("用户信息错误")
            }
            var passwordEncrypted = genEncryptedPassword(password, userInfo.salt)
            if (passwordEncrypted != userInfo.password) {
                return returnData.setErrorMsg("密码错误")
            }
            val loginData = saveUserSession(context, userMap, userInfo)
            return returnData.setData(loginData)
        }
    }

    private suspend fun saveUserSession(context: RoutingContext, userMap: MutableMap<String, Map<String, Any>>, user: User, regenerateToken: Boolean = true): Map<String, Any> {
        user.last_login_at = System.currentTimeMillis()
        if (regenerateToken) {
            user.token = genEncryptedPassword(user.username, System.currentTimeMillis().toString())
        }
        userMap.put(user.username, user.toMap())
        saveStorage("data", "users", value = userMap)

        val loginData = formatUser(user)

        context.session().put("username", user.username)
        context.put("username", user.username)

        return loginData
    }

    private suspend fun getUserList(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (!appConfig.secure || appConfig.secureKey.isEmpty()) {
            return returnData.setErrorMsg("不支持的操作")
        }
        if (!checkManagerAuth(context)) {
            return returnData.setData("NEED_SECURE_KEY").setErrorMsg("请输入管理密码")
        }
        var userMap = mutableMapOf<String, MutableMap<String, Any>>()
        var userMapJson: JsonObject? = asJsonObject(getStorage("data", "users"))
        if (userMapJson != null) {
            userMap = userMapJson.map as MutableMap<String, MutableMap<String, Any>>
        }
        var userList = arrayListOf<Map<String, Any>>()
        userMap.forEach{
            userList.add(formatUser(it.value))
        }
        return returnData.setData(userList)
    }

    private suspend fun deleteUsers(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (!appConfig.secure || appConfig.secureKey.isEmpty()) {
            return returnData.setErrorMsg("不支持的操作")
        }
        if (!checkManagerAuth(context)) {
            return returnData.setData("NEED_SECURE_KEY").setErrorMsg("请输入管理密码")
        }
        var userMap = mutableMapOf<String, MutableMap<String, Any>>()
        var userMapJson: JsonObject? = asJsonObject(getStorage("data", "users"))

        if (userMapJson != null) {
            val userJsonArray = context.bodyAsJsonArray
            for (i in 0 until userJsonArray.size()) {
                var username = userJsonArray.getString(i)
                if (username != null && userMapJson.containsKey(username)) {
                    // 删除用户信息
                    userMapJson.remove(username)
                    // 移除用户目录
                    var userHome = File(getWorkDir("storage", "data", username))
                    logger.info("delete userHome: {}", userHome)
                    if (userHome.exists()) {
                        userHome.deleteRecursively()
                    }
                }
            }
            userMap = userMapJson.map as MutableMap<String, MutableMap<String, Any>>
            saveStorage("data", "users", value = userMap)
        }

        var userList = arrayListOf<Map<String, Any>>()
        userMap.forEach{
            userList.add(formatUser(it.value))
        }
        return returnData.setData(userList)
    }

    private suspend fun updateUser(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (!appConfig.secure || appConfig.secureKey.isEmpty()) {
            return returnData.setErrorMsg("不支持的操作")
        }
        if (!checkManagerAuth(context)) {
            return returnData.setData("NEED_SECURE_KEY").setErrorMsg("请输入管理密码")
        }
        val username = context.bodyAsJson.getString("username") ?: ""
        val enableWebdav = context.bodyAsJson.getBoolean("enableWebdav")
        if (username.isEmpty()) {
            return returnData.setErrorMsg("参数错误")
        }

        var userMap = mutableMapOf<String, MutableMap<String, Any>>()
        var userMapJson: JsonObject? = asJsonObject(getStorage("data", "users"))

        if (userMapJson != null) {
            userMap = userMapJson.map as MutableMap<String, MutableMap<String, Any>>
            var existedUser = userMap.getOrDefault(username, null)
            if (existedUser == null) {
                return returnData.setErrorMsg("用户不存在")
            }
            if (enableWebdav != null) {
                existedUser.put("enable_webdav", enableWebdav)
            }
            userMap.put(username, existedUser)
            saveStorage("data", "users", value = userMap)
        }

        var userList = arrayListOf<Map<String, Any>>()
        userMap.forEach{
            userList.add(formatUser(it.value))
        }
        return returnData.setData(userList)
    }

    private suspend fun getUserInfo(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        checkAuth(context)
        var username = context.session().get("username") as String?
        var secure = env.getProperty("reader.app.secure", Boolean::class.java)
        var secureKey = env.getProperty("reader.app.secureKey")

        var userInfo: Any? = null
        if (username != null) {
            var user = getUserInfoClass(username)
            if (user != null) {
                userInfo = formatUser(user)
            }
        }

        return returnData.setData(mapOf(
            "userInfo" to userInfo,
            "secure" to secure,
            "secureKey" to secureKey?.isNotEmpty()
        ))
    }

    private suspend fun saveUserConfig(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val content = context.bodyAsJson
        if (content == null) {
            return returnData.setErrorMsg("参数错误")
        }
        val userNameSpace = getUserNameSpace(context)
        saveUserStorage(userNameSpace, "userConfig", content)
        return returnData.setData("")
    }

    private suspend fun getUserConfig(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val userNameSpace = getUserNameSpace(context)
        val userConfig = asJsonObject(getUserStorage(userNameSpace, "userConfig"))
        if (userConfig == null) {
            return returnData.setErrorMsg("没有备份文件")
        }
        return returnData.setData(userConfig.map)
    }

    private suspend fun getWebdavFileList(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (appConfig.secure) {
            var userInfo = context.get("userInfo") as User?
            if (userInfo == null) {
                return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
            }
            if (!userInfo.enable_webdav) {
                return returnData.setErrorMsg("未开启webdav功能")
            }
        }
        var path: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            path = context.bodyAsJson.getString("path") ?: ""
        } else {
            // get 请求
            path = context.queryParam("path").firstOrNull() ?: ""
        }
        if (path.isEmpty()) {
            path = "/"
        }
        path = URLDecoder.decode(path, "UTF-8")
        var home = getUserWebdavHome(context)
        var file = File(home + path)
        logger.info("file: {} {}", path, file)
        if (!file.exists()) {
            return returnData.setErrorMsg("路径不存在")
        }
        if (!file.isDirectory()) {
            return returnData.setErrorMsg("路径不是目录")
        }
        var fileList = arrayListOf<Map<String, Any>>()
        file.listFiles().forEach{
            if (!it.name.startsWith(".")) {
                fileList.add(mapOf(
                    "name" to it.name,
                    "size" to it.length(),
                    "path" to it.toString().replace(home, ""),
                    "lastModified" to it.lastModified(),
                    "isDirectory" to it.isDirectory()
                ))
            }
        }
        return returnData.setData(fileList)
    }

    private suspend fun getWebdavFile(context: RoutingContext) {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            context.success(returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用"))
            return
        }
        if (appConfig.secure) {
            var userInfo = context.get("userInfo") as User?
            if (userInfo == null) {
                context.success(returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用"))
                return
            }
            if (!userInfo.enable_webdav) {
                context.success(returnData.setErrorMsg("未开启webdav功能"))
                return
            }
        }
        var path: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            path = context.bodyAsJson.getString("path") ?: ""
        } else {
            // get 请求
            path = context.queryParam("path").firstOrNull() ?: ""
        }
        if (path.isEmpty()) {
            context.success(returnData.setErrorMsg("参数错误"))
            return
        }
        path = URLDecoder.decode(path, "UTF-8")
        var home = getUserWebdavHome(context)
        var file = File(home + path)
        logger.info("file: {} {}", path, file)
        if (!file.exists()) {
            context.success(returnData.setErrorMsg("路径不存在"))
            return
        }
        context.response().putHeader("Cache-Control", "86400").sendFile(file.toString())
    }

    private suspend fun deleteWebdavFile(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (appConfig.secure) {
            var userInfo = context.get("userInfo") as User?
            if (userInfo == null) {
                return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
            }
            if (!userInfo.enable_webdav) {
                return returnData.setErrorMsg("未开启webdav功能")
            }
        }
        var path: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            path = context.bodyAsJson.getString("path") ?: ""
        } else {
            // get 请求
            path = context.queryParam("path").firstOrNull() ?: ""
        }
        if (path.isEmpty()) {
            return returnData.setErrorMsg("参数错误")
        }
        path = URLDecoder.decode(path, "UTF-8")
        var home = getUserWebdavHome(context)
        var file = File(home + path)
        logger.info("file: {} {}", path, file)
        if (!file.exists()) {
            return returnData.setErrorMsg("路径不存在")
        }
        file.deleteRecursively()
        return returnData.setData("")
    }


    private suspend fun deleteWebdavFileList(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (appConfig.secure) {
            var userInfo = context.get("userInfo") as User?
            if (userInfo == null) {
                return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
            }
            if (!userInfo.enable_webdav) {
                return returnData.setErrorMsg("未开启webdav功能")
            }
        }
        var path = context.bodyAsJson.getJsonArray("path")
        if (path == null) {
            return returnData.setErrorMsg("参数错误")
        }
        var home = getUserWebdavHome(context)
        path.forEach {
            var filePath = URLDecoder.decode(it as String? ?: "", "UTF-8")
            if (filePath.isNotEmpty()) {
                var file = File(home + filePath)
                file.deleteRecursively()
            }
        }
        return returnData.setData("")
    }

    private suspend fun restoreFromWebdav(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (appConfig.secure) {
            var userInfo = context.get("userInfo") as User?
            if (userInfo == null) {
                return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
            }
            if (!userInfo.enable_webdav) {
                return returnData.setErrorMsg("未开启webdav功能")
            }
        }
        var path: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            path = context.bodyAsJson.getString("path") ?: ""
        } else {
            // get 请求
            path = context.queryParam("path").firstOrNull() ?: ""
        }
        if (path.isEmpty()) {
            path = "/"
        }
        path = URLDecoder.decode(path, "UTF-8")
        var ext = getFileExt(path)
        if (ext != "zip") {
            return returnData.setErrorMsg("路径不是zip备份文件")
        }
        var home = getUserWebdavHome(context)
        var file = File(home + path)
        logger.info("file: {} {}", path, file)
        if (!file.exists()) {
            return returnData.setErrorMsg("路径不存在")
        }
        if (!syncFromWebdav(file.toString(), getUserNameSpace(context))) {
            return returnData.setErrorMsg("恢复失败")
        }
        return returnData.setData("")
    }

    private suspend fun backupToWebdav(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (appConfig.secure) {
            var userInfo = context.get("userInfo") as User?
            if (userInfo == null) {
                return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
            }
            if (!userInfo.enable_webdav) {
                return returnData.setErrorMsg("未开启webdav功能")
            }
        }
        val userNameSpace = getUserNameSpace(context)
        var latestZipFilePath = getLastBackFileFromWebdav(userNameSpace)
        if (latestZipFilePath == null) {
            return returnData.setErrorMsg("请先使用阅读App备份到webdav")
        }
        if (!saveToWebdav(latestZipFilePath, userNameSpace)) {
            return returnData.setErrorMsg("备份失败")
        }
        return returnData.setData("")
    }

    private suspend fun checkAuth(context: RoutingContext): Boolean {
        if (!appConfig.secure) {
            return true
        }
        var username = context.session().get("username") as String? ?: ""
        var userInfo = getUserInfoClass(username)
        if (userInfo != null) {
            context.put("username", userInfo.username)
            context.put("userInfo", userInfo)
            return true
        }
        // 自动登录
        var accessToken = context.queryParam("accessToken").firstOrNull() ?: ""
        if (accessToken.isNotEmpty()) {
            var userMap = mutableMapOf<String, Map<String, Any>>()
            var userMapJson: JsonObject? = asJsonObject(getStorage("data", "users"))
            if (userMapJson != null) {
                userMap = userMapJson.map as? MutableMap<String, Map<String, Any>> ?: mutableMapOf<String, Map<String, Any>>()
            }
            var tmp = accessToken.split(":", limit=2)
            if (tmp.size >= 2) {
                var _username = tmp[0]
                var token = tmp[1]
                var existedUser: User? = userMap.getOrDefault(_username, null)?.toDataClass()
                if (existedUser != null && existedUser.token.isNotEmpty() && token.isNotEmpty() && existedUser.token.equals(token)) {
                    // 保存用户session
                    saveUserSession(context, userMap, existedUser, false)
                    context.put("username", existedUser.username)
                    context.put("userInfo", existedUser)
                    return true
                }
            }
        }

        return false
    }

    private suspend fun checkManagerAuth(context: RoutingContext): Boolean {
        if (!appConfig.secure) {
            return true
        }
        if (appConfig.secureKey.isEmpty()) {
            return true
        }
        var secureKey = context.queryParam("secureKey").firstOrNull() ?: ""
        if (secureKey.equals(appConfig.secureKey)) {
            // 判断是否需要修改 userNameSpace
            var userNS = context.queryParam("userNS").firstOrNull()
            if (userNS != null && userNS.isNotEmpty()) {
                context.put("userNameSpace", userNS)
            }
            return true
        }
        return false
    }

    private suspend fun getUserNameSpace(context: RoutingContext): String {
        if (!appConfig.secure) {
            return "default"
        }
        // 管理权限，可以修改 userNameSpace 来获取任意用户信息
        checkManagerAuth(context)
        var userNS = context.get("userNameSpace") as String?
        if (userNS != null && userNS.isNotEmpty()) {
            return userNS
        }
        var username = context.get("username") as String?
        if (username != null) {
            return username;
        }
        return "default"
    }

    private suspend fun getUserStorage(context: Any, vararg path: String): String? {
        var userNameSpace = ""
        when(context) {
            is RoutingContext -> userNameSpace = getUserNameSpace(context)
            is String -> userNameSpace = context
        }
        if (userNameSpace.isEmpty()) {
            return getStorage("data", *path)
        }
        return getStorage("data", userNameSpace, *path)
    }

    private suspend fun saveUserStorage(context: Any, path: String, value: Any) {
        var userNameSpace = ""
        when(context) {
            is RoutingContext -> userNameSpace = getUserNameSpace(context)
            is String -> userNameSpace = context
        }
        if (userNameSpace.isEmpty()) {
            return saveStorage("data", path, value = value)
        }
        return saveStorage("data", userNameSpace, path, value = value)
    }

    private suspend fun getSystemInfo(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        var systemFont = System.getProperty("reader.system.fonts")
        var freeMemory = "" + (Runtime.getRuntime().freeMemory() / 1024 / 1024) + "M"
        var totalMemory = "" + (Runtime.getRuntime().totalMemory() / 1024 / 1024) + "M"
        var maxMemory = "" + (Runtime.getRuntime().maxMemory() / 1024 / 1024) + "M"
        return returnData.setData(mapOf(
            "fonts" to systemFont,
            "freeMemory" to freeMemory,
            "totalMemory" to totalMemory,
            "maxMemory" to maxMemory
        ))
    }

    private suspend fun getBookInfo(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        var bookUrl: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            bookUrl = context.bodyAsJson.getString("url") ?: context.bodyAsJson.getJsonObject("searchBook").getString("bookUrl") ?: ""
        } else {
            // get 请求
            bookUrl = context.queryParam("url").firstOrNull() ?: ""
        }
        if (bookUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入书籍链接")
        }
        bookUrl = URLDecoder.decode(bookUrl, "UTF-8")
        logger.info("getBookInfo with bookUrl: {}", bookUrl)
        var bookInfo: Book? = null
        if (checkAuth(context)) {
            bookInfo = getShelfBookByURL(bookUrl, getUserNameSpace(context))
        }
        if (bookInfo == null) {
            // 看看有没有缓存数据
            var bookSource: String? = null
            var cacheInfo: Book? = bookInfoCache.get(bookUrl)?.toDataClass()
            if (cacheInfo != null) {
                // 使用缓存的书籍信息包含的书源
                bookSource = getBookSourceString(context, cacheInfo.origin)
            } else {
                bookSource = getBookSourceString(context)
            }
            if (bookSource.isNullOrEmpty()) {
                return returnData.setErrorMsg("未配置书源")
            }
            bookInfo = mergeBookCacheInfo(WebBook(bookSource).getBookInfo(bookUrl))
        }

        return returnData.setData(bookInfo)
    }

    private suspend fun getBookCover(context: RoutingContext) {
        var coverUrl = context.queryParam("path").firstOrNull() ?: ""
        if (coverUrl.isNullOrEmpty()) {
            context.response().setStatusCode(404).end()
            return
        }
        coverUrl = URLDecoder.decode(coverUrl, "UTF-8")
        var ext = getFileExt(coverUrl, "png")
        val md5Encode = MD5Utils.md5Encode(coverUrl).toString()
        var cachePath = getWorkDir("storage", "cache", md5Encode + "." + ext)
        var cacheFile = File(cachePath)
        if (cacheFile.exists()) {
            logger.info("send cache: {}", cacheFile)
            context.response().putHeader("Cache-Control", "86400").sendFile(cacheFile.toString())
            return;
        }

        if (!cacheFile.parentFile.exists()) {
            cacheFile.parentFile.mkdirs()
        }

        launch(Dispatchers.IO) {
            webClient.getAbs(coverUrl).timeout(3000).send {
                var bodyBytes = it.result()?.bodyAsBuffer()?.getBytes()
                if (bodyBytes != null) {
                    var res = context.response().putHeader("Cache-Control", "86400")
                    cacheFile.writeBytes(bodyBytes)
                    res.sendFile(cacheFile.toString())
                } else {
                    context.response().setStatusCode(404).end()
                }
            }
        }
    }

    private suspend fun getFileExt(url: String, defaultExt: String=""): String {
        try {
            var seqs = url.split("?", ignoreCase = true, limit = 2)
            var file = seqs[0].split("/").last()
            return file.split(".", ignoreCase = true, limit = 2).last()?.toLowerCase()
        } catch (e: Exception) {
            return defaultExt
        }
    }

    private suspend fun readSourceFile(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (context.fileUploads() == null || context.fileUploads().isEmpty()) {
            return returnData.setErrorMsg("请上传文件")
        }
        var sourceList = JsonArray()
        context.fileUploads().forEach {
            // logger.info("readSourceFile: {}", it.uploadedFileName())
            var file = File(it.uploadedFileName())
            if (file.exists()) {
                sourceList.add(file.readText())
                file.delete()
            }
        }
        return returnData.setData(sourceList.getList())
    }

    private suspend fun uploadFile(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (context.fileUploads() == null || context.fileUploads().isEmpty()) {
            return returnData.setErrorMsg("请上传文件")
        }
        var userNameSpace = getUserNameSpace(context)
        var fileList = JsonArray()
        var type = context.request().getParam("type")
        if (type.isNullOrEmpty()) {
            type = "images"
        }
        // logger.info("type: {}", type)
        context.fileUploads().forEach {
            var file = File(it.uploadedFileName())
            logger.info("uploadFile: {} {} {}", it.uploadedFileName(), it.fileName(), file)
            if (file.exists()) {
                var fileName = it.fileName()
                var newFile = File(getWorkDir("storage", "assets", userNameSpace, type, fileName))
                if (!newFile.parentFile.exists()) {
                    newFile.parentFile.mkdirs()
                }
                if (newFile.exists()) {
                    newFile.delete()
                }
                logger.info("moveTo: {}", newFile)
                if (file.copyRecursively(newFile)) {
                    fileList.add("/assets/" + userNameSpace + "/" + type + "/" + fileName)
                }
                file.deleteRecursively()
            }
        }
        return returnData.setData(fileList.getList())
    }

    private suspend fun deleteFile(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        var url: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            url = context.bodyAsJson.getString("url") ?: ""
        } else {
            // get 请求
            url = context.queryParam("url").firstOrNull() ?: ""
        }
        if (url.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入文件链接")
        }
        var userNameSpace = getUserNameSpace(context)
        if (!url.startsWith("/assets/" + userNameSpace + "/")) {
            return returnData.setErrorMsg("文件链接错误")
        }
        var file = File(getWorkDir("storage" + url))
        logger.info("delete file: {}", file)
        file.deleteRecursively()
        return returnData.setData("")
    }

    private suspend fun importBookPreview(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        if (context.fileUploads() == null || context.fileUploads().isEmpty()) {
            return returnData.setErrorMsg("请上传书籍文件")
        }
        var userNameSpace = getUserNameSpace(context)
        var fileList = arrayListOf<Map<String, Any>>()
        context.fileUploads().forEach {
            var file = File(it.uploadedFileName())
            logger.info("uploadFile: {} {} {}", it.uploadedFileName(), it.fileName(), file)
            if (file.exists()) {
                val fileName = it.fileName()
                val ext = getFileExt(fileName)
                if (ext != "txt" && ext != "epub" && ext != "umd") {
                    file.deleteRecursively()
                    return returnData.setErrorMsg("不支持导入" + ext + "格式的书籍文件")
                }
                val localFilePath = Paths.get("storage", "assets", userNameSpace, "book", fileName).toString()
                val localFileUrl = "/assets/" + userNameSpace + "/book/" + fileName
                var filePath = localFilePath
                if (fileName.endsWith(".epub", true)) {
                    filePath = filePath + File.separator + "index.epub"
                }
                var newFile = File(getWorkDir(filePath))
                if (!newFile.parentFile.exists()) {
                    newFile.parentFile.mkdirs()
                }
                if (newFile.exists()) {
                    newFile.delete()
                }
                logger.info("moveTo: {}", newFile)
                if (file.copyRecursively(newFile)) {
                    val book = Book.initLocalBook(localFileUrl, localFilePath).also {
                        it.setRootDir(getWorkDir())
                    }
                    val chapters = LocalBook.getChapterList(book)
                    fileList.add(mapOf("book" to book, "chapters" to chapters))
                }
                file.deleteRecursively()
            }
        }
        return returnData.setData(fileList)
    }

    private suspend fun getChapterList(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        var bookUrl: String
        var refresh: Int = 0
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            bookUrl = context.bodyAsJson.getString("url") ?: context.bodyAsJson.getJsonObject("book").getString("bookUrl") ?: ""
            refresh = context.bodyAsJson.getInteger("refresh", 0)
        } else {
            // get 请求
            bookUrl = context.queryParam("url").firstOrNull() ?: ""
            refresh = context.queryParam("refresh").firstOrNull()?.toInt() ?: 0
        }
        if (bookUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入书籍链接")
        }
        // 根据书籍url获取书本信息
        bookUrl = URLDecoder.decode(bookUrl, "UTF-8")
        var userNameSpace = getUserNameSpace(context)
        var bookInfo = getShelfBookByURL(bookUrl, userNameSpace)
        var bookSource: String? = null
        if (bookInfo == null) {
            // 看看有没有缓存数据
            var cacheInfo: Book? = bookInfoCache.get(bookUrl)?.toDataClass()
            if (cacheInfo != null) {
                // 使用缓存的书籍信息包含的书源
                bookSource = getBookSourceString(context, cacheInfo.origin)
            } else {
                // 看看有没有传入书源
                bookSource = getBookSourceString(context)
            }
            if (bookSource.isNullOrEmpty()) {
                return returnData.setErrorMsg("未配置书源")
            }
            bookInfo = mergeBookCacheInfo(WebBook(bookSource).getBookInfo(bookUrl))
        } else {
            bookSource = getBookSourceString(context, bookInfo.origin)
        }
        if (!bookInfo.isLocalBook() && bookSource.isNullOrEmpty()) {
            return returnData.setErrorMsg("未配置书源")
        }
        // 缓存章节列表
        logger.info("bookInfo: {}", bookInfo)
        var chapterList = getLocalChapterList(bookInfo, bookSource ?: "", refresh > 0, getUserNameSpace(context))

        return returnData.setData(chapterList)
    }

    private suspend fun getBookContent(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        var chapterUrl: String
        var bookUrl: String
        var chapterIndex: Int
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            chapterUrl = context.bodyAsJson.getString("chapterUrl") ?: context.bodyAsJson.getJsonObject("bookChapter").getString("url") ?: ""
            bookUrl = context.bodyAsJson.getString("url") ?: context.bodyAsJson.getJsonObject("searchBook").getString("bookUrl") ?: ""
            chapterIndex = context.bodyAsJson.getInteger("index", -1)
        } else {
            // get 请求
            chapterUrl = context.queryParam("chapterUrl").firstOrNull() ?: ""
            bookUrl = context.queryParam("url").firstOrNull() ?: ""
            chapterIndex = context.queryParam("index").firstOrNull()?.toInt() ?: -1
        }
        if (bookUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入书籍链接")
        }
        var bookSource = getBookSourceString(context)
        var userNameSpace = getUserNameSpace(context)
        var isInBookShelf = false
        var bookInfo: Book? = null
        var chapterInfo: BookChapter? = null
        if (!bookUrl.isNullOrEmpty()) {
            bookUrl = URLDecoder.decode(bookUrl, "UTF-8")
            // 看看有没有加入书架
            bookInfo = getShelfBookByURL(bookUrl, userNameSpace)
            if (bookInfo != null && !bookInfo.origin.isNullOrEmpty()) {
                isInBookShelf = true
                bookSource = getBookSourceStringBySourceURL(bookInfo.origin, userNameSpace)
            }
            // 看看有没有缓存数据
            var cacheInfo: Book? = bookInfoCache.get(bookUrl)?.toDataClass()
            if (cacheInfo != null) {
                // 使用缓存的书籍信息包含的书源
                bookSource = getBookSourceString(context, cacheInfo.origin)
            }
            if (chapterUrl.isNullOrEmpty() && chapterIndex >= 0) {
                // 根据 url 和 index 获取章节内容
                if (bookUrl.isNullOrEmpty()) {
                    return returnData.setErrorMsg("请输入书籍链接")
                }
                if (bookInfo != null && !bookInfo.isLocalBook() && bookSource.isNullOrEmpty()) {
                    return returnData.setErrorMsg("未配置书源")
                }
                bookInfo = bookInfo ?: mergeBookCacheInfo(WebBook(bookSource ?: "").getBookInfo(bookUrl))
                var chapterList = getLocalChapterList(bookInfo, bookSource ?: "", false, userNameSpace)
                if (chapterIndex <= chapterList.size) {
                    chapterInfo = chapterList.get(chapterIndex)
                    // 书架书籍保存阅读进度
                    if (isInBookShelf) {
                        saveShelfBookProgress(bookInfo, chapterInfo, userNameSpace)
                        // 保存到 webdav
                        saveBookProgressToWebdav(bookInfo, chapterInfo, userNameSpace)
                    }
                    chapterUrl = chapterInfo.url
                }
            }
        }
        if (bookInfo == null) {
            return returnData.setErrorMsg("获取书籍信息失败")
        }
        if (!bookInfo.isLocalBook() && bookSource.isNullOrEmpty()) {
            return returnData.setErrorMsg("未配置书源")
        }
        if (chapterUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("获取章节链接失败")
        }
        chapterUrl = URLDecoder.decode(chapterUrl, "UTF-8")

        var content = ""
        if (bookInfo.isLocalBook()) {
            if (chapterInfo == null) {
                var chapterList = getLocalChapterList(bookInfo, bookSource ?: "", false, userNameSpace)
                for(i in 0 until chapterList.size) {
                    if (chapterUrl == chapterList.get(i).url) {
                        chapterInfo = chapterList.get(i)
                        break
                    }
                }
                if (chapterInfo == null) {
                    return returnData.setErrorMsg("获取章节信息失败")
                }
            }
            if (bookInfo.isEpub()) {
                var chapterFilePath = getWorkDir(bookInfo.originName, "index", "OEBPS", chapterInfo.url)
                if (!File(chapterFilePath).exists()) {
                    // 解压文件 index.epub
                    val unzipFile = File(bookInfo.originName + File.separator + "index")
                    unzipFile.deleteRecursively()
                    val localEpubFile = File(bookInfo.originName + File.separator + "index.epub")
                    if (!localEpubFile.unzip(unzipFile.toString())) {
                        return returnData.setErrorMsg("Epub书籍解压失败")
                    }
                }
                if (!File(chapterFilePath).exists()) {
                    return returnData.setErrorMsg("章节文件不存在")
                }
                // 处理 js 注入脚本
                BookConfig.injectJavascriptToEpubChapter(chapterFilePath);

                // 直接返回 html访问地址
                content = bookInfo.bookUrl.replace("storage/data/", "/epub/") + "/index/OEBPS/" + chapterInfo.url
                return returnData.setData(content)
            }
            var bookContent = LocalBook.getContent(bookInfo, chapterInfo)
            if (bookContent == null) {
                return returnData.setErrorMsg("获取章节内容失败")
            }
            content = bookContent
        } else {
            content = WebBook(bookSource ?: "").getBookContent(chapterUrl)
        }

        return returnData.setData(content)
    }

    private suspend fun exploreBook(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        // 如果登录了，就使用用户的书源
        checkAuth(context)
        var bookSource = getBookSourceString(context)
        if (bookSource.isNullOrEmpty()) {
            return returnData.setErrorMsg("未配置书源")
        }
        var page: Int
        var ruleFindUrl: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            ruleFindUrl = context.bodyAsJson.getString("ruleFindUrl")
            page = context.bodyAsJson.getInteger("page", 1)
        } else {
            // get 请求
            ruleFindUrl = context.queryParam("ruleFindUrl").firstOrNull() ?: ""
            page = context.queryParam("page").firstOrNull()?.toInt() ?: 1
        }
        ruleFindUrl = URLDecoder.decode(ruleFindUrl, "UTF-8")

        var result = saveBookInfoCache(WebBook(bookSource).exploreBook(ruleFindUrl, page))
        return returnData.setData(result)
    }

    private suspend fun searchBook(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        // 如果登录了，就使用用户的书源
        checkAuth(context)
        var bookSource = getBookSourceString(context)
        if (bookSource.isNullOrEmpty()) {
            return returnData.setErrorMsg("未配置书源")
        }
        val key: String
        var page: Int
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            key = context.bodyAsJson.getString("key")
            page = context.bodyAsJson.getInteger("page", 1)
        } else {
            // get 请求
            key = context.queryParam("key").firstOrNull() ?: ""
            page = context.queryParam("page").firstOrNull()?.toInt() ?: 1
        }
        if (key.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入搜索关键字")
        }
        logger.info { "searchBook" }
        var result = saveBookInfoCache(WebBook(bookSource).searchBook(key, page))
        return returnData.setData(result)
    }

    private suspend fun searchBookSource(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val bookUrl: String
        var lastIndex: Int
        var searchSize: Int
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            bookUrl = context.bodyAsJson.getString("url")
            lastIndex = context.bodyAsJson.getInteger("lastIndex", -1)
            searchSize = context.bodyAsJson.getInteger("searchSize", 5)
        } else {
            // get 请求
            bookUrl = context.queryParam("url").firstOrNull() ?: ""
            lastIndex = context.queryParam("lastIndex").firstOrNull()?.toInt() ?: -1
            searchSize = context.queryParam("searchSize").firstOrNull()?.toInt() ?: 5
        }
        var userNameSpace = getUserNameSpace(context)
        var userBookSourceList = loadBookSourceStringList(userNameSpace)
        if (userBookSourceList.size <= 0) {
            return returnData.setErrorMsg("未配置书源")
        }
        if (bookUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入书籍链接")
        }
        if (lastIndex >= userBookSourceList.size) {
            return returnData.setErrorMsg("没有更多了")
        }
        var book = getShelfBookByURL(bookUrl, userNameSpace)
        if (book == null) {
            book = bookInfoCache.get(bookUrl)?.toDataClass()
        }
        if (book == null) {
            return returnData.setErrorMsg("书籍信息错误")
        }
        logger.info { "searchBookSource" }
        lastIndex = lastIndex + 1
        searchSize = if(searchSize > 0) searchSize else 5
        var resultList = arrayListOf<SearchBook>()
        for (i in lastIndex until userBookSourceList.size) {
            // logger.info("searchBookSource from Index: {}", i)
            var bookSource = userBookSourceList.get(i)
            try {
                var result = saveBookInfoCache(WebBook(bookSource).searchBook(book.name, 1))
                if (result.size > 0) {
                    for (j in 0 until result.size) {
                        var _book = result.get(j)
                        if (_book.name.equals(book.name) && _book.author.equals(book.author)) {
                            resultList.add(_book)
                        }
                    }
                }
            } catch(e: Exception) {
                e.printStackTrace()
            }
            if (resultList.size >= searchSize) {
                lastIndex = i
                break;
            }
        }
        saveBookSources(book, resultList, userNameSpace)
        return returnData.setData(mapOf("lastIndex" to lastIndex, "list" to resultList))
    }

    private suspend fun getBookSource(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val bookUrl: String
        var refresh: Int = 0
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            bookUrl = context.bodyAsJson.getString("url")
            refresh = context.bodyAsJson.getInteger("refresh", 0)
        } else {
            // get 请求
            bookUrl = context.queryParam("url").firstOrNull() ?: ""
            refresh = context.queryParam("refresh").firstOrNull()?.toInt() ?: 0
        }
        if (bookUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入书籍链接")
        }
        var userNameSpace = getUserNameSpace(context)
        var book = getShelfBookByURL(bookUrl, userNameSpace)
        if (book == null) {
            book = bookInfoCache.get(bookUrl)?.toDataClass()
        }
        if (book == null) {
            return returnData.setErrorMsg("书籍信息错误")
        }
        var bookSourceList: JsonArray? = asJsonArray(getUserStorage(userNameSpace, book.name + "_" + book.author, "bookSource"))
        if (bookSourceList != null) {
            var list = bookSourceList.getList() as MutableList<Map<String,Any>>
            if (refresh > 0) {
                // 刷新源
                var resultList = arrayListOf<SearchBook>()
                for (i in 0 until list.size) {
                    try {
                        var searchBook: SearchBook = list.get(i).toDataClass()
                        var bookSource = getBookSourceStringBySourceURL(searchBook.origin, userNameSpace)
                        if (bookSource == null) {
                            continue;
                        }
                        var result = saveBookInfoCache(WebBook(bookSource).searchBook(book.name, 1))
                        if (result.size > 0) {
                            for (j in 0 until result.size) {
                                var _book = result.get(j)
                                if (_book.name.equals(book.name)) {
                                    list.set(i, _book.toMap())
                                    resultList.add(_book)
                                    break;
                                }
                            }
                        }
                    } catch(e: Exception) {
                        e.printStackTrace()
                    }
                }
                // logger.info("refreshed bookSourceList: {}", resultList)
                saveBookSources(book, resultList, userNameSpace)
            }
            return returnData.setData(list)
        }
        return returnData.setData(arrayListOf<Int>())
    }

    private suspend fun getUserBookSourceJson(userNameSpace: String): JsonArray? {
        var bookSourceList: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "bookSource"))
        if (bookSourceList == null && !userNameSpace.equals("default")) {
            // 用户书源文件不存在，拷贝系统书源
            var systemBookSourceList: JsonArray? = asJsonArray(getUserStorage("default", "bookSource"))
            if (systemBookSourceList != null) {
                saveUserStorage(userNameSpace, "bookSource", systemBookSourceList.getList())
                bookSourceList = systemBookSourceList
            }
        }
        return bookSourceList
    }

    private suspend fun saveSource(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val bookSource = context.bodyAsJson.mapTo(BookSource::class.java)

        var userNameSpace = getUserNameSpace(context)
        var bookSourceList = getUserBookSourceJson(userNameSpace)
        if (bookSourceList == null) {
            bookSourceList = JsonArray()
        }
        // 遍历判断书本是否存在
        var existIndex: Int = -1
        for (i in 0 until bookSourceList.size()) {
            var _bookSource = bookSourceList.getJsonObject(i).mapTo(BookSource::class.java)
            if (_bookSource.bookSourceUrl.equals(bookSource.bookSourceUrl)) {
                existIndex = i
                break;
            }
        }
        if (existIndex >= 0) {
            var sourceList = bookSourceList.getList()
            sourceList.set(existIndex, JsonObject.mapFrom(bookSource))
            bookSourceList = JsonArray(sourceList)
        } else {
            bookSourceList.add(JsonObject.mapFrom(bookSource))
        }

        // logger.info("bookSourceList: {}", bookSourceList)
        saveUserStorage(userNameSpace, "bookSource", bookSourceList)
        return returnData.setData("")
    }

    private suspend fun saveSources(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val bookSourceJsonArray = context.bodyAsJsonArray

        var userNameSpace = getUserNameSpace(context)
        var bookSourceList = getUserBookSourceJson(userNameSpace)
        if (bookSourceList == null) {
            bookSourceList = JsonArray()
        }
        for (k in 0 until bookSourceJsonArray.size()) {
            var bookSource = bookSourceJsonArray.getJsonObject(k).mapTo(BookSource::class.java)
            // 遍历判断书本是否存在
            var existIndex: Int = -1
            for (i in 0 until bookSourceList!!.size()) {
                var _bookSource = bookSourceList.getJsonObject(i).mapTo(BookSource::class.java)
                if (_bookSource.bookSourceUrl.equals(bookSource.bookSourceUrl)) {
                    existIndex = i
                    break;
                }
            }
            if (existIndex >= 0) {
                var sourceList = bookSourceList.getList()
                sourceList.set(existIndex, JsonObject.mapFrom(bookSource))
                bookSourceList = JsonArray(sourceList)
            } else {
                bookSourceList.add(JsonObject.mapFrom(bookSource))
            }
        }

        // logger.info("bookSourceList: {}", bookSourceList)
        saveUserStorage(userNameSpace, "bookSource", bookSourceList!!)
        return returnData.setData("")
    }

    private suspend fun getSource(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        checkAuth(context)
        var bookSourceUrl: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            bookSourceUrl = context.bodyAsJson.getString("bookSourceUrl")
        } else {
            // get 请求
            bookSourceUrl = context.queryParam("bookSourceUrl").firstOrNull() ?: ""
        }
        if (bookSourceUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("书源链接不能为空")
        }
        bookSourceUrl = URLDecoder.decode(bookSourceUrl, "UTF-8")

        var userNameSpace = getUserNameSpace(context)
        var bookSourceList = getUserBookSourceJson(userNameSpace)
        if (bookSourceList == null) {
            bookSourceList = JsonArray()
        }
        // 遍历判断书本是否存在
        var existIndex: Int = -1
        for (i in 0 until bookSourceList.size()) {
            var _bookSource = bookSourceList.getJsonObject(i).mapTo(BookSource::class.java)
            if (_bookSource.bookSourceUrl.equals(bookSourceUrl)) {
                existIndex = i
                break;
            }
        }
        if (existIndex < 0) {
            return returnData.setErrorMsg("书源信息不存在")
        }

        return returnData.setData(bookSourceList.getJsonObject(existIndex).map)
    }

    private suspend fun getSources(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        checkAuth(context)
        var simple: Int = 0
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            simple = context.bodyAsJson.getInteger("simple", 0)
        } else {
            // get 请求
            simple = context.queryParam("simple").firstOrNull()?.toInt() ?: 0
        }
        var userNameSpace = getUserNameSpace(context)
        var bookSourceList = getUserBookSourceJson(userNameSpace)
        if (bookSourceList != null) {
            if (simple > 0) {
                var list = arrayListOf<Map<String, Any?>>()
                for (i in 0 until bookSourceList.size()) {
                    var bookSource = bookSourceList.getJsonObject(i).mapTo(BookSource::class.java)
                    list.add(mapOf<String, Any?>(
                        "bookSourceGroup" to bookSource.bookSourceGroup,
                        "bookSourceName" to bookSource.bookSourceName,
                        "bookSourceUrl" to bookSource.bookSourceUrl,
                        "exploreUrl" to bookSource.exploreUrl
                    ))
                }
                return returnData.setData(list)
            }
            return returnData.setData(bookSourceList.getList())
        }
        return returnData.setData(arrayListOf<Int>())
    }

    private suspend fun deleteSource(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val bookSource = context.bodyAsJson.mapTo(BookSource::class.java)

        var userNameSpace = getUserNameSpace(context)
        var bookSourceList = getUserBookSourceJson(userNameSpace)
        if (bookSourceList == null) {
            bookSourceList = JsonArray()
        }
        // 遍历判断书本是否存在
        var existIndex: Int = -1
        for (i in 0 until bookSourceList.size()) {
            var _bookSource = bookSourceList.getJsonObject(i).mapTo(BookSource::class.java)
            if (_bookSource.bookSourceUrl.equals(bookSource.bookSourceUrl)) {
                existIndex = i
                break;
            }
        }
        if (existIndex >= 0) {
            bookSourceList.remove(existIndex)
        }

        // logger.info("bookSourceList: {}", bookSourceList)
        saveUserStorage(userNameSpace, "bookSource", bookSourceList)
        return returnData.setData("")
    }

    private suspend fun deleteSources(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val bookSourceJsonArray = context.bodyAsJsonArray

        var userNameSpace = getUserNameSpace(context)
        var bookSourceList = getUserBookSourceJson(userNameSpace)
        if (bookSourceList == null) {
            bookSourceList = JsonArray()
        }
        for (k in 0 until bookSourceJsonArray.size()) {
            var bookSource = bookSourceJsonArray.getJsonObject(k).mapTo(BookSource::class.java)
            // 遍历判断书本是否存在
            var existIndex: Int = -1
            for (i in 0 until bookSourceList.size()) {
                var _bookSource = bookSourceList.getJsonObject(i).mapTo(BookSource::class.java)
                if (_bookSource.bookSourceUrl.equals(bookSource.bookSourceUrl)) {
                    existIndex = i
                    break;
                }
            }
            if (existIndex >= 0) {
                bookSourceList.remove(existIndex)
            }
        }

        // logger.info("bookSourceList: {}", bookSourceList)
        saveUserStorage(userNameSpace, "bookSource", bookSourceList)
        return returnData.setData("")
    }

    private suspend fun getBookshelf(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        var refresh: Int = 0
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            refresh = context.bodyAsJson.getInteger("refresh", 0)
        } else {
            // get 请求
            refresh = context.queryParam("refresh").firstOrNull()?.toInt() ?: 0
        }
        var bookList = getBookShelfBooks(refresh > 0, getUserNameSpace(context))
        return returnData.setData(bookList)
    }

    private suspend fun getShelfBook(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        var url: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            url = context.bodyAsJson.getString("url")
        } else {
            // get 请求
            url = context.queryParam("url").firstOrNull() ?: ""
        }
        if (url.isNullOrEmpty()) {
            return returnData.setErrorMsg("书源链接不能为空")
        }
        url = URLDecoder.decode(url, "UTF-8")

        var book = getShelfBookByURL(url, getUserNameSpace(context))
        if (book == null) {
            return returnData.setErrorMsg("书籍不存在")
        }
        return returnData.setData(book)
    }

    private suspend fun saveBook(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        var book = context.bodyAsJson.mapTo(Book::class.java)
        if (book.origin.isNullOrEmpty()) {
            return returnData.setErrorMsg("未找到书源信息")
        }
        if (book.bookUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("书籍链接不能为空")
        }
        var userNameSpace = getUserNameSpace(context)
        if (book.isLocalBook()) {
            // 导入本地书籍
            if (book.bookUrl.startsWith("/assets/")) {
                // 临时文件，移动到书籍目录
                // storage/assets/hector/book/《极道天魔》（校对版全本）作者：滚开.txt
                val tempFile = File(getWorkDir("storage" + book.bookUrl))
                val localFilePath = getWorkDir("storage", "data", userNameSpace, book.name + "_" + book.author, tempFile.name)
                logger.info("localFilePath: {}", localFilePath)
                var localFile = File(localFilePath)
                localFile.deleteRecursively()
                if (!localFile.parentFile.exists()) {
                    localFile.parentFile.mkdirs()
                }
                if (!tempFile.copyRecursively(localFile)) {
                    return returnData.setErrorMsg("导入本地书籍失败")
                }
                if (book.isEpub()) {
                    // 解压文件 index.epub
                    val unzipFile = File(localFilePath + File.separator + "index")
                    unzipFile.deleteRecursively()
                    val localEpubFile = File(localFilePath + File.separator + "index.epub")
                    if (!localEpubFile.unzip(unzipFile.toString())) {
                        return returnData.setErrorMsg("导入本地Epub书籍失败")
                    }
                }
                tempFile.deleteRecursively()
                // 修改书籍信息
                book.bookUrl = localFilePath
                book.originName = localFilePath
            }
        } else if (book.tocUrl.isNullOrEmpty()) {
            // 补全书籍信息
            var bookSource = getBookSourceStringBySourceURL(book.origin, userNameSpace)
            if (bookSource == null) {
                return returnData.setErrorMsg("书源信息错误")
            }
            var newBook = WebBook(bookSource).getBookInfo(book.bookUrl)
            book = newBook.fillData(book, listOf("name", "author", "coverUrl", "intro", "latestChapterTitle", "wordCount"))
        }
        book = mergeBookCacheInfo(book)
        var bookshelf: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "bookshelf"))
        if (bookshelf == null) {
            bookshelf = JsonArray()
        }
        // 遍历判断书本是否存在
        var existIndex: Int = -1
        for (i in 0 until bookshelf.size()) {
            var _book = bookshelf.getJsonObject(i).mapTo(Book::class.java)
            if (_book.name.equals(book.name)) {
                existIndex = i
                break;
            }
        }
        if (existIndex >= 0) {
            var bookList = bookshelf.getList()
            var existBook = bookshelf.getJsonObject(existIndex).mapTo(Book::class.java)
            book.durChapterIndex = existBook.durChapterIndex
            book.durChapterTitle = existBook.durChapterTitle
            book.durChapterTime = existBook.durChapterTime

            bookList.set(existIndex, JsonObject.mapFrom(book))
            bookshelf = JsonArray(bookList)
        } else {
            bookshelf.add(JsonObject.mapFrom(book))
        }
        // logger.info("bookshelf: {}", bookshelf)
        saveUserStorage(userNameSpace, "bookshelf", bookshelf)
        return returnData.setData(book)
    }

    private suspend fun saveBookSource(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        var bookUrl: String
        var newBookUrl: String
        var bookSourceUrl: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            bookUrl = context.bodyAsJson.getString("bookUrl")
            newBookUrl = context.bodyAsJson.getString("newUrl")
            bookSourceUrl = context.bodyAsJson.getString("bookSourceUrl")
        } else {
            // get 请求
            bookUrl = context.queryParam("bookUrl").firstOrNull() ?: ""
            newBookUrl = context.queryParam("newUrl").firstOrNull() ?: ""
            bookSourceUrl = context.queryParam("bookSourceUrl").firstOrNull() ?: ""
        }
        if (bookUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("书籍链接不能为空")
        }
        if (newBookUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("新源书籍链接不能为空")
        }
        if (bookSourceUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("书源链接不能为空")
        }
        var userNameSpace = getUserNameSpace(context)
        bookUrl = URLDecoder.decode(bookUrl, "UTF-8")
        var book = getShelfBookByURL(bookUrl, userNameSpace)
        if (book == null) {
            return returnData.setErrorMsg("书籍信息错误")
        }
        bookSourceUrl = URLDecoder.decode(bookSourceUrl, "UTF-8")
        newBookUrl = URLDecoder.decode(newBookUrl, "UTF-8")
        // 查找是否存在该书源
        var bookSourceString = getBookSourceStringBySourceURL(bookSourceUrl, userNameSpace)

        if (bookSourceString.isNullOrEmpty()) {
            return returnData.setErrorMsg("书源信息错误")
        }

        var newBookInfo = WebBook(bookSourceString).getBookInfo(newBookUrl)

        var bookSource: BookSource = bookSourceString.toMap().toDataClass()

        editShelfBook(book, userNameSpace) { existBook ->
            existBook.origin = bookSource.bookSourceUrl
            existBook.originName = bookSource.bookSourceName
            existBook.bookUrl = newBookUrl
            existBook.tocUrl = newBookInfo.tocUrl

            logger.info("saveBookSource: {}", existBook)

            newBookInfo = existBook

            existBook
        }

        return returnData.setData(newBookInfo)
    }

    private suspend fun saveBookGroupId(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        var bookUrl: String
        var groupId: Int
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            bookUrl = context.bodyAsJson.getString("bookUrl")
            groupId = context.bodyAsJson.getInteger("groupId", 0)
        } else {
            // get 请求
            bookUrl = context.queryParam("bookUrl").firstOrNull() ?: ""
            groupId = context.queryParam("groupId").firstOrNull()?.toInt() ?: 0
        }
        if (bookUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("书籍链接不能为空")
        }
        var userNameSpace = getUserNameSpace(context)
        bookUrl = URLDecoder.decode(bookUrl, "UTF-8")
        var book = getShelfBookByURL(bookUrl, userNameSpace)
        if (book == null) {
            return returnData.setErrorMsg("书籍信息错误")
        }

        if (groupId <= 0) {
            return returnData.setErrorMsg("分组信息错误")
        }

        editShelfBook(book, userNameSpace) { existBook ->
            existBook.group = groupId
            logger.info("saveBookGroupId: {}", existBook)
            existBook
        }

        book.group = groupId
        return returnData.setData(book)
    }

    private suspend fun deleteBook(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val book = context.bodyAsJson.mapTo(Book::class.java)
        var userNameSpace = getUserNameSpace(context)
        var bookshelf: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "bookshelf"))
        if (bookshelf == null) {
            bookshelf = JsonArray()
        }
        // 遍历判断书本是否存在
        var existIndex: Int = -1
        for (i in 0 until bookshelf.size()) {
            var _book = bookshelf.getJsonObject(i).mapTo(Book::class.java)
            if (_book.name.equals(book.name)) {
                existIndex = i
                break;
            }
        }
        if (existIndex >= 0) {
            bookshelf.remove(existIndex)
        }
        // logger.info("bookshelf: {}", bookshelf)
        saveUserStorage(userNameSpace, "bookshelf", bookshelf)
        return returnData.setData("")
    }

    private suspend fun getBookGroups(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        checkAuth(context)
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        var userNameSpace = getUserNameSpace(context)
        var bookGroupList: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "bookGroup"))
        if (bookGroupList != null) {
            return returnData.setData(bookGroupList.getList())
        }
        return returnData.setData(arrayListOf<Int>())
    }

    private suspend fun saveBookGroup(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val bookGroup = context.bodyAsJson.mapTo(BookGroup::class.java)
        if (bookGroup.groupName.isEmpty()) {
            return returnData.setErrorMsg("分组名称不能为空")
        }

        var userNameSpace = getUserNameSpace(context)
        var bookGroupList: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "bookGroup"))
        if (bookGroupList == null) {
            bookGroupList = JsonArray()
        }
        // 遍历判断书本是否存在
        var existIndex: Int = -1
        for (i in 0 until bookGroupList.size()) {
            var _bookGroup = bookGroupList.getJsonObject(i).mapTo(BookGroup::class.java)
            if (_bookGroup.groupId.equals(bookGroup.groupId)) {
                existIndex = i
                break;
            }
        }
        if (existIndex >= 0) {
            var groupList = bookGroupList.getList()
            groupList.set(existIndex, JsonObject.mapFrom(bookGroup))
            bookGroupList = JsonArray(groupList)
        } else {
            // 新增分组
            var maxOrder = 0;
            val idsSum = bookGroupList.sumBy{
                val id = asJsonObject(it)?.getInteger("groupId", 0) ?: 0
                val order = asJsonObject(it)?.getInteger("order", 0) ?: 0
                maxOrder = if (order > maxOrder) order else maxOrder
                if (id > 0) id else 0
            }
            var id = 1
            while (id and idsSum != 0) {
                id = id.shl(1)
            }
            bookGroup.groupId = id
            bookGroup.order = maxOrder + 1
            bookGroupList.add(JsonObject.mapFrom(bookGroup))
        }

        // logger.info("bookGroupList: {}", bookGroupList)
        saveUserStorage(userNameSpace, "bookGroup", bookGroupList)
        return returnData.setData("")
    }


    private suspend fun deleteBookGroup(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val bookgroup = context.bodyAsJson.mapTo(BookGroup::class.java)
        var userNameSpace = getUserNameSpace(context)
        var bookGroupList: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "bookGroup"))
        if (bookGroupList == null) {
            bookGroupList = JsonArray()
        }
        // 遍历判断书本是否存在
        var existIndex: Int = -1
        for (i in 0 until bookGroupList.size()) {
            var _bookGroup = bookGroupList.getJsonObject(i).mapTo(BookGroup::class.java)
            if (_bookGroup.groupId.equals(bookgroup.groupId)) {
                existIndex = i
                break;
            }
        }
        if (existIndex >= 0) {
            bookGroupList.remove(existIndex)
        }
        // logger.info("bookGroup: {}", bookGroup)
        saveUserStorage(userNameSpace, "bookGroup", bookGroupList)
        return returnData.setData("")
    }


    /**
     * 非 API
     */
    private suspend fun loadBookCacheInfo() {
        var _bookInfoCache: JsonObject? = asJsonObject(getStorage("cache", "bookInfoCache"))
        if (_bookInfoCache != null) {
            bookInfoCache = _bookInfoCache.map as MutableMap<String, Map<String, Any>>
            // logger.info("load bookInfoCache {}", bookInfoCache)
        }
    }

    private suspend fun saveBookInfoCache(bookList: List<SearchBook>): List<SearchBook> {
        if (bookList.size > 0) {
            for (i in 0 until bookList.size) {
                var book = bookList.get(i)
                bookInfoCache.put(book.bookUrl, JsonObject.mapFrom(book).map)
            }
            saveStorage("data", "bookInfoCache", value = bookInfoCache)
        }
        return bookList
    }

    private suspend fun mergeBookCacheInfo(book: Book): Book {
        var cacheInfo: Book? = bookInfoCache.get(book.bookUrl)?.toDataClass()

        if (cacheInfo != null) {
            return book.fillData(cacheInfo, listOf("name", "author", "coverUrl", "intro", "latestChapterTitle", "wordCount"))
        }
        return book
    }

    private suspend fun getBookShelfBooks(refresh: Boolean = false, userNameSpace: String): List<Book> {
        var bookshelf: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "bookshelf"))
        if (bookshelf == null) {
            return arrayListOf<Book>()
        }
        var bookList = arrayListOf<Book>()
        for (i in 0 until bookshelf.size()) {
            var book = bookshelf.getJsonObject(i).mapTo(Book::class.java)
            if (book.canUpdate && refresh) {
                try {
                    var bookSource = getBookSourceStringBySourceURL(book.origin, userNameSpace)
                    if (bookSource != null) {
                        var bookChapterList = getLocalChapterList(book, bookSource, refresh, userNameSpace)
                        if (bookChapterList.size > 0) {
                            var bookChapter = bookChapterList.last()
                            book.latestChapterTitle = bookChapter.title
                        }
                        if (bookChapterList.size - book.totalChapterNum > 0) {
                            book.lastCheckTime = System.currentTimeMillis()
                            book.lastCheckCount = bookChapterList.size - book.totalChapterNum
                        }
                        book.totalChapterNum = bookChapterList.size
                    }
                } catch(e: Exception) {
                    e.printStackTrace()
                }
            }
            bookList.add(book)
        }
        return bookList
    }


    private suspend fun getLocalChapterList(book: Book, bookSource: String, refresh: Boolean = false, userNameSpace: String): List<BookChapter> {
        val md5Encode = MD5Utils.md5Encode(book.bookUrl).toString()
        var chapterList: JsonArray? = asJsonArray(getUserStorage(userNameSpace, book.name + "_" + book.author, md5Encode))

        if (chapterList == null || refresh) {
            var newChapterList: List<BookChapter>
            if (book.isLocalBook()) {
                newChapterList = LocalBook.getChapterList(book.also{
                    it.setRootDir(getWorkDir())
                })
            } else {
                newChapterList = WebBook(bookSource).getChapterList(book)
            }
            saveUserStorage(userNameSpace, getRelativePath(book.name + "_" + book.author, md5Encode), newChapterList)
            saveShelfBookLatestChapter(book, newChapterList, userNameSpace)
            return newChapterList
        }
        var localChapterList = arrayListOf<BookChapter>()
        for (i in 0 until chapterList.size()) {
            var _chapter = chapterList.getJsonObject(i).mapTo(BookChapter::class.java)
            localChapterList.add(_chapter)
        }
        return localChapterList
    }

    private suspend fun getBookSourceString(context: RoutingContext, sourceUrl: String = ""): String? {
        var bookSourceString: String? = null
        if (context.request().method() == HttpMethod.POST) {
            var bookSource = context.bodyAsJson.getJsonObject("bookSource")
            if (bookSource != null) {
                bookSourceString = bookSource.toString()
            }
        }
        var userNameSpace = getUserNameSpace(context)
        if (bookSourceString.isNullOrEmpty()) {
            var bookSourceUrl: String
            if (context.request().method() == HttpMethod.POST) {
                bookSourceUrl = context.bodyAsJson.getString("bookSourceUrl", "")
            } else {
                bookSourceUrl = context.queryParam("bookSourceUrl").firstOrNull() ?: ""
            }
            bookSourceUrl = URLDecoder.decode(bookSourceUrl, "UTF-8")
            bookSourceString = getBookSourceStringBySourceURL(bookSourceUrl, userNameSpace)
        }
        if (bookSourceString.isNullOrEmpty() && !sourceUrl.isNullOrEmpty()) {
            bookSourceString = getBookSourceStringBySourceURL(sourceUrl, userNameSpace)
        }
        return bookSourceString
    }

    private suspend fun loadBookSourceStringList(userNameSpace: String): List<String> {
        var bookSourceList: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "bookSource"))
        var userBookSourceList = arrayListOf<String>()
        if (bookSourceList != null) {
            for (i in 0 until bookSourceList.size()) {
                userBookSourceList.add(bookSourceList.getJsonObject(i).toString())
            }
        }
        return userBookSourceList
    }

    private suspend fun getBookSourceStringBySourceURL(sourceUrl: String, userNameSpace: String): String? {
        var bookSourceString: String? = null
        if (sourceUrl.isNullOrEmpty()) {
            return bookSourceString
        }
        // 优先查找用户的书源
        var userBookSourceList = loadBookSourceStringList(userNameSpace)
        for (i in 0 until userBookSourceList.size) {
            val sourceMap = userBookSourceList.get(i).toMap()
            if (sourceUrl == (sourceMap.get("bookSourceUrl") as String)) {
                bookSourceString = userBookSourceList.get(i)
                break;
            }
        }
        return bookSourceString
    }

    private suspend fun getShelfBookByURL(url: String, userNameSpace: String): Book? {
        if (url.isEmpty()) {
            return null
        }
        var bookshelf: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "bookshelf"))
        if (bookshelf == null) {
            return null
        }
        for (i in 0 until bookshelf.size()) {
            var _book = bookshelf.getJsonObject(i).mapTo(Book::class.java)
            if (_book.bookUrl.equals(url)) {
                return _book
            }
        }
        return null
    }

    private suspend fun saveShelfBookProgress(book: Book, bookChapter: BookChapter, userNameSpace: String) {
        editShelfBook(book, userNameSpace) { existBook ->
            existBook.durChapterIndex = bookChapter.index
            existBook.durChapterTitle = bookChapter.title
            existBook.durChapterTime = System.currentTimeMillis()

            logger.info("saveShelfBookProgress: {}", existBook)

            existBook
        }
    }

    private suspend fun saveShelfBookLatestChapter(book: Book, bookChapterList: List<BookChapter>, userNameSpace: String) {
        editShelfBook(book, userNameSpace) { existBook ->
            if (bookChapterList.size > 0) {
                var bookChapter = bookChapterList.last()
                existBook.latestChapterTitle = bookChapter.title
            }
            if (bookChapterList.size - existBook.totalChapterNum > 0) {
                existBook.lastCheckCount = bookChapterList.size - existBook.totalChapterNum
                existBook.lastCheckTime = System.currentTimeMillis()
            }
            existBook.totalChapterNum = bookChapterList.size
            // TODO 最新章节更新时间
            // existBook.latestChapterTime = System.currentTimeMillis()
            logger.info("saveShelfBookLatestChapter: {}", existBook)
            existBook
        }
    }

    private suspend fun editShelfBook(book: Book, userNameSpace: String, handler: (Book)->Book) {
        var bookshelf: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "bookshelf"))
        if (bookshelf == null) {
            bookshelf = JsonArray()
        }
        // 遍历判断书本是否存在
        var existIndex: Int = -1
        for (i in 0 until bookshelf.size()) {
            var _book = bookshelf.getJsonObject(i).mapTo(Book::class.java)
            // 根据书籍链接查找
            if (book.bookUrl.isNotEmpty() && _book.bookUrl.equals(book.bookUrl)) {
                existIndex = i
                break;
            }
            // 根据作者和书名查找
            if (book.name.isNotEmpty() && _book.name.equals(book.name) && book.author.isNotEmpty() && _book.author.equals(book.author)) {
                existIndex = i
                break;
            }
        }
        if (existIndex >= 0) {
            var bookList = bookshelf.getList()
            var existBook = bookshelf.getJsonObject(existIndex).mapTo(Book::class.java)
            existBook = handler(existBook)

            logger.info("editShelfBook: {}", existBook)

            bookList.set(existIndex, JsonObject.mapFrom(existBook))
            bookshelf = JsonArray(bookList)
            saveUserStorage(userNameSpace, "bookshelf", bookshelf)
        }
    }

    private suspend fun saveBookSources(book: Book, sourceList: List<SearchBook>, userNameSpace: String) {
        if (book.name.isEmpty()) {
            return;
        }
        var bookSourceList: JsonArray? = asJsonArray(getUserStorage(userNameSpace, book.name + "_" + book.author, "bookSource"))
        if (bookSourceList == null) {
            bookSourceList = JsonArray()
        }
        for (k in 0 until sourceList.size) {
            var searchBook = sourceList.get(k)
            // 遍历判断书本是否存在
            var existIndex: Int = -1
            for (i in 0 until bookSourceList!!.size()) {
                var _searchBook = bookSourceList.getJsonObject(i).mapTo(SearchBook::class.java)
                if (_searchBook.bookUrl.equals(searchBook.bookUrl)) {
                    existIndex = i
                    break;
                }
            }
            if (existIndex >= 0) {
                var _sourceList = bookSourceList.getList()
                _sourceList.set(existIndex, JsonObject.mapFrom(searchBook))
                bookSourceList = JsonArray(_sourceList)
            } else {
                bookSourceList.add(JsonObject.mapFrom(searchBook))
            }
        }

        // logger.info("bookSourceList: {}", bookSourceList)
        saveUserStorage(userNameSpace, getRelativePath(book.name + "_" + book.author, "bookSource"), bookSourceList!!)
    }

    fun getUserInfoClass(username: String): User? {
        var user: User? = getUserInfoMap(username)?.toDataClass()
        return user
    }

    fun getUserInfoMap(username: String): Map<String, Any>? {
        if (username.isEmpty()) {
            return null
        }
        var userMap = mutableMapOf<String, Map<String, Any>>()
        var userMapJson: JsonObject? = asJsonObject(getStorage("data", "users"))
        if (userMapJson != null) {
            userMap = userMapJson.map as MutableMap<String, Map<String, Any>>
        }
        return userMap.getOrDefault(username, null)
    }

    fun formatUser(userInfo: Any): MutableMap<String, Any> {
        var user: User? = null
        if (userInfo !is User) {
            var userMap = userInfo as? Map<String, Any>
            if (userMap != null) {
                user = userMap.toDataClass()
            }
        } else {
            user = userInfo
        }
        if (user == null) {
            return mutableMapOf()
        }
        return mutableMapOf(
            "username" to user.username,
            "lastLoginAt" to user.last_login_at,
            "accessToken" to user.username + ":" + user.token,
            "enableWebdav" to user.enable_webdav,
            "createdAt" to user.created_at
        )
    }

    suspend fun syncBookProgressFromWebdav(progressFilePath: Any, userNameSpace: String) {
        var progressFile: File? = null
        when (progressFilePath) {
            is File -> progressFile = progressFilePath
            is String -> progressFile = File(progressFilePath)
        }
        if (progressFile == null) {
            return
        }
        var book = asJsonObject(progressFile.readText())?.mapTo(Book::class.java)
        if (book != null) {
            editShelfBook(book, userNameSpace) { existBook ->
                existBook.durChapterIndex = book.durChapterIndex
                existBook.durChapterPos = book.durChapterPos
                existBook.durChapterTime = book.durChapterTime
                existBook.durChapterTitle = book.durChapterTitle

                logger.info("syncShelfBookProgress: {}", existBook)
                existBook
            }
        }
    }

    suspend fun saveBookProgressToWebdav(book: Book, bookChapter: BookChapter, userNameSpace: String) {
        val userHome = getUserWebdavHome(userNameSpace)
        var bookProgressDir = File(userHome + File.separator + "bookProgress")
        if (!bookProgressDir.exists()) {
            bookProgressDir = File(userHome + File.separator + "legado" + File.separator + "bookProgress")
            if (!bookProgressDir.exists()) {
                return
            }
        }
        var progressFile = File(bookProgressDir.toString() + File.separator + book.name + "_" + book.author + ".json")
        progressFile.writeText(jsonEncode(mapOf(
            "name" to book.name,
            "author" to book.author,
            "durChapterIndex" to bookChapter.index,
            "durChapterPos" to 0,
            "durChapterTime" to System.currentTimeMillis(),
            "durChapterTitle" to bookChapter.title
        ), true))
    }

    suspend fun syncFromWebdav(zipFilePath: String, userNameSpace: String): Boolean {
        var descDir = getWorkDir("storage", "data", userNameSpace, "tmp")
        var descDirFile = File(descDir)
        try {
            val userHome = getUserWebdavHome(userNameSpace)
            var zipFile = File(zipFilePath)
            if (!zipFile.exists()) {
                return false
            }
            descDirFile.deleteRecursively()
            if (zipFile.unzip(descDir)) {
                // 同步 书源
                val bookSourceFile = File(descDir + File.separator + "bookSource.json")
                if (bookSourceFile.exists()) {
                    val userBookSourceFile = File(getWorkDir("storage", "data", userNameSpace, "bookSource.json"))
                    userBookSourceFile.deleteRecursively()
                    bookSourceFile.renameTo(userBookSourceFile)
                }
                // 同步 书架
                val bookshelfFile = File(descDir + File.separator + "bookshelf.json")
                if (bookshelfFile.exists()) {
                    val userBookSourceFile = File(getWorkDir("storage", "data", userNameSpace, "bookshelf.json"))
                    userBookSourceFile.deleteRecursively()
                    bookshelfFile.renameTo(userBookSourceFile)
                }

                // 同步阅读进度
                var bookProgressDir = File(userHome + File.separator + "bookProgress")
                if (!bookProgressDir.exists()) {
                    bookProgressDir = File(userHome + File.separator +  "legado" + File.separator +  "bookProgress")
                }
                if (bookProgressDir.exists() && bookProgressDir.isDirectory()) {
                    bookProgressDir.listFiles().forEach{
                        syncBookProgressFromWebdav(it, userNameSpace)
                    }
                }
                return true
            }
        } catch(e: Exception) {
            e.printStackTrace()
        } finally {
            descDirFile.deleteRecursively()
        }
        return true;
    }

    suspend fun saveToWebdav(latestZipFilePath: String, userNameSpace: String): Boolean {
        var descDir = getWorkDir("storage", "data", userNameSpace, "tmp")
        var descDirFile = File(descDir)
        descDirFile.deleteRecursively()
        try {
            val userHome = getUserWebdavHome(userNameSpace)
            var legadoHome = userHome
            if (latestZipFilePath.indexOf("legado") > 0) {
                legadoHome = userHome + File.separator + "legado"
            }
            var zipFile = File(latestZipFilePath)
            if (zipFile.unzip(descDir)) {
                // 同步 书源
                val userBookSourceFile = File(getWorkDir("storage", "data", userNameSpace, "bookSource.json"))
                if (userBookSourceFile.exists()) {
                    val bookSourceFile = File(descDir + File.separator + "bookSource.json")
                    bookSourceFile.deleteRecursively()
                    userBookSourceFile.copyRecursively(bookSourceFile)
                }
                // 同步 书架
                val userBookshelfFile = File(getWorkDir("storage", "data", userNameSpace, "bookshelf.json"))
                if (userBookshelfFile.exists()) {
                    val bookshelfFile = File(descDir + File.separator + "bookshelf.json")
                    bookshelfFile.deleteRecursively()
                    userBookshelfFile.copyRecursively(bookshelfFile)
                }

                // 压缩
                val today = SimpleDateFormat("yyyy-MM-dd").format(System.currentTimeMillis())
                return descDirFile.zip(legadoHome + File.separator + "backup" + today + ".zip")
            }
        } catch(e: Exception) {
            e.printStackTrace()
        }  finally {
            descDirFile.deleteRecursively()
        }
        return false;
    }

    suspend fun getLastBackFileFromWebdav(userNameSpace: String): String? {
        val userHome = getUserWebdavHome(userNameSpace)
        var legadoHome = File(userHome + File.separator + "legado")
        if (!legadoHome.exists()) {
            legadoHome = File(userHome)
        }
        if (!legadoHome.exists()) {
            return null
        }
        var latestZipFile: String? = null
        val zipFileReg = Regex("^backup[0-9-]+.zip$", RegexOption.IGNORE_CASE)    //忽略大小写
        legadoHome.listFiles().also{
            it.sortByDescending {
                it.lastModified()
            }
        }.forEach {
            if (zipFileReg.matches(it.name)) {
                latestZipFile = it.toString()
                return@forEach
            }
        }
        return latestZipFile
    }

    /**
     * 定时任务
     */

    /**
     * 每十分钟检查一次书架书籍更新
     */
    @Scheduled(cron = "0 0/10 * * * ?")
    fun shelfUpdateJob()
    {
        launch(Dispatchers.IO) {
            try {
                logger.info("开始检查书架书籍更新")
                // 刷新系统默认书架
                getBookShelfBooks(true, "default")

                // 刷新用户书架
                if (appConfig.secure) {
                    var userMap = mutableMapOf<String, Map<String, Any>>()
                    var userMapJson: JsonObject? = asJsonObject(getStorage("data", "users"))
                    if (userMapJson != null) {
                        userMap = userMapJson.map as MutableMap<String, Map<String, Any>>
                    }
                    userMap.forEach{
                        try {
                            var ns = it.value.getOrDefault("username", "") as String? ?: ""
                            if (ns.isNotEmpty()) {
                                getBookShelfBooks(true, ns)
                            }
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }
                    }
                }
                logger.info("书架书籍更新检查结束")
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }
}