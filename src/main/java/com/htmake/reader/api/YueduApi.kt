package com.htmake.reader.api

import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import io.legado.app.data.entities.SearchBook
import io.legado.app.data.entities.BookGroup
import io.legado.app.data.entities.BookSource
import io.legado.app.data.entities.RssSource
import io.legado.app.data.entities.RssArticle
import io.legado.app.model.webBook.WebBook
import io.vertx.ext.web.Router
import io.vertx.ext.web.RoutingContext
import io.vertx.ext.web.handler.StaticHandler;
import mu.KotlinLogging
import com.htmake.reader.config.AppConfig
import com.htmake.reader.config.BookConfig
import io.legado.app.constant.DeepinkBookSource
import com.htmake.reader.api.controller.BookController
import com.htmake.reader.api.controller.BookSourceController
import com.htmake.reader.api.controller.RssSourceController
import com.htmake.reader.api.controller.UserController
import com.htmake.reader.api.controller.WebdavController
import com.htmake.reader.api.controller.ReplaceRuleController
import com.htmake.reader.utils.error
import com.htmake.reader.utils.success
import com.htmake.reader.utils.getStorage
import com.htmake.reader.utils.saveStorage
import com.htmake.reader.utils.asJsonArray
import com.htmake.reader.utils.asJsonObject
import com.htmake.reader.utils.toDataClass
import com.htmake.reader.utils.toMap
import com.htmake.reader.utils.fillData
import com.htmake.reader.utils.getWorkDir
import com.htmake.reader.utils.getRandomString
import com.htmake.reader.utils.genEncryptedPassword
import com.htmake.reader.entity.User
import com.htmake.reader.utils.SpringContextUtils
import com.htmake.reader.utils.deleteRecursively
import com.htmake.reader.utils.unzip
import com.htmake.reader.utils.zip
import com.htmake.reader.utils.jsonEncode
import com.htmake.reader.utils.getRelativePath
import com.htmake.reader.verticle.RestVerticle
import com.htmake.reader.SpringEvent
import org.springframework.stereotype.Component
import io.vertx.core.json.JsonObject
import io.vertx.core.json.JsonArray
import io.vertx.core.http.HttpMethod
import com.htmake.reader.api.ReturnData
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
import kotlin.system.measureTimeMillis
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat;
import io.legado.app.utils.EncoderUtils
import io.legado.app.model.rss.Rss
import org.springframework.scheduling.annotation.Scheduled
import io.legado.app.model.localBook.LocalBook
import java.nio.file.Paths
import kotlinx.coroutines.withContext
import kotlinx.coroutines.async
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.CoroutineScope

private val logger = KotlinLogging.logger {}

@Component
class YueduApi : RestVerticle() {
    @Autowired
    private lateinit var appConfig: AppConfig

    @Autowired
    private lateinit var env: Environment

    override suspend fun initRouter(router: Router) {
        setupPort()

        // 旧版数据迁移
        migration()

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
        router.route("/epub/*").handler {
            var path = it.request().path().replace("/epub/", "/", true)
            path = URLDecoder.decode(path, "UTF-8")
            if (path.endsWith("html", true)) {
                var filePath = File(dataDir + path)
                if (filePath.exists()) {
                    // 处理 js 注入脚本
                    BookConfig.injectJavascriptToEpubChapter(filePath.toString())
                }
            }
            it.next()
        }
        router.route("/epub/*").handler(StaticHandler.create().setAllowRootFileSystemAccess(true).setWebRoot(dataDir).setDefaultContentEncoding("UTF-8"));

        // 获取系统信息
        router.get("/reader3/getSystemInfo").coroutineHandler { getSystemInfo(it) }


        ////////// 接口部分
        val bookController = BookController(coroutineContext)
        val bookSourceController = BookSourceController(coroutineContext)
        val rssSourceController = RssSourceController(coroutineContext)
        val userController = UserController(coroutineContext)
        val webdavController = WebdavController(coroutineContext, router) { ctx, error ->
            onHandlerError(ctx, error)
        }
        val replaceRuleController = ReplaceRuleController(coroutineContext)

        /** 书源模块 */
        router.post("/reader3/saveSource").coroutineHandler { bookSourceController.saveSource(it) }
        router.post("/reader3/saveSources").coroutineHandler { bookSourceController.saveSources(it) }

        router.get("/reader3/getSource").coroutineHandler { bookSourceController.getSource(it) }
        router.post("/reader3/getSource").coroutineHandler { bookSourceController.getSource(it) }
        router.get("/reader3/getSources").coroutineHandler { bookSourceController.getSources(it) }
        router.post("/reader3/getSources").coroutineHandler { bookSourceController.getSources(it) }

        router.post("/reader3/deleteSource").coroutineHandler { bookSourceController.deleteSource(it) }
        router.post("/reader3/deleteSources").coroutineHandler { bookSourceController.deleteSources(it) }
        router.post("/reader3/deleteAllSources").coroutineHandler { bookSourceController.deleteAllSources(it) }

        // 上传书源文件
        router.post("/reader3/readSourceFile").coroutineHandler { bookSourceController.readSourceFile(it) }

        // 读取远程书源文件
        router.post("/reader3/readRemoteSourceFile").coroutineHandlerWithoutRes { bookSourceController.readRemoteSourceFile(it) }


        /** 书籍模块 */
        // 书架
        router.get("/reader3/getBookshelf").coroutineHandler { bookController.getBookshelf(it) }
        router.get("/reader3/getShelfBook").coroutineHandler { bookController.getShelfBook(it) }
        router.post("/reader3/saveBook").coroutineHandler { bookController.saveBook(it) }
        router.post("/reader3/deleteBook").coroutineHandler { bookController.deleteBook(it) }

        // 失效书源
        router.post("/reader3/getInvalidBookSources").coroutineHandler { bookController.getInvalidBookSources(it) }

        // 探索
        router.post("/reader3/exploreBook").coroutineHandler { bookController.exploreBook(it) }
        router.get("/reader3/exploreBook").coroutineHandler { bookController.exploreBook(it) }

        // 搜索
        router.get("/reader3/searchBook").coroutineHandler { bookController.searchBook(it) }
        router.post("/reader3/searchBook").coroutineHandler { bookController.searchBook(it) }
        router.get("/reader3/searchBookMulti").coroutineHandler { bookController.searchBookMulti(it) }
        router.post("/reader3/searchBookMulti").coroutineHandler { bookController.searchBookMulti(it) }
        router.get("/reader3/searchBookMultiSSE").coroutineHandlerWithoutRes { bookController.searchBookMultiSSE(it) }

        // 书籍详情
        router.get("/reader3/getBookInfo").coroutineHandler { bookController.getBookInfo(it) }
        router.post("/reader3/getBookInfo").coroutineHandler { bookController.getBookInfo(it) }

        // 章节列表
        router.get("/reader3/getChapterList").coroutineHandler { bookController.getChapterList(it) }
        router.post("/reader3/getChapterList").coroutineHandler { bookController.getChapterList(it) }

        // 内容
        router.get("/reader3/getBookContent").coroutineHandler { bookController.getBookContent(it) }
        router.post("/reader3/getBookContent").coroutineHandler { bookController.getBookContent(it) }

        // 保存阅读进度
        router.post("/reader3/saveBookProgress").coroutineHandler { bookController.saveBookProgress(it) }

        // 封面
        router.get("/reader3/cover").coroutineHandlerWithoutRes { bookController.getBookCover(it) }

        // 搜索其它来源
        router.get("/reader3/searchBookSource").coroutineHandler { bookController.searchBookSource(it) }
        router.get("/reader3/getBookSource").coroutineHandler { bookController.getBookSource(it) }
        router.get("/reader3/searchBookSourceSSE").coroutineHandlerWithoutRes { bookController.searchBookSourceSSE(it) }

        // 换源
        router.get("/reader3/saveBookSource").coroutineHandler { bookController.saveBookSource(it) }
        router.post("/reader3/saveBookSource").coroutineHandler { bookController.saveBookSource(it) }

        // 修改分组
        router.post("/reader3/saveBookGroupId").coroutineHandler { bookController.saveBookGroupId(it) }

        // 导入本地文件
        router.post("/reader3/importBookPreview").coroutineHandler { bookController.importBookPreview(it) }
        router.post("/reader3/refreshLocalBook").coroutineHandler { bookController.refreshLocalBook(it) }

        // 获取txt章节规则
        router.get("/reader3/getTxtTocRules").coroutineHandler { bookController.getTxtTocRules(it) }
        router.post("/reader3/getChapterListByRule").coroutineHandler { bookController.getChapterListByRule(it) }

        // 书籍分组
        router.get("/reader3/getBookGroups").coroutineHandler { bookController.getBookGroups(it) }
        router.post("/reader3/saveBookGroup").coroutineHandler { bookController.saveBookGroup(it) }
        router.post("/reader3/deleteBookGroup").coroutineHandler { bookController.deleteBookGroup(it) }

        // 书仓功能
        // 获取书仓文件列表
        router.get("/reader3/getLocalStoreFileList").coroutineHandler { bookController.getLocalStoreFileList(it) }
        // 下载书仓文件
        router.get("/reader3/getLocalStoreFile").coroutineHandlerWithoutRes { bookController.getLocalStoreFile(it) }
        // 删除书仓文件
        router.post("/reader3/deleteLocalStoreFile").coroutineHandler { bookController.deleteLocalStoreFile(it) }
        router.post("/reader3/deleteLocalStoreFileList").coroutineHandler { bookController.deleteLocalStoreFileList(it) }
        // 从书仓导入
        router.post("/reader3/importFromLocalStorePreview").coroutineHandler { bookController.importFromLocalStorePreview(it) }
        // 上传文件到书仓
        router.post("/reader3/uploadFileToLocalStore").coroutineHandler { bookController.uploadFileToLocalStore(it) }

        /** 用户模块 */
        // 上传文件
        router.post("/reader3/uploadFile").coroutineHandler { userController.uploadFile(it) }

        // 删除文件
        router.post("/reader3/deleteFile").coroutineHandler { userController.deleteFile(it) }

        // 登录
        router.post("/reader3/login").coroutineHandler { userController.login(it) }
        // 注销登录
        router.post("/reader3/logout").coroutineHandler { userController.logout(it) }

        // 获取用户信息
        router.get("/reader3/getUserInfo").coroutineHandler { userController.getUserInfo(it) }

        // 用户备份本地配置
        router.post("/reader3/saveUserConfig").coroutineHandler { userController.saveUserConfig(it) }

        // 用户恢复本地配置
        router.get("/reader3/getUserConfig").coroutineHandler { userController.getUserConfig(it) }

        // 获取用户列表
        router.get("/reader3/getUserList").coroutineHandler { userController.getUserList(it) }

        // 删除用户
        router.post("/reader3/deleteUsers").coroutineHandler { userController.deleteUsers(it) }

        // 添加用户
        router.post("/reader3/addUser").coroutineHandler { userController.addUser(it) }

        // 重置用户密码
        router.post("/reader3/resetPassword").coroutineHandler { userController.resetPassword(it) }

        // 更新用户
        router.post("/reader3/updateUser").coroutineHandler { userController.updateUser(it) }


        /** webdav模块 */
        // 获取webdav备份列表
        router.get("/reader3/getWebdavFileList").coroutineHandler { webdavController.getWebdavFileList(it) }

        // 下载webdav文件
        router.get("/reader3/getWebdavFile").coroutineHandlerWithoutRes { webdavController.getWebdavFile(it) }

        // 删除webdav文件
        router.get("/reader3/deleteWebdavFile").coroutineHandler { webdavController.deleteWebdavFile(it) }
        router.post("/reader3/deleteWebdavFile").coroutineHandler { webdavController.deleteWebdavFile(it) }
        router.post("/reader3/deleteWebdavFileList").coroutineHandler { webdavController.deleteWebdavFileList(it) }

        // 从webdav备份恢复
        router.post("/reader3/restoreFromWebdav").coroutineHandler { webdavController.restoreFromWebdav(it) }

        // 备份到webdav
        router.post("/reader3/backupToWebdav").coroutineHandler { webdavController.backupToWebdav(it) }


        /** rss模块 */
        // rss
        router.get("/reader3/getRssSources").coroutineHandler { rssSourceController.getRssSources(it) }
        router.post("/reader3/saveRssSource").coroutineHandler { rssSourceController.saveRssSource(it) }
        router.post("/reader3/saveRssSources").coroutineHandler { rssSourceController.saveRssSources(it) }
        router.post("/reader3/deleteRssSource").coroutineHandler { rssSourceController.deleteRssSource(it) }
        // rss 列表
        router.get("/reader3/getRssArticles").coroutineHandler { rssSourceController.getRssArticles(it) }
        router.post("/reader3/getRssArticles").coroutineHandler { rssSourceController.getRssArticles(it) }
        // rss 内容
        router.get("/reader3/getRssContent").coroutineHandler { rssSourceController.getRssContent(it) }
        router.post("/reader3/getRssContent").coroutineHandler { rssSourceController.getRssContent(it) }

        /** 替换规则模块 */
        router.get("/reader3/getReplaceRules").coroutineHandler { replaceRuleController.getReplaceRules(it) }
        router.post("/reader3/saveReplaceRule").coroutineHandler { replaceRuleController.saveReplaceRule(it) }
        router.post("/reader3/saveReplaceRules").coroutineHandler { replaceRuleController.saveReplaceRules(it) }
        router.post("/reader3/deleteReplaceRule").coroutineHandler { replaceRuleController.deleteReplaceRule(it) }
        router.post("/reader3/deleteReplaceRules").coroutineHandler { replaceRuleController.deleteReplaceRules(it) }

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
            var storageDir = File(getWorkDir("storage"))
            var dataDir = File(getWorkDir("storage", "data", "default"))
            if (!storageDir.exists()) {
                // 直接使用新版本，则创建 default 目录，防止重启之后被迁移
                dataDir.mkdirs()
            } else if (!dataDir.exists()) {
                // 旧版本不管了
                dataDir.mkdirs()
                // 可能存在旧版本，尝试迁移
                // var backupDir = File(getWorkDir("storage-backup"))
                // storageDir.renameTo(backupDir)
                // dataDir.parentFile.mkdirs()
                // backupDir.copyRecursively(dataDir)
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
            ctx.success(returnData.setErrorMsg(error.toString()))
        } else {
            ctx.response().end(error.toString())
        }
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
                val bookController = BookController(coroutineContext)

                logger.info("开始检查书架书籍更新")
                // 刷新系统默认书架
                bookController.getBookShelfBooks(true, "default")

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
                                bookController.getBookShelfBooks(true, ns)
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

    /**
     * 每天清理不活跃用户
     */
    @Scheduled(cron = "0 59 23 * * ?")
    fun clearUser()
    {
        if (appConfig.autoClearInactiveUser <= 0 || !appConfig.secure) {
            return
        }
        launch(Dispatchers.IO) {
            try {
                logger.info("开始清理 {} 天未登录用户", appConfig.autoClearInactiveUser)

                var userMap = mutableMapOf<String, Map<String, Any>>()
                var userMapJson: JsonObject? = asJsonObject(getStorage("data", "users"))
                if (userMapJson != null) {
                    userMap = userMapJson.map as MutableMap<String, Map<String, Any>>
                }
                val expireTime = System.currentTimeMillis() - appConfig.autoClearInactiveUser * 86400L * 1000L
                userMap.keys.forEach{
                    try {
                        var user = userMap.get(it)
                        if (user != null) {
                            var username = user.getOrDefault("username", "") as String? ?: ""
                            var last_login_at = user.getOrDefault("last_login_at", 0) as Long? ?: 0L
                            if (username.isNotEmpty() && last_login_at < expireTime) {
                                logger.info("delete user: {}", user)
                                // 删除用户信息
                                userMap.remove(username)
                                // 移除用户目录
                                var userHome = File(getWorkDir("storage", "data", username))
                                logger.info("delete userHome: {}", userHome)
                                if (userHome.exists()) {
                                    userHome.deleteRecursively()
                                }
                            }
                        }
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }
                logger.info("不活跃用户自动清理结束")
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }
}