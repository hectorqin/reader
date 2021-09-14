package org.lightink.reader.api

import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import io.legado.app.data.entities.SearchBook
import io.legado.app.data.entities.BookSource
import io.legado.app.help.storage.OldRule
import io.legado.app.model.Debug
import io.legado.app.model.WebBook
import io.vertx.ext.web.Router
import io.vertx.ext.web.RoutingContext
import io.vertx.ext.web.handler.StaticHandler;
import mu.KotlinLogging
import org.lightink.reader.config.AppConfig
import org.lightink.reader.service.YueduSchedule
import org.lightink.reader.service.yuedu.constant.DeepinkBookSource
import org.lightink.reader.utils.error
import org.lightink.reader.utils.success
import org.lightink.reader.utils.getStorage
import org.lightink.reader.utils.saveStorage
import org.lightink.reader.utils.asJsonArray
import org.lightink.reader.utils.asJsonObject
import org.lightink.reader.utils.serializeToMap
import org.lightink.reader.utils.toDataClass
import org.lightink.reader.utils.toMap
import org.lightink.reader.utils.fillData
import org.lightink.reader.utils.getWorkDir
import org.lightink.reader.utils.getRandomString
import org.lightink.reader.utils.genEncryptedPassword
import org.lightink.reader.entity.User
import org.lightink.reader.utils.SpringContextUtils
import org.lightink.reader.verticle.RestVerticle
import org.lightink.reader.SpringEvent
import org.springframework.stereotype.Component
import io.vertx.core.json.JsonObject
import io.vertx.core.json.JsonArray
import io.vertx.core.http.HttpMethod
import org.lightink.reader.api.ReturnData
import io.legado.app.utils.MD5Utils
import java.net.URLDecoder;
import io.vertx.ext.web.client.WebClient
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.core.env.Environment
import java.io.File
import java.lang.Runtime
import kotlin.collections.mutableMapOf

private val logger = KotlinLogging.logger {}

@Component
class YueduApi : RestVerticle() {
    var installedBookSourceList = arrayListOf<String>()
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

        router.get("/reader3/getSources").coroutineHandler { getSources(it) }
        router.post("/reader3/getSources").coroutineHandler { getSources(it) }

        router.post("/reader3/deleteSource").coroutineHandler { deleteSource(it) }
        router.post("/reader3/deleteSources").coroutineHandler { deleteSources(it) }

        router.get("/reader3/getBookshelf").coroutineHandler { getBookshelf(it) }
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

        // web界面
        router.route("/web/*").handler(StaticHandler.create("web").setDefaultContentEncoding("UTF-8"));

        // assets
        var assetsDir = getWorkDir("storage/assets");
        var assetsDirFile = File(assetsDir);
        if (!assetsDirFile.exists()) {
            assetsDirFile.mkdirs();
        }
        var assetsCss = getWorkDir("storage/assets/reader.css");
        var assetsCssFile = File(assetsCss);
        if (!assetsCssFile.exists()) {
            assetsCssFile.writeText("/* 在此处可以编写CSS样式来自定义页面 */");
        }
        router.route("/assets/*").handler(StaticHandler.create().setAllowRootFileSystemAccess(true).setWebRoot(assetsDir).setDefaultContentEncoding("UTF-8"));

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

        // 加载书源
        loadInstalledBookSourceList();

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
            var dataDir = File(getWorkDir("storage/data"))
            if (!dataDir.exists()) {
                var storageDir = File(getWorkDir("storage"))
                var backupDir = File(getWorkDir("storage-backup"))
                storageDir.renameTo(backupDir)
                dataDir.parentFile.mkdirs()
                backupDir.copyRecursively(dataDir)
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
        var userMapJson: JsonObject? = asJsonObject(getStorage("data/users"))
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
            userMap.put(username, newUser.toMap())
            saveStorage("data/users", userMap)

            val loginData = mapOf(
                "username" to newUser.username,
                "last_login_at" to newUser.last_login_at,
                "created_at" to newUser.created_at
            )

            context.session().put("userInfo", loginData)

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
            userInfo.last_login_at = System.currentTimeMillis()
            userMap.put(username, userInfo.toMap())
            saveStorage("data/users", userMap)

            val loginData = mapOf(
                "username" to userInfo.username,
                "last_login_at" to userInfo.last_login_at,
                "created_at" to userInfo.created_at
            )

            context.session().put("userInfo", loginData)

            return returnData.setData(loginData)
        }
    }

    private suspend fun getUserInfo(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        var userInfo = context.session().get("userInfo") as Map<String, Any>?
        var secure = env.getProperty("reader.app.secure", Boolean::class.java)
        var secureKey = env.getProperty("reader.app.secureKey")

        return returnData.setData(mapOf(
            "userInfo" to userInfo,
            "secure" to secure,
            "secureKey" to secureKey?.isNotEmpty()
        ))
    }

    private suspend fun checkAuth(context: RoutingContext): Boolean {
        if (!appConfig.secure) {
            return true
        }
        var userInfo = context.session().get("userInfo") as Map<String, Any>?
        if (userInfo != null) {
            return true
        }
        return false
    }

    private suspend fun getUserNameSpace(context: RoutingContext): String {
        if (!appConfig.secure) {
            return ""
        }
        var userInfo = context.session().get("userInfo") as Map<String, Any>?
        if (userInfo != null) {
            var ns = userInfo.getOrDefault("username", "") as String? ?: ""
            if (ns.isNotEmpty()) {
                return "/" + ns;
            }
            return ns;
        }
        return ""
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
        var bookInfo = getShelfBookByURL(bookUrl, getUserNameSpace(context))
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
        var ext = getFileExt(coverUrl)
        val md5Encode = MD5Utils.md5Encode(coverUrl).toString()
        var cachePath = getWorkDir("storage/cache/" + md5Encode + "." + ext)
        var cacheFile = File(cachePath)
        if (cacheFile.exists()) {
            logger.info("send cache: {}", cacheFile)
            context.response().putHeader("Cache-Control", "86400").sendFile(cacheFile.toString())
            return;
        }

        if (!cacheFile.parentFile.exists()) {
            cacheFile.parentFile.mkdirs()
        }

        webClient.getAbs(coverUrl).send {
            var result = it.result()
            var res = context.response().putHeader("Cache-Control", "86400")
            cacheFile.writeBytes(result.bodyAsBuffer().getBytes())
            res.sendFile(cacheFile.toString())
        }
    }

    private suspend fun getFileExt(url: String): String {
        var seqs = url.split("?", ignoreCase = true, limit = 2)
        var file = seqs[0].split("/").last()
        return file.split(".", ignoreCase = true, limit = 2).last()
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
        if (context.fileUploads() == null || context.fileUploads().isEmpty()) {
            return returnData.setErrorMsg("请上传文件")
        }
        var fileList = JsonArray()
        var type = context.request().getParam("type")
        if (type.isNullOrEmpty()) {
            type = "images"
        }
        // logger.info("type: {}", type)
        context.fileUploads().forEach {
            // logger.info("uploadFile: {} {}", it.uploadedFileName(), it.fileName())
            var file = File(it.uploadedFileName())
            if (file.exists()) {
                var fileName = it.fileName()
                var newFile = File(getWorkDir("storage/assets/" + type + "/" + fileName))
                if (!newFile.parentFile.exists()) {
                    newFile.parentFile.mkdirs()
                }
                if (newFile.exists()) {
                    newFile.delete()
                }
                // logger.info("renameTo: {}", newFile)
                if (file.renameTo(newFile)) {
                    fileList.add("/assets/" + type + "/" + fileName)
                }
            }
        }
        return returnData.setData(fileList.getList())
    }

    private suspend fun deleteFile(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
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
        if (!url.startsWith("/assets/")) {
            return returnData.setErrorMsg("文件链接错误")
        }
        var file = File(getWorkDir(url.replace("/assets/", "reader-assets/", false)))
        logger.info("delete file: {}", file)
        if (file.exists()) {
            file.delete()
        }
        return returnData.setData("")
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
                bookSource = getBookSourceString(context, "", -1)
            }
            if (bookSource.isNullOrEmpty()) {
                return returnData.setErrorMsg("未配置书源")
            }
            bookInfo = mergeBookCacheInfo(WebBook(bookSource).getBookInfo(bookUrl))
        } else {
            bookSource = getBookSourceString(context, bookInfo.origin)
        }
        if (bookSource.isNullOrEmpty()) {
            return returnData.setErrorMsg("未配置书源")
        }
        // 缓存章节列表
        logger.info("bookInfo: {}", bookInfo)
        var chapterList = getLocalChapterList(bookInfo, bookSource, refresh > 0, getUserNameSpace(context))

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
        var bookSource = getBookSourceString(context)
        var userNameSpace = getUserNameSpace(context)
        if (!bookUrl.isNullOrEmpty()) {
            bookUrl = URLDecoder.decode(bookUrl, "UTF-8")
            // 看看有没有加入书架
            var bookInfo = getShelfBookByURL(bookUrl, userNameSpace)
            if (bookInfo != null && !bookInfo.origin.isNullOrEmpty()) {
                bookSource = getInstalledBookSourceStringBySourceURL(bookInfo.origin)
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
                if (bookSource.isNullOrEmpty()) {
                    return returnData.setErrorMsg("未配置书源")
                }
                bookInfo = bookInfo ?: mergeBookCacheInfo(WebBook(bookSource).getBookInfo(bookUrl))
                var chapterList = getLocalChapterList(bookInfo, bookSource, false, userNameSpace)
                if (chapterIndex <= chapterList.size) {
                    var chapter = chapterList.get(chapterIndex)
                    saveShelfBookProgress(bookInfo, chapter, getUserNameSpace(context))
                    chapterUrl = chapter.url
                }
            }
        }
        if (bookSource.isNullOrEmpty()) {
            return returnData.setErrorMsg("未配置书源")
        }
        if (chapterUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("获取章节链接失败")
        }
        chapterUrl = URLDecoder.decode(chapterUrl, "UTF-8")

        val content = WebBook(bookSource).getBookContent(chapterUrl)

        return returnData.setData(content)
    }

    private suspend fun exploreBook(context: RoutingContext): ReturnData {
        var bookSource = getBookSourceString(context)
        val returnData = ReturnData()
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
        var bookSource = getBookSourceString(context)
        val returnData = ReturnData()
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
        val name: String
        var lastIndex: Int
        var searchSize: Int
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            name = context.bodyAsJson.getString("name")
            lastIndex = context.bodyAsJson.getInteger("lastIndex", -1)
            searchSize = context.bodyAsJson.getInteger("searchSize", 5)
        } else {
            // get 请求
            name = context.queryParam("name").firstOrNull() ?: ""
            lastIndex = context.queryParam("lastIndex").firstOrNull()?.toInt() ?: -1
            searchSize = context.queryParam("searchSize").firstOrNull()?.toInt() ?: 5
        }
        if (installedBookSourceList.size <= 0) {
            return returnData.setErrorMsg("未配置书源")
        }
        if (name.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入书名")
        }
        if (lastIndex >= installedBookSourceList.size) {
            return returnData.setErrorMsg("没有更多了")
        }
        logger.info { "searchBookSource" }
        lastIndex = lastIndex + 1
        searchSize = if(searchSize > 0) searchSize else 5
        var resultList = arrayListOf<SearchBook>()
        for (i in lastIndex until installedBookSourceList.size) {
            // logger.info("searchBookSource from Index: {}", i)
            var bookSource = installedBookSourceList.get(i)
            try {
                var result = saveBookInfoCache(WebBook(bookSource).searchBook(name, 1))
                if (result.size > 0) {
                    for (j in 0 until result.size) {
                        var _book = result.get(j)
                        if (_book.name.equals(name)) {
                            resultList.add(_book)
                        }
                    }
                }
            } catch(e: Exception) {

            }
            if (resultList.size >= searchSize) {
                lastIndex = i
                break;
            }
        }
        saveBookSources(name, resultList)
        return returnData.setData(mapOf("lastIndex" to lastIndex, "list" to resultList))
    }

    private suspend fun getBookSource(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        val name: String
        val bookUrl: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            name = context.bodyAsJson.getString("name")
            bookUrl = context.bodyAsJson.getString("url")
        } else {
            // get 请求
            name = context.queryParam("name").firstOrNull() ?: ""
            bookUrl = context.queryParam("url").firstOrNull() ?: ""
        }
        var book = getShelfBookByName(name, getUserNameSpace(context)) ?: getShelfBookByURL(bookUrl, getUserNameSpace(context))
        if (book == null) {
            book = bookInfoCache.get(bookUrl)?.toDataClass()
        }
        if (book == null) {
            return returnData.setErrorMsg("书籍信息错误")
        }
        var bookSourceList: JsonArray? = asJsonArray(getStorage("data/" + book.name + "/bookSource"))
        if (bookSourceList != null) {
            return returnData.setData(bookSourceList.getList())
        }
        return returnData.setData(arrayListOf<Int>())
    }

    private suspend fun saveSource(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val bookSource = context.bodyAsJson.mapTo(BookSource::class.java)
        var bookSourceList: JsonArray? = asJsonArray(getStorage("data/bookSource"))
        if (bookSourceList == null) {
            bookSourceList = JsonArray()
        }
        // 遍历判断书本是否存在
        var existIndex: Int = -1
        for (i in 0 until bookSourceList.size()) {
            var _bookSource = bookSourceList.getJsonObject(i).mapTo(BookSource::class.java)
            if (_bookSource.bookSourceName.equals(bookSource.bookSourceName)) {
                existIndex = i
                break;
            }
        }
        var bookSourceMap: Map<String, Any?> = bookSource.serializeToMap()
        if (existIndex >= 0) {
            var sourceList = bookSourceList.getList()
            sourceList.set(existIndex, bookSourceMap)
            bookSourceList = JsonArray(sourceList)
        } else {
            bookSourceList.add(bookSourceMap)
        }

        // logger.info("bookSourceList: {}", bookSourceList)
        saveStorage("data/bookSource", bookSourceList)
        loadInstalledBookSourceList();
        return returnData.setData(bookSourceList.getList())
    }

    private suspend fun saveSources(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val bookSourceJsonArray = context.bodyAsJsonArray
        var bookSourceList: JsonArray? = asJsonArray(getStorage("data/bookSource"))
        if (bookSourceList == null) {
            bookSourceList = JsonArray()
        }
        for (k in 0 until bookSourceJsonArray.size()) {
            var bookSource = bookSourceJsonArray.getJsonObject(k).mapTo(BookSource::class.java)
            // 遍历判断书本是否存在
            var existIndex: Int = -1
            for (i in 0 until bookSourceList!!.size()) {
                var _bookSource = bookSourceList.getJsonObject(i).mapTo(BookSource::class.java)
                if (_bookSource.bookSourceName.equals(bookSource.bookSourceName)) {
                    existIndex = i
                    break;
                }
            }
            var bookSourceMap: Map<String, Any?> = bookSource.serializeToMap()
            if (existIndex >= 0) {
                var sourceList = bookSourceList.getList()
                sourceList.set(existIndex, bookSourceMap)
                bookSourceList = JsonArray(sourceList)
            } else {
                bookSourceList.add(bookSourceMap)
            }
        }

        // logger.info("bookSourceList: {}", bookSourceList)
        saveStorage("data/bookSource", bookSourceList!!)
        loadInstalledBookSourceList();
        return returnData.setData(bookSourceList.getList())
    }

    private suspend fun getSources(context: RoutingContext): ReturnData {
        var bookSourceList: JsonArray? = asJsonArray(getStorage("data/bookSource"))
        val returnData = ReturnData()
        if (bookSourceList != null) {
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
        var bookSourceList: JsonArray? = asJsonArray(getStorage("data/bookSource"))
        if (bookSourceList == null) {
            bookSourceList = JsonArray()
        }
        // 遍历判断书本是否存在
        var existIndex: Int = -1
        for (i in 0 until bookSourceList.size()) {
            var _bookSource = bookSourceList.getJsonObject(i).mapTo(BookSource::class.java)
            if (_bookSource.bookSourceName.equals(bookSource.bookSourceName)) {
                existIndex = i
                break;
            }
        }
        if (existIndex >= 0) {
            bookSourceList.remove(existIndex)
        }

        // logger.info("bookSourceList: {}", bookSourceList)
        saveStorage("data/bookSource", bookSourceList)
        loadInstalledBookSourceList();
        return returnData.setData(bookSourceList.getList())
    }

    private suspend fun deleteSources(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val bookSourceJsonArray = context.bodyAsJsonArray
        var bookSourceList: JsonArray? = asJsonArray(getStorage("data/bookSource"))
        if (bookSourceList == null) {
            bookSourceList = JsonArray()
        }
        for (k in 0 until bookSourceJsonArray.size()) {
            var bookSource = bookSourceJsonArray.getJsonObject(k).mapTo(BookSource::class.java)
            // 遍历判断书本是否存在
            var existIndex: Int = -1
            for (i in 0 until bookSourceList.size()) {
                var _bookSource = bookSourceList.getJsonObject(i).mapTo(BookSource::class.java)
                if (_bookSource.bookSourceName.equals(bookSource.bookSourceName)) {
                    existIndex = i
                    break;
                }
            }
            if (existIndex >= 0) {
                bookSourceList.remove(existIndex)
            }
        }

        // logger.info("bookSourceList: {}", bookSourceList)
        saveStorage("data/bookSource", bookSourceList)
        loadInstalledBookSourceList();
        return returnData.setData(bookSourceList.getList())
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
        val params = context.bodyAsJson
        var name = params.getString("name")

        if (name != null) {
            var book = getShelfBookByName(name, getUserNameSpace(context))
            if (book != null) {
                return returnData.setData(book)
            } else {
                return returnData.setErrorMsg("书籍不存在")
            }
        }
        var url = params.getString("url")
        if (url != null) {
            var book = getShelfBookByURL(url, getUserNameSpace(context))
            if (book != null) {
                return returnData.setData(book)
            } else {
                return returnData.setErrorMsg("书籍不存在")
            }
        }
        return returnData.setErrorMsg("书籍不存在")
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
        if (book.tocUrl.isNullOrEmpty()) {
            // 补全书籍信息
            var bookSource = getInstalledBookSourceStringBySourceURL(book.origin)
            if (bookSource == null) {
                return returnData.setErrorMsg("书源信息错误")
            }
            var newBook = WebBook(bookSource).getBookInfo(book.bookUrl)
            book = newBook.fillData(book, listOf("name", "author", "coverUrl", "intro", "latestChapterTitle", "wordCount"))
        }
        book = mergeBookCacheInfo(book)
        var userNameSpace = getUserNameSpace(context)
        var bookshelf: JsonArray? = asJsonArray(getStorage("data/bookshelf" + userNameSpace))
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

            var bookMap: Map<String, Any?> = book.serializeToMap()
            bookList.set(existIndex, bookMap)
            bookshelf = JsonArray(bookList)
        } else {
            var bookMap: Map<String, Any?> = book.serializeToMap()
            bookshelf.add(bookMap)
        }
        logger.info("bookshelf: {}", bookshelf)
        saveStorage("data/bookshelf" + userNameSpace, bookshelf)
        return returnData.setData(book)
    }

    private suspend fun saveBookSource(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        var bookName: String
        var bookUrl: String
        var bookSourceUrl: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            bookUrl = context.bodyAsJson.getString("newUrl")
            bookName = context.bodyAsJson.getString("name")
            bookSourceUrl = context.bodyAsJson.getString("bookSourceUrl")
        } else {
            // get 请求
            bookUrl = context.queryParam("newUrl").firstOrNull() ?: ""
            bookName = context.queryParam("name").firstOrNull() ?: ""
            bookSourceUrl = context.queryParam("bookSourceUrl").firstOrNull() ?: ""
        }
        if (bookName.isNullOrEmpty()) {
            return returnData.setErrorMsg("书源名称不能为空")
        }
        if (bookUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("新源书籍链接不能为空")
        }
        if (bookSourceUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("书源链接不能为空")
        }
        var userNameSpace = getUserNameSpace(context)
        bookName = URLDecoder.decode(bookName, "UTF-8")
        var book = getShelfBookByName(bookName, userNameSpace)
        if (book == null) {
            return returnData.setErrorMsg("书籍信息错误")
        }
        bookSourceUrl = URLDecoder.decode(bookSourceUrl, "UTF-8")
        bookUrl = URLDecoder.decode(bookUrl, "UTF-8")
        // 查找是否存在该书源
        var bookSourceString = getInstalledBookSourceStringBySourceURL(bookSourceUrl)

        if (bookSourceString.isNullOrEmpty()) {
            return returnData.setErrorMsg("书源信息错误")
        }

        var newBookInfo = WebBook(bookSourceString).getBookInfo(bookUrl)

        var bookSource: BookSource = bookSourceString.toMap().toDataClass()

        var bookshelf: JsonArray? = asJsonArray(getStorage("data/bookshelf" + userNameSpace))
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
        if (existIndex < 0) {
            return returnData.setErrorMsg("书籍信息错误")
        }
        var bookList = bookshelf.getList()
        book.origin = bookSource.bookSourceUrl
        book.originName = bookSource.bookSourceName
        book.bookUrl = bookUrl
        book.tocUrl = newBookInfo.tocUrl
        book = mergeBookCacheInfo(book)

        var bookMap: Map<String, Any?> = book.serializeToMap()
        bookList.set(existIndex, bookMap)
        bookshelf = JsonArray(bookList)
        logger.info("bookshelf: {}", bookshelf)
        saveStorage("data/bookshelf" + userNameSpace, bookshelf)
        return returnData.setData(book)
    }

    private suspend fun deleteBook(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val book = context.bodyAsJson.mapTo(Book::class.java)
        var userNameSpace = getUserNameSpace(context)
        var bookshelf: JsonArray? = asJsonArray(getStorage("data/bookshelf" + userNameSpace))
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
        logger.info("bookshelf: {}", bookshelf)
        saveStorage("data/bookshelf" + userNameSpace, bookshelf)
        return returnData.setData(bookshelf.getList())
    }



    /**
     * 非 API
     */
    private suspend fun loadBookCacheInfo() {
        var _bookInfoCache: JsonObject? = asJsonObject(getStorage("data/bookInfoCache"))
        if (_bookInfoCache != null) {
            bookInfoCache = _bookInfoCache.map as MutableMap<String, Map<String, Any>>
            // logger.info("load bookInfoCache {}", bookInfoCache)
        }
    }

    private suspend fun mergeBookCacheInfo(book: Book): Book {
        var cacheInfo: Book? = bookInfoCache.get(book.bookUrl)?.toDataClass()

        if (cacheInfo != null) {
            return book.fillData(cacheInfo, listOf("name", "author", "coverUrl", "intro", "latestChapterTitle", "wordCount"))
        }
        return book
    }

    private suspend fun saveBookInfoCache(bookList: List<SearchBook>): List<SearchBook> {
        if (bookList.size > 0) {
            for (i in 0 until bookList.size) {
                var book = bookList.get(i)
                bookInfoCache.put(book.bookUrl, book.serializeToMap())
            }
            saveStorage("data/bookInfoCache", bookInfoCache)
        }
        return bookList
    }

    private suspend fun getBookShelfBooks(refresh: Boolean = false, userNameSpace: String): List<Book> {
        var bookshelf: JsonArray? = asJsonArray(getStorage("data/bookshelf" + userNameSpace))
        if (bookshelf == null) {
            return arrayListOf<Book>()
        }
        var bookList = arrayListOf<Book>()
        for (i in 0 until bookshelf.size()) {
            var book = bookshelf.getJsonObject(i).mapTo(Book::class.java)
            if (refresh) {
                var bookSource = getInstalledBookSourceStringBySourceURL(book.origin)
                if (bookSource != null) {
                    var bookChapterList = getLocalChapterList(book, bookSource, refresh, userNameSpace)
                    var bookChapter = bookChapterList.last()
                    book.lastCheckTime = System.currentTimeMillis()
                    book.lastCheckCount = bookChapterList.size - book.totalChapterNum
                    book.latestChapterTitle = bookChapter.title
                    book.totalChapterNum = bookChapterList.size
                }
            }
            bookList.add(book)
        }
        return bookList
    }


    private suspend fun getLocalChapterList(book: Book, bookSource: String, refresh: Boolean = false, userNameSpace: String): List<BookChapter> {
        val md5Encode = MD5Utils.md5Encode(book.bookUrl).toString()
        var chapterList: JsonArray? = asJsonArray(getStorage("data/" + book.name + "/" + md5Encode))

        if (chapterList == null || refresh) {
            var onlineChapterList = WebBook(bookSource).getChapterList(book)
            saveStorage(book.name + "/" + md5Encode, onlineChapterList)
            saveShelfBookLatestChapter(book, onlineChapterList, userNameSpace)
            return onlineChapterList
        }
        var localChapterList = arrayListOf<BookChapter>()
        for (i in 0 until chapterList.size()) {
            var _chapter = chapterList.getJsonObject(i).mapTo(BookChapter::class.java)
            localChapterList.add(_chapter)
        }
        return localChapterList
    }

    private suspend fun getBookSourceString(context: RoutingContext, sourceUrl: String = "", sourceIndex: Int = 0): String? {
        var bookSourceString: String? = null
        if (context.request().method() == HttpMethod.POST) {
            var bookSource = context.bodyAsJson.getJsonObject("bookSource")
            if (bookSource != null) {
                bookSourceString = bookSource.toString()
            }
        }
        if (bookSourceString.isNullOrEmpty()) {
            var bookSourceIndex: Int
            if (context.request().method() == HttpMethod.POST) {
                bookSourceIndex = context.bodyAsJson.getInteger("bookSourceIndex", -1)
            } else {
                bookSourceIndex = context.queryParam("bookSourceIndex").firstOrNull()?.toInt() ?: -1
            }
            bookSourceString = getInstalledBookSourceString(bookSourceIndex)
        }
        if (bookSourceString.isNullOrEmpty()) {
            var bookSourceUrl: String
            if (context.request().method() == HttpMethod.POST) {
                bookSourceUrl = context.bodyAsJson.getString("bookSourceUrl", "")
            } else {
                bookSourceUrl = context.queryParam("bookSourceUrl").firstOrNull() ?: ""
            }
            bookSourceUrl = URLDecoder.decode(bookSourceUrl, "UTF-8")
            bookSourceString = getInstalledBookSourceStringBySourceURL(bookSourceUrl)
        }
        if (bookSourceString.isNullOrEmpty() && !sourceUrl.isNullOrEmpty()) {
            bookSourceString = getInstalledBookSourceStringBySourceURL(sourceUrl)
        }
        if (bookSourceString.isNullOrEmpty()) {
            bookSourceString = getInstalledBookSourceString(sourceIndex)
        }
        // 使用默认
        return bookSourceString
    }

    private suspend fun loadInstalledBookSourceList() {
        var bookSourceList: JsonArray? = asJsonArray(getStorage("data/bookSource"))
        if (bookSourceList != null) {
            installedBookSourceList = arrayListOf<String>()
            for (i in 0 until bookSourceList.size()) {
                installedBookSourceList.add(bookSourceList.getJsonObject(i).toString())
            }
        }
    }

    private suspend fun getInstalledBookSourceString(sourceIndex: Int = -1): String? {
        var bookSourceString: String? = null
        if (sourceIndex >= 0 && sourceIndex <= installedBookSourceList.size) {
            bookSourceString = installedBookSourceList.get(sourceIndex)
        }
        return bookSourceString
    }

    private suspend fun getInstalledBookSourceStringByCustomOrder(customOrder: Int): String? {
        var bookSourceString: String? = null
        for (i in 0 until installedBookSourceList.size) {
            val sourceMap = installedBookSourceList.get(i).toMap()
            if (customOrder == (sourceMap.get("customOrder") as Number)) {
                bookSourceString = installedBookSourceList.get(i)
                break;
            }
        }
        return bookSourceString
    }

    private suspend fun getInstalledBookSourceStringBySourceURL(sourceUrl: String): String? {
        var bookSourceString: String? = null
        if (sourceUrl.isNullOrEmpty()) {
            return bookSourceString
        }
        for (i in 0 until installedBookSourceList.size) {
            val sourceMap = installedBookSourceList.get(i).toMap()
            if (sourceUrl == (sourceMap.get("bookSourceUrl") as String)) {
                bookSourceString = installedBookSourceList.get(i)
                break;
            }
        }
        return bookSourceString
    }

    private suspend fun getShelfBookByURL(url: String, userNameSpace: String): Book? {
        var bookshelf: JsonArray? = asJsonArray(getStorage("data/bookshelf" + userNameSpace))
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

    private suspend fun getShelfBookByName(name: String, userNameSpace: String): Book? {
        var bookshelf: JsonArray? = asJsonArray(getStorage("data/bookshelf" + userNameSpace))
        if (bookshelf == null) {
            return null
        }
        for (i in 0 until bookshelf.size()) {
            var _book = bookshelf.getJsonObject(i).mapTo(Book::class.java)
            if (_book.name.equals(name)) {
                return _book
            }
        }
        return null
    }

    private suspend fun saveShelfBookProgress(book: Book, bookChapter: BookChapter, userNameSpace: String) {
        var bookshelf: JsonArray? = asJsonArray(getStorage("data/bookshelf" + userNameSpace))
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
            existBook.durChapterIndex = bookChapter.index
            existBook.durChapterTitle = bookChapter.title
            existBook.durChapterTime = System.currentTimeMillis()

            logger.info("saveShelfBookProgress: {}", existBook)

            var existBookMap: Map<String, Any?> = existBook.serializeToMap()
            bookList.set(existIndex, existBookMap)
            bookshelf = JsonArray(bookList)
            saveStorage("data/bookshelf" + userNameSpace, bookshelf)
        }
    }

    private suspend fun saveShelfBookLatestChapter(book: Book, bookChapterList: List<BookChapter>, userNameSpace: String) {
        var bookshelf: JsonArray? = asJsonArray(getStorage("data/bookshelf" + userNameSpace))
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
            var bookChapter = bookChapterList.last()
            var bookList = bookshelf.getList()
            var existBook = bookshelf.getJsonObject(existIndex).mapTo(Book::class.java)
            existBook.latestChapterTitle = bookChapter.title
            existBook.lastCheckCount = bookChapterList.size - existBook.totalChapterNum
            existBook.totalChapterNum = bookChapterList.size
            existBook.lastCheckTime = System.currentTimeMillis()
            // TODO 最新章节更新时间
            // existBook.latestChapterTime = System.currentTimeMillis()

            logger.info("saveShelfBookLatestChapter: {}", existBook)

            var existBookMap: Map<String, Any?> = existBook.serializeToMap()
            bookList.set(existIndex, existBookMap)
            bookshelf = JsonArray(bookList)
            saveStorage("data/bookshelf" + userNameSpace, bookshelf)
        }
    }

    private suspend fun saveBookSources(bookName: String, sourceList: List<SearchBook>) {
        var bookSourceList: JsonArray? = asJsonArray(getStorage("data/" + bookName + "/bookSource"))
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
            var searchBookMap: Map<String, Any?> = searchBook.serializeToMap()
            if (existIndex >= 0) {
                var _sourceList = bookSourceList.getList()
                _sourceList.set(existIndex, searchBookMap)
                bookSourceList = JsonArray(_sourceList)
            } else {
                bookSourceList.add(searchBookMap)
            }
        }

        // logger.info("bookSourceList: {}", bookSourceList)
        saveStorage(bookName + "/bookSource", bookSourceList!!)
    }
}