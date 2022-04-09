package com.htmake.reader.api.controller

import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import io.legado.app.data.entities.SearchBook
import io.legado.app.data.entities.BookGroup
import io.legado.app.data.entities.BookSource
import io.legado.app.data.entities.RssSource
import io.legado.app.data.entities.RssArticle
import io.legado.app.help.storage.OldRule
import io.legado.app.model.webBook.WebBook
import io.vertx.ext.web.Route
import io.vertx.ext.web.Router
import io.vertx.ext.web.RoutingContext
import io.vertx.ext.web.handler.StaticHandler;
import mu.KotlinLogging
import com.htmake.reader.config.AppConfig
import com.htmake.reader.config.BookConfig
import io.legado.app.constant.DeepinkBookSource
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
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat;
import io.legado.app.utils.EncoderUtils
import io.legado.app.utils.ACache
import io.legado.app.model.rss.Rss
import org.springframework.scheduling.annotation.Scheduled
import io.legado.app.localBook.LocalBook
import java.nio.file.Paths
import kotlinx.coroutines.withContext
import kotlinx.coroutines.async
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.CoroutineScope
// import io.legado.app.help.coroutine.Coroutine

private val logger = KotlinLogging.logger {}

class BookController(coroutineContext: CoroutineContext): BaseController(coroutineContext) {

    var bookInfoCache = ACache.get("bookInfoCache", 1000 * 1000 * 2L, 10000) // 缓存 2M 的书籍信息
    var invalidBookSourceList = arrayListOf<Map<String, Any>>()

    private var webClient: WebClient

    init {
        // 加载失效书源列表
        loadInvalidBookSourceList();

        webClient = SpringContextUtils.getBean("webClient", WebClient::class.java)
    }

    suspend fun getBookInfo(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        var bookUrl: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            bookUrl = context.bodyAsJson.getString("url") ?: context.bodyAsJson.getJsonObject("searchBook").getString("bookUrl") ?: ""
        } else {
            // get 请求
            bookUrl = context.queryParam("url").firstOrNull() ?: ""
            bookUrl = URLDecoder.decode(bookUrl, "UTF-8")
        }
        if (bookUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入书籍链接")
        }
        logger.info("getBookInfo with bookUrl: {}", bookUrl)
        var bookInfo: Book? = null
        if (checkAuth(context)) {
            bookInfo = getShelfBookByURL(bookUrl, getUserNameSpace(context))
        }
        if (bookInfo == null) {
            // 看看有没有缓存数据
            var bookSource: String? = null
            var cacheInfo: Book? = bookInfoCache.getAsString(bookUrl)?.toMap()?.toDataClass()
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

        // 缓存书籍信息
        saveBookInfoCache(arrayListOf<Book>(bookInfo))
        return returnData.setData(bookInfo)
    }

    suspend fun getBookCover(context: RoutingContext) {
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

    suspend fun importBookPreview(context: RoutingContext): ReturnData {
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
                    val book = Book.initLocalBook(localFileUrl, localFilePath, getWorkDir())
                    val chapters = LocalBook.getChapterList(book)
                    fileList.add(mapOf("book" to book, "chapters" to chapters))
                }
                file.deleteRecursively()
            }
        }
        return returnData.setData(fileList)
    }

    suspend fun refreshLocalBook(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        var bookUrl: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            bookUrl = context.bodyAsJson.getString("bookUrl")
        } else {
            // get 请求
            bookUrl = context.queryParam("bookUrl").firstOrNull() ?: ""
            bookUrl = URLDecoder.decode(bookUrl, "UTF-8")
        }
        if (bookUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入书籍链接")
        }
        // 根据书籍url获取书本信息
        var userNameSpace = getUserNameSpace(context)
        var bookInfo = getShelfBookByURL(bookUrl, userNameSpace)
        if (bookInfo == null) {
            return returnData.setErrorMsg("书籍信息错误")
        }
        bookInfo.updateFromLocal(true)

        editShelfBook(bookInfo, userNameSpace) { existBook ->
            existBook.coverUrl = bookInfo.coverUrl
            logger.info("refreshLocalBook: {}", existBook)
            existBook
        }

        return returnData.setData(bookInfo)
    }

    suspend fun getChapterList(context: RoutingContext): ReturnData {
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
            bookUrl = URLDecoder.decode(bookUrl, "UTF-8")
        }
        if (bookUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入书籍链接")
        }
        // 根据书籍url获取书本信息
        var userNameSpace = getUserNameSpace(context)
        var bookInfo = getShelfBookByURL(bookUrl, userNameSpace)
        var bookSource: String? = null
        if (bookInfo == null) {
            // 看看有没有缓存数据
            var cacheInfo: Book? = bookInfoCache.getAsString(bookUrl)?.toMap()?.toDataClass()
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
            // 缓存书籍信息
            saveBookInfoCache(arrayListOf<Book>(bookInfo))
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

    suspend fun saveBookProgress(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        var bookUrl: String
        var chapterIndex: Int
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            bookUrl = context.bodyAsJson.getString("url") ?: context.bodyAsJson.getJsonObject("searchBook").getString("bookUrl") ?: ""
            chapterIndex = context.bodyAsJson.getInteger("index", -1)
        } else {
            // get 请求
            bookUrl = context.queryParam("url").firstOrNull() ?: ""
            chapterIndex = context.queryParam("index").firstOrNull()?.toInt() ?: -1
            bookUrl = URLDecoder.decode(bookUrl, "UTF-8")
        }
        if (bookUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入书籍链接")
        }
        var userNameSpace = getUserNameSpace(context)
        // 看看有没有加入书架
        var bookInfo = getShelfBookByURL(bookUrl, userNameSpace)
        if (bookInfo == null || bookInfo.origin.isNullOrEmpty()) {
            return returnData.setErrorMsg("书籍未加入书架")
        }
        var bookSource = getBookSourceStringBySourceURL(bookInfo.origin, userNameSpace)

        if (!bookInfo.isLocalBook() && bookSource.isNullOrEmpty()) {
            return returnData.setErrorMsg("未配置书源")
        }
        var chapterList = getLocalChapterList(bookInfo, bookSource ?: "", false, userNameSpace)
        if (chapterIndex >= chapterList.size) {
            return returnData.setErrorMsg("章节不存在")
        }
        var chapterInfo = chapterList.get(chapterIndex)
        // 书架书籍保存阅读进度
        saveShelfBookProgress(bookInfo, chapterInfo, userNameSpace)
        // 保存到 webdav
        saveBookProgressToWebdav(bookInfo, chapterInfo, userNameSpace)
        return returnData.setData("")
    }

    suspend fun getBookContent(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        var chapterUrl: String
        var bookUrl: String
        var chapterIndex: Int
        var cache: Int
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            chapterUrl = context.bodyAsJson.getString("chapterUrl") ?: context.bodyAsJson.getJsonObject("bookChapter").getString("url") ?: ""
            bookUrl = context.bodyAsJson.getString("url") ?: context.bodyAsJson.getJsonObject("searchBook").getString("bookUrl") ?: ""
            chapterIndex = context.bodyAsJson.getInteger("index", -1)
            cache = context.bodyAsJson.getInteger("cache", 0)
        } else {
            // get 请求
            chapterUrl = context.queryParam("chapterUrl").firstOrNull() ?: ""
            bookUrl = context.queryParam("url").firstOrNull() ?: ""
            chapterIndex = context.queryParam("index").firstOrNull()?.toInt() ?: -1
            bookUrl = URLDecoder.decode(bookUrl, "UTF-8")
            chapterUrl = URLDecoder.decode(chapterUrl, "UTF-8")
            cache = context.queryParam("cache").firstOrNull()?.toInt() ?: 0
        }
        if (bookUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入书籍链接")
        }
        var bookSource = getBookSourceString(context)
        var userNameSpace = getUserNameSpace(context)
        var isInBookShelf = false
        var bookInfo: Book? = null
        var chapterInfo: BookChapter? = null
        var nextChapterUrl: String? = null
        if (!bookUrl.isNullOrEmpty()) {
            // 看看有没有加入书架
            bookInfo = getShelfBookByURL(bookUrl, userNameSpace)
            if (bookInfo != null && !bookInfo.origin.isNullOrEmpty()) {
                isInBookShelf = true
                bookSource = getBookSourceStringBySourceURL(bookInfo.origin, userNameSpace)
            }
            // 看看有没有缓存数据
            var cacheInfo: Book? = bookInfoCache.getAsString(bookUrl)?.toMap()?.toDataClass()
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
                if (chapterIndex < chapterList.size) {
                    chapterInfo = chapterList.get(chapterIndex)
                    // 书架书籍保存阅读进度
                    if (isInBookShelf && cache != 1) {
                        saveShelfBookProgress(bookInfo, chapterInfo, userNameSpace)
                        // 保存到 webdav
                        saveBookProgressToWebdav(bookInfo, chapterInfo, userNameSpace)
                    }
                    chapterUrl = chapterInfo.url
                    if (chapterIndex + 1 < chapterList.size) {
                        var nextChapterInfo = chapterList.get(chapterIndex + 1)
                        nextChapterUrl = nextChapterInfo.url
                    }
                }
            }
        }
        if (bookInfo == null) {
            return returnData.setErrorMsg("获取书籍信息失败")
        }
        if (!bookInfo.isLocalBook() && bookSource.isNullOrEmpty()) {
            return returnData.setErrorMsg("未配置书源")
        }
        if (chapterInfo == null || chapterUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("获取章节链接失败")
        }

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
                if (!extractEpub(bookInfo)) {
                    return returnData.setErrorMsg("Epub书籍解压失败")
                }

                val epubRootDir = bookInfo.getEpubRootDir()
                var chapterFilePath = getWorkDir(bookInfo.originName, "index", epubRootDir, chapterInfo.url)
                logger.info("chapterFilePath: {} {}", chapterFilePath, epubRootDir)
                if (!File(chapterFilePath).exists()) {
                    return returnData.setErrorMsg("章节文件不存在")
                }
                // 处理 js 注入脚本
                // BookConfig.injectJavascriptToEpubChapter(chapterFilePath);

                // 直接返回 html访问地址
                if (epubRootDir.isEmpty()) {
                    content = bookInfo.bookUrl.replace("storage/data/", "/epub/") + "/index/" + chapterInfo.url
                } else {
                    content = bookInfo.bookUrl.replace("storage/data/", "/epub/") + "/index/" + epubRootDir + "/" + chapterInfo.url
                }
                return returnData.setData(content)
            }
            var bookContent = LocalBook.getContent(bookInfo, chapterInfo)
            if (bookContent == null) {
                return returnData.setErrorMsg("获取章节内容失败")
            }
            content = bookContent
        } else {
            try {
                content = WebBook(bookSource ?: "", false).getBookContent(bookInfo, chapterInfo, nextChapterUrl)
            } catch(e: Exception) {
                if (!bookSource.isNullOrEmpty()) {
                    var bookSourceObject = asJsonObject(bookSource)?.mapTo(BookSource::class.java)
                    if (bookSourceObject != null) {
                        // 标记为失败源
                        invalidBookSourceList.add(mutableMapOf<String, Any>("sourceUrl" to bookSourceObject.bookSourceUrl, "time" to System.currentTimeMillis(), "error" to e.toString()))
                        saveInvalidBookSourceList()
                    }
                }
                throw e
            }
        }

        return returnData.setData(content)
    }

    suspend fun exploreBook(context: RoutingContext): ReturnData {
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
            ruleFindUrl = URLDecoder.decode(ruleFindUrl, "UTF-8")
        }

        var result = WebBook(bookSource, false).exploreBook(ruleFindUrl, page)
        return returnData.setData(result)
    }

    suspend fun searchBook(context: RoutingContext): ReturnData {
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
        var result = WebBook(bookSource, false).searchBook(key, page)
        return returnData.setData(result)
    }

    suspend fun searchBookMulti(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        var key: String
        var lastIndex: Int
        var searchSize: Int
        var bookSourceGroup: String
        var concurrentCount: Int
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            key = context.bodyAsJson.getString("key", "")
            bookSourceGroup = context.bodyAsJson.getString("bookSourceGroup", "")
            lastIndex = context.bodyAsJson.getInteger("lastIndex", -1)
            searchSize = context.bodyAsJson.getInteger("searchSize", 20)
            concurrentCount = context.bodyAsJson.getInteger("concurrentCount", 36)
        } else {
            // get 请求
            key = context.queryParam("key").firstOrNull() ?: ""
            bookSourceGroup = context.queryParam("bookSourceGroup").firstOrNull() ?: ""
            lastIndex = context.queryParam("lastIndex").firstOrNull()?.toInt() ?: -1
            searchSize = context.queryParam("searchSize").firstOrNull()?.toInt() ?: 20
            concurrentCount = context.queryParam("concurrentCount").firstOrNull()?.toInt() ?: 36
        }
        var userNameSpace = getUserNameSpace(context)
        var userBookSourceList = loadBookSourceStringList(userNameSpace, bookSourceGroup)
        if (userBookSourceList.size <= 0) {
            return returnData.setErrorMsg("未配置书源")
        }
        if (key.isNullOrEmpty()) {
            return returnData.setErrorMsg("请输入搜索关键字")
        }
        if (lastIndex >= userBookSourceList.size) {
            return returnData.setErrorMsg("没有更多了")
        }

        searchSize = if(searchSize > 0) searchSize else 20
        concurrentCount = if(concurrentCount > 0) concurrentCount else 36
        logger.info("searchBookMulti from lastIndex: {} searchSize: {}", lastIndex, searchSize)
        var resultList = arrayListOf<SearchBook>()
        var resultMap = mutableMapOf<String, Int>()
        val book = Book()
        book.name = key
        limitConcurrent(concurrentCount, lastIndex + 1, userBookSourceList.size, {it->
            lastIndex = it
            var bookSource = userBookSourceList.get(it)
            searchBookWithSource(bookSource, book, false)
        }) {list, loopCount ->
            // logger.info("list: {}", list)
            list.forEach {
                val bookList = it as? Collection<SearchBook>
                bookList?.forEach { book ->
                    // 按照 书名 + 作者名 过滤
                    val bookKey = book.name + '_' + book.author
                    if (!resultMap.containsKey(bookKey)) {
                        resultList.add(book)
                        resultMap.put(bookKey, 1)
                    }
                }
            }
            logger.info("Loog: {} resultList.size: {}", loopCount, resultList.size)
            if (loopCount >= 10) {
                // 超过10轮，终止执行
                false
            } else {
                resultList.size < searchSize
            }
        }
        saveInvalidBookSourceList()
        return returnData.setData(mapOf("lastIndex" to lastIndex, "list" to resultList))
    }

    suspend fun searchBookMultiSSE(context: RoutingContext) {
        val returnData = ReturnData()
        // 返回 event-stream
        val response = context.response().putHeader("Content-Type", "text/event-stream")
            .putHeader("Cache-Control", "no-cache")
            .setChunked(true);

        if (!checkAuth(context)) {
            response.write("event: error\n")
            response.end("data: " + jsonEncode(returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用"), false) + "\n\n")
            return
        }
        var key: String
        var lastIndex: Int
        var searchSize: Int
        var bookSourceGroup: String
        var concurrentCount: Int
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            key = context.bodyAsJson.getString("key", "")
            bookSourceGroup = context.bodyAsJson.getString("bookSourceGroup", "")
            lastIndex = context.bodyAsJson.getInteger("lastIndex", -1)
            searchSize = context.bodyAsJson.getInteger("searchSize", 100)
            concurrentCount = context.bodyAsJson.getInteger("concurrentCount", 24)
        } else {
            // get 请求
            key = context.queryParam("key").firstOrNull() ?: ""
            bookSourceGroup = context.queryParam("bookSourceGroup").firstOrNull() ?: ""
            lastIndex = context.queryParam("lastIndex").firstOrNull()?.toInt() ?: -1
            searchSize = context.queryParam("searchSize").firstOrNull()?.toInt() ?: 100
            concurrentCount = context.queryParam("concurrentCount").firstOrNull()?.toInt() ?: 24
        }
        var userNameSpace = getUserNameSpace(context)
        var userBookSourceList = loadBookSourceStringList(userNameSpace, bookSourceGroup)
        if (userBookSourceList.size <= 0) {
            response.write("event: error\n")
            response.end("data: " + jsonEncode(returnData.setData("NEED_LOGIN").setErrorMsg("未配置书源"), false) + "\n\n")
            return
        }
        if (key.isNullOrEmpty()) {
            response.write("event: error\n")
            response.end("data: " + jsonEncode(returnData.setData("NEED_LOGIN").setErrorMsg("请输入搜索关键字"), false) + "\n\n")
            return
        }
        if (lastIndex >= userBookSourceList.size) {
            response.write("event: error\n")
            response.end("data: " + jsonEncode(returnData.setData("NEED_LOGIN").setErrorMsg("没有更多了"), false) + "\n\n")
            return
        }

        searchSize = if(searchSize > 0) searchSize else 100
        concurrentCount = if(concurrentCount > 0) concurrentCount else 24
        logger.info("searchBookMulti from lastIndex: {} concurrentCount: {} searchSize: {}", lastIndex, concurrentCount, searchSize)
        var resultList = arrayListOf<SearchBook>()
        var resultMap = mutableMapOf<String, Int>()
        val book = Book()
        book.name = key
        limitConcurrent(concurrentCount, lastIndex + 1, userBookSourceList.size, {it->
            lastIndex = it
            var bookSource = userBookSourceList.get(it)
            searchBookWithSource(bookSource, book, false)
        }) {list, loopCount ->
            // logger.info("list: {}", list)
            val loopResult = arrayListOf<SearchBook>()
            list.forEach {
                val bookList = it as? Collection<SearchBook>
                bookList?.forEach { book ->
                    // 按照 书名 + 作者名 过滤
                    val bookKey = book.name + '_' + book.author
                    if (!resultMap.containsKey(bookKey)) {
                        resultList.add(book)
                        loopResult.add(book)
                        resultMap.put(bookKey, 1)
                    }
                }
            }
            // 返回本轮数据
            response.write("data: " + jsonEncode(mapOf("lastIndex" to lastIndex, "data" to loopResult), false) + "\n\n")
            logger.info("Loog: {} resultList.size: {}", loopCount, resultList.size)

            if (loopCount >= 10) {
                // 超过10轮，终止执行
                false
            } else {
                resultList.size < searchSize
            }
        }
        saveInvalidBookSourceList()
        response.write("event: end\n")
        response.end("data: " + jsonEncode(mapOf("lastIndex" to lastIndex), false) + "\n\n")
    }

    suspend fun searchBookSource(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        if (!checkAuth(context)) {
            return returnData.setData("NEED_LOGIN").setErrorMsg("请登录后使用")
        }
        val bookUrl: String
        var lastIndex: Int
        var searchSize: Int
        var bookSourceGroup: String
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            bookUrl = context.bodyAsJson.getString("url")
            lastIndex = context.bodyAsJson.getInteger("lastIndex", -1)
            searchSize = context.bodyAsJson.getInteger("searchSize", 5)
            bookSourceGroup = context.bodyAsJson.getString("bookSourceGroup", "")
        } else {
            // get 请求
            bookUrl = context.queryParam("url").firstOrNull() ?: ""
            lastIndex = context.queryParam("lastIndex").firstOrNull()?.toInt() ?: -1
            searchSize = context.queryParam("searchSize").firstOrNull()?.toInt() ?: 5
            bookSourceGroup = context.queryParam("bookSourceGroup").firstOrNull() ?: ""
        }
        var userNameSpace = getUserNameSpace(context)
        var userBookSourceList = loadBookSourceStringList(userNameSpace, bookSourceGroup)
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
            book = bookInfoCache.getAsString(bookUrl)?.toMap()?.toDataClass()
        }
        if (book == null) {
            return returnData.setErrorMsg("书籍信息错误")
        }
        // 校正 lastIndex
        var bookSourceList: JsonArray? = asJsonArray(getUserStorage(userNameSpace, book.name + "_" + book.author, "bookSource"))
        if (bookSourceList != null && bookSourceList.size() > 0) {
            try {
                val lastBookSourceUrl = bookSourceList.getJsonObject(bookSourceList.size() - 1).getString("origin")
                lastIndex = Math.max(lastIndex, getBookSourceBySourceURL(lastBookSourceUrl, userNameSpace, userBookSourceList).second)
            } catch(e: Exception) {
                e.printStackTrace()
            }
        }

        logger.info("searchBookSource from lastIndex: {}", lastIndex)
        searchSize = if(searchSize > 0) searchSize else 5
        var resultList = arrayListOf<SearchBook>()
        var concurrentCount = Math.max(searchSize * 2, 24)
        limitConcurrent(concurrentCount, lastIndex + 1, userBookSourceList.size, {it->
            lastIndex = it
            var bookSource = userBookSourceList.get(it)
            searchBookWithSource(bookSource, book)
        }) {list, loopCount ->
            // logger.info("list: {}", list)
            list.forEach {
                val bookList = it as? Collection<SearchBook>
                bookList?.let {
                    resultList.addAll(it)
                }
            }
            if (loopCount >= 10) {
                // 超过10轮，终止执行
                false
            } else {
                resultList.size < searchSize
            }
        }
        saveBookSources(book, resultList, userNameSpace)
        saveInvalidBookSourceList()
        return returnData.setData(mapOf("lastIndex" to lastIndex, "list" to resultList))
    }

    suspend fun searchBookWithSource(bookSourceString: String, book: Book, accurate: Boolean = true): ArrayList<SearchBook> {
        var resultList = arrayListOf<SearchBook>()
        var bookSource = asJsonObject(bookSourceString)?.mapTo(BookSource::class.java)
        if (bookSource == null) {
            return resultList;
        }
        if (isInvalidBookSource(bookSource)) {
            return resultList;
        }
        withContext(Dispatchers.IO) {
            // val costTime = measureTimeMillis {
            try {
                val start = System.currentTimeMillis()
                var result = WebBook(bookSourceString, false).searchBook(book.name, 1)
                val end = System.currentTimeMillis()
                if (result.size > 0) {
                    for (j in 0 until result.size) {
                        var _book = result.get(j)
                        if (accurate && _book.name.equals(book.name) && _book.author.equals(book.author)) {
                            _book.time = end - start
                            resultList.add(_book)
                        } else if (!accurate && (_book.name.indexOf(book.name, ignoreCase=true) >= 0 || _book.author.indexOf(book.name, ignoreCase=true) >= 0)) {
                            _book.time = end - start
                            resultList.add(_book)
                        }
                    }
                }
            } catch(e: Exception) {
                // 标记为失败源
                invalidBookSourceList.add(mutableMapOf<String, Any>("sourceUrl" to bookSource.bookSourceUrl, "time" to System.currentTimeMillis(), "error" to e.toString()))
                e.printStackTrace()
            }
            // }
            // logger.info("searchBookWithSource in Thread: {} Cost: {}", Thread.currentThread().name, costTime)
        }
        return resultList;
    }

    suspend fun getBookSource(context: RoutingContext): ReturnData {
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
            book = bookInfoCache.getAsString(bookUrl)?.toMap()?.toDataClass()
        }
        if (book == null) {
            return returnData.setErrorMsg("书籍信息错误")
        }
        var bookSourceList: JsonArray? = asJsonArray(getUserStorage(userNameSpace, book.name + "_" + book.author, "bookSource"))
        if (bookSourceList != null) {
            if (refresh <= 0) {
                return returnData.setData(bookSourceList.getList())
            }

            // 刷新源
            var resultList = arrayListOf<SearchBook>()
            val concurrentCount = 16
            val userBookSourceStringList = loadBookSourceStringList(userNameSpace)
            limitConcurrent(concurrentCount, 0, bookSourceList.size(), {it ->
                var searchBook = bookSourceList.getJsonObject(it).mapTo(SearchBook::class.java)
                var bookSource = getBookSourceStringBySourceURL(searchBook.origin, userNameSpace, userBookSourceStringList)
                if (bookSource != null) {
                    searchBookWithSource(bookSource, book)
                } else {
                    arrayListOf<SearchBook>()
                }
            }) {list, _->
                // logger.info("list: {}", list)
                list.forEach {
                    val bookList = it as? Collection<SearchBook>
                    bookList?.let {
                        resultList.addAll(it)
                    }
                }
                true
            }
            // logger.info("refreshed bookSourceList: {}", resultList)
            saveBookSources(book, resultList, userNameSpace, true)
            saveInvalidBookSourceList()
            return returnData.setData(resultList)
        }
        return returnData.setData(arrayListOf<Int>())
    }

    suspend fun getInvalidBookSources(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
        return returnData.setData(invalidBookSourceList)
    }

    suspend fun getBookshelf(context: RoutingContext): ReturnData {
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

    suspend fun getShelfBook(context: RoutingContext): ReturnData {
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
            url = URLDecoder.decode(url, "UTF-8")
        }
        if (url.isNullOrEmpty()) {
            return returnData.setErrorMsg("书源链接不能为空")
        }

        var book = getShelfBookByURL(url, getUserNameSpace(context))
        if (book == null) {
            return returnData.setErrorMsg("书籍不存在")
        }
        return returnData.setData(book)
    }

    suspend fun saveBook(context: RoutingContext): ReturnData {
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
                val relativeLocalFilePath = Paths.get("storage", "data", userNameSpace, book.name + "_" + book.author, tempFile.name).toString()
                val localFilePath = getWorkDir(relativeLocalFilePath)
                logger.info("localFilePath: {}", localFilePath)
                var localFile = File(localFilePath)
                localFile.deleteRecursively()
                if (!localFile.parentFile.exists()) {
                    localFile.parentFile.mkdirs()
                }
                if (!tempFile.copyRecursively(localFile)) {
                    return returnData.setErrorMsg("导入本地书籍失败")
                }
                tempFile.deleteRecursively()
                // 修改书籍信息
                book.bookUrl = relativeLocalFilePath
                book.originName = relativeLocalFilePath

                if (book.isEpub()) {
                    // 解压文件 index.epub
                    if (!extractEpub(book)) {
                        return returnData.setErrorMsg("导入本地Epub书籍失败")
                    }
                }
            }
        } else if (book.tocUrl.isNullOrEmpty()) {
            // 补全书籍信息
            var bookSource = getBookSourceStringBySourceURL(book.origin, userNameSpace)
            if (bookSource == null) {
                return returnData.setErrorMsg("书源信息错误")
            }
            var newBook = WebBook(bookSource).getBookInfo(book.bookUrl)
            book.fillData(newBook, listOf("name", "author", "coverUrl", "tocUrl", "intro", "latestChapterTitle", "wordCount"))
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
            if (_book.name.equals(book.name) && _book.author.equals(book.author)) {
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

    suspend fun saveBookSource(context: RoutingContext): ReturnData {
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
            bookUrl = URLDecoder.decode(bookUrl, "UTF-8")
            bookSourceUrl = URLDecoder.decode(bookSourceUrl, "UTF-8")
            newBookUrl = URLDecoder.decode(newBookUrl, "UTF-8")
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
        var book = getShelfBookByURL(bookUrl, userNameSpace)
        if (book == null) {
            return returnData.setErrorMsg("书籍信息错误")
        }
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
            if (existBook.coverUrl.isNullOrEmpty() && !newBookInfo.coverUrl.isNullOrEmpty()) {
                existBook.coverUrl = newBookInfo.coverUrl
            }

            logger.info("saveBookSource: {}", existBook)

            newBookInfo = existBook

            existBook
        }

        // 更新目录
        getLocalChapterList(newBookInfo, bookSourceString, true, userNameSpace)
        return returnData.setData(newBookInfo)
    }

    suspend fun saveBookGroupId(context: RoutingContext): ReturnData {
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
            bookUrl = URLDecoder.decode(bookUrl, "UTF-8")
        }
        if (bookUrl.isNullOrEmpty()) {
            return returnData.setErrorMsg("书籍链接不能为空")
        }
        var userNameSpace = getUserNameSpace(context)
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

    suspend fun deleteBook(context: RoutingContext): ReturnData {
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

        // 删除书籍目录
        val localBookPath = File(getWorkDir("storage", "data", userNameSpace, book.name + "_" + book.author))
        localBookPath.deleteRecursively()

        return returnData.setData("")
    }

    suspend fun getBookGroups(context: RoutingContext): ReturnData {
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

    suspend fun saveBookGroup(context: RoutingContext): ReturnData {
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


    suspend fun deleteBookGroup(context: RoutingContext): ReturnData {
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

    suspend fun saveBookInfoCache(bookList: List<Book>): List<Book> {
        if (bookList.size > 0) {
            for (i in 0 until bookList.size) {
                var book = bookList.get(i)
                bookInfoCache.put(book.bookUrl, jsonEncode(JsonObject.mapFrom(book).map))
            }
            saveStorage("cache", "bookInfoCache", value = bookInfoCache)
        }
        return bookList
    }

    suspend fun mergeBookCacheInfo(book: Book): Book {
        var cacheInfo: Book? = bookInfoCache.getAsString(book.bookUrl)?.toMap()?.toDataClass()

        if (cacheInfo != null) {
            return book.fillData(cacheInfo, listOf("name", "author", "coverUrl", "tocUrl", "intro", "latestChapterTitle", "wordCount"))
        }
        return book
    }

    fun loadInvalidBookSourceList() {
        var _invalidBookSources: JsonArray? = asJsonArray(getStorage("cache", "invalidBookSourceList"))
        if (_invalidBookSources != null) {
            invalidBookSourceList = _invalidBookSources.getList() as ArrayList<Map<String, Any>>
        }
    }

    private fun saveInvalidBookSourceList() {
        saveStorage("cache", "invalidBookSourceList", value = invalidBookSourceList)
    }

    private fun isInvalidBookSource(bookSource: BookSource): Boolean {
        val now = System.currentTimeMillis()
        var isInvalid = false
        var index = -1
        for (i in 0 until invalidBookSourceList.size) {
            val map = asJsonObject(invalidBookSourceList.get(i))
            if (map != null) {
                val sourceUrl = map.getString("sourceUrl", "") ?: ""
                val lastErrorTime = map.getLong("time", now) ?: now
                if (sourceUrl.equals(bookSource.bookSourceUrl)) {
                    index = i
                    // 有效期 10分钟
                    if (lastErrorTime > now - 600) {
                        isInvalid = true;
                    }
                    break;
                }
            }
        }
        if (!isInvalid && index >= 0) {
            invalidBookSourceList.removeAt(index);
            saveInvalidBookSourceList();
        }
        return isInvalid;
    }

    suspend fun getBookShelfBooks(refresh: Boolean = false, userNameSpace: String): List<Book> {
        var bookshelf: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "bookshelf"))
        if (bookshelf == null) {
            return arrayListOf<Book>()
        }
        var bookList = arrayListOf<Book>()
        val concurrentCount = 16
        val userBookSourceStringList = loadBookSourceStringList(userNameSpace)
        limitConcurrent(concurrentCount, 0, bookshelf.size()) {
            var book = bookshelf.getJsonObject(it).mapTo(Book::class.java)
            if (book.canUpdate && refresh) {
                try {
                    var bookSource = getBookSourceStringBySourceURL(book.origin, userNameSpace, userBookSourceStringList)
                    if (bookSource != null) {
                        withContext(Dispatchers.IO) {
                            var bookChapterList = getLocalChapterList(book, bookSource, refresh, userNameSpace, false)
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
                    }
                } catch(e: Exception) {
                    e.printStackTrace()
                }
            }
            bookList.add(book)
        }
        return bookList
    }


    suspend fun getLocalChapterList(book: Book, bookSource: String, refresh: Boolean = false, userNameSpace: String, debugLog: Boolean = true): List<BookChapter> {
        val md5Encode = MD5Utils.md5Encode(book.bookUrl).toString()
        var chapterList: JsonArray? = asJsonArray(getUserStorage(userNameSpace, book.name + "_" + book.author, md5Encode))

        if (chapterList == null || refresh) {
            var newChapterList: List<BookChapter>
            if (book.isLocalBook()) {
                // 重新解压epub文件
                if (book.isEpub() && !extractEpub(book, refresh)) {
                    throw Exception("Epub书籍解压失败")
                }
                newChapterList = LocalBook.getChapterList(book.also{
                    it.setRootDir(getWorkDir())
                })
            } else {
                try {
                    newChapterList = WebBook(bookSource, debugLog).getChapterList(book)
                } catch(e: Exception) {
                    if (!bookSource.isNullOrEmpty()) {
                        var bookSourceObject = asJsonObject(bookSource)?.mapTo(BookSource::class.java)
                        if (bookSourceObject != null) {
                            // 标记为失败源
                            invalidBookSourceList.add(mutableMapOf<String, Any>("sourceUrl" to bookSourceObject.bookSourceUrl, "time" to System.currentTimeMillis(), "error" to e.toString()))
                            saveInvalidBookSourceList()
                        }
                    }
                    throw e
                }
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

    suspend fun getBookSourceString(context: RoutingContext, sourceUrl: String = ""): String? {
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
                bookSourceUrl = URLDecoder.decode(bookSourceUrl, "UTF-8")
            }
            bookSourceString = getBookSourceStringBySourceURL(bookSourceUrl, userNameSpace)
        }
        if (bookSourceString.isNullOrEmpty() && !sourceUrl.isNullOrEmpty()) {
            bookSourceString = getBookSourceStringBySourceURL(sourceUrl, userNameSpace)
        }
        return bookSourceString
    }

    fun loadBookSourceStringList(userNameSpace: String, bookSourceGroup: String = ""): List<String> {
        var bookSourceList: JsonArray? = asJsonArray(getUserStorage(userNameSpace, "bookSource"))
        var userBookSourceList = arrayListOf<String>()
        if (bookSourceList != null) {
            for (i in 0 until bookSourceList.size()) {
                var isAdd = true
                if (!bookSourceGroup.isEmpty()) {
                    val bookSource = bookSourceList.getJsonObject(i).mapTo(BookSource::class.java)
                    if (!bookSource.bookSourceGroup.equals(bookSourceGroup)) {
                        isAdd = false
                    }
                }
                if (isAdd) {
                    userBookSourceList.add(bookSourceList.getJsonObject(i).toString())
                }
            }
        }
        return userBookSourceList
    }

    fun getBookSourceStringBySourceURL(sourceUrl: String, userNameSpace: String, bookSourceList: List<String>? = null): String? {
        var bookSourcePair = getBookSourceBySourceURL(sourceUrl, userNameSpace, bookSourceList)
        return bookSourcePair.first
    }

    fun getBookSourceBySourceURL(sourceUrl: String, userNameSpace: String, bookSourceList: List<String>? = null): Pair<String?, Int> {
        var bookSourceString: String? = null
        var index: Int = -1
        if (sourceUrl.isNullOrEmpty()) {
            return Pair(bookSourceString, index)
        }
        // 优先查找用户的书源
        var userBookSourceList = bookSourceList ?: loadBookSourceStringList(userNameSpace)
        for (i in 0 until userBookSourceList.size) {
            val sourceMap = userBookSourceList.get(i).toMap()
            if (sourceUrl.equals(sourceMap.get("bookSourceUrl") as String)) {
                bookSourceString = userBookSourceList.get(i)
                index = i
                break;
            }
        }
        return Pair(bookSourceString, index)
    }

    fun getShelfBookByURL(url: String, userNameSpace: String): Book? {
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

    fun saveShelfBookProgress(book: Book, bookChapter: BookChapter, userNameSpace: String) {
        editShelfBook(book, userNameSpace) { existBook ->
            existBook.durChapterIndex = bookChapter.index
            existBook.durChapterTitle = bookChapter.title
            existBook.durChapterTime = System.currentTimeMillis()

            // logger.info("saveShelfBookProgress: {}", existBook)

            existBook
        }
    }

    fun saveShelfBookLatestChapter(book: Book, bookChapterList: List<BookChapter>, userNameSpace: String) {
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
            // logger.info("saveShelfBookLatestChapter: {}", existBook)
            existBook
        }
    }

    fun editShelfBook(book: Book, userNameSpace: String, handler: (Book)->Book) {
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

            // logger.info("editShelfBook: {}", existBook)

            bookList.set(existIndex, JsonObject.mapFrom(existBook))
            bookshelf = JsonArray(bookList)
            saveUserStorage(userNameSpace, "bookshelf", bookshelf)
        }
    }

    fun saveBookSources(book: Book, sourceList: List<SearchBook>, userNameSpace: String, replace: Boolean = false) {
        if (book.name.isEmpty()) {
            return;
        }
        var bookSourceList = JsonArray()
        if (!replace) {
            val localBookSourceList = asJsonArray(getUserStorage(userNameSpace, book.name + "_" + book.author, "bookSource"))
            if (localBookSourceList != null) {
                bookSourceList = localBookSourceList
            }
        }

        for (k in 0 until sourceList.size) {
            var searchBook = sourceList.get(k)
            // 遍历判断书本是否存在
            var existIndex: Int = -1
            for (i in 0 until bookSourceList.size()) {
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
        saveUserStorage(userNameSpace, getRelativePath(book.name + "_" + book.author, "bookSource"), bookSourceList)
    }

    fun extractEpub(book: Book, force: Boolean = false): Boolean {
        val epubExtractDir = File(getWorkDir(book.originName + File.separator + "index"))
        if (force || !epubExtractDir.exists()) {
            epubExtractDir.deleteRecursively()
            val localEpubFile = File(getWorkDir(book.originName + File.separator + "index.epub"))
            if (!localEpubFile.unzip(epubExtractDir.toString())) {
                return false
            }
        }
        return true
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
                // 同步 书籍分组
                val bookGroupFile = File(descDir + File.separator + "bookGroup.json")
                if (bookGroupFile.exists()) {
                    val userBookGroupFile = File(getWorkDir("storage", "data", userNameSpace, "bookGroup.json"))
                    userBookGroupFile.deleteRecursively()
                    bookGroupFile.renameTo(userBookGroupFile)
                }
                // 同步 RSS订阅
                val rssSourcesFile = File(descDir + File.separator + "rssSources.json")
                if (rssSourcesFile.exists()) {
                    val userRssSourcesFile = File(getWorkDir("storage", "data", userNameSpace, "rssSources.json"))
                    userRssSourcesFile.deleteRecursively()
                    rssSourcesFile.renameTo(userRssSourcesFile)
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
                // 同步 书籍分组
                val userBookGroupFile = File(getWorkDir("storage", "data", userNameSpace, "bookGroup.json"))
                if (userBookGroupFile.exists()) {
                    val bookGroupFile = File(descDir + File.separator + "bookGroup.json")
                    bookGroupFile.deleteRecursively()
                    userBookGroupFile.renameTo(bookGroupFile)
                }
                // 同步 RSS订阅
                val userRssSourcesFile = File(getWorkDir("storage", "data", userNameSpace, "rssSources.json"))
                if (userRssSourcesFile.exists()) {
                    val rssSourcesFile = File(descDir + File.separator + "rssSources.json")
                    rssSourcesFile.deleteRecursively()
                    userRssSourcesFile.renameTo(rssSourcesFile)
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
}