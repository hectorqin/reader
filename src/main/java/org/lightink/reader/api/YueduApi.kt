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
import org.lightink.reader.verticle.RestVerticle
import org.springframework.stereotype.Component
import io.vertx.core.json.JsonObject
import io.vertx.core.json.JsonArray
import io.vertx.core.http.HttpMethod
import org.lightink.reader.api.ReturnData
import io.legado.app.utils.MD5Utils
import java.net.URLDecoder;
import io.vertx.ext.web.client.WebClient
import org.springframework.beans.factory.annotation.Autowired

private val logger = KotlinLogging.logger {}

@Component
class YueduApi : RestVerticle() {
    var installedBookSourceList = arrayListOf<String>()
    var bookInfoCache = mutableMapOf<String, Map<String, Any>>()

    @Autowired
    private lateinit var webClient: WebClient

    override suspend fun initRouter(router: Router) {
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
        router.route("/web/*").handler(StaticHandler.create("web"));

        // 加载书源
        loadInstalledBookSourceList();

        // 加载书籍详情缓存
        loadBookCacheInfo();
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
        var bookInfo = getShelfBookByURL(bookUrl)
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
        webClient.getAbs(coverUrl).send {
            var result = it.result()
            var res = context.response().putHeader("Cache-Control", "86400")
            result.headers().forEach {
                res.putHeader(it.key, it.value)
            }
            res.end(result.bodyAsBuffer())
        }
    }

    private suspend fun getChapterList(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
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
        var bookInfo = getShelfBookByURL(bookUrl)
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
        var chapterList = getLocalChapterList(bookInfo, bookSource, refresh > 0)

        return returnData.setData(chapterList)
    }

    private suspend fun getBookContent(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
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
        if (!bookUrl.isNullOrEmpty()) {
            bookUrl = URLDecoder.decode(bookUrl, "UTF-8")
            // 看看有没有加入书架
            var bookInfo = getShelfBookByURL(bookUrl)
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
                var chapterList = getLocalChapterList(bookInfo, bookSource)
                if (chapterIndex <= chapterList.size) {
                    var chapter = chapterList.get(chapterIndex)
                    saveShelfBookProgress(bookInfo, chapter)
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
        var book = getShelfBookByName(name) ?: getShelfBookByURL(bookUrl)
        if (book == null) {
            book = bookInfoCache.get(bookUrl)?.toDataClass()
        }
        if (book == null) {
            return returnData.setErrorMsg("书籍信息错误")
        }
        var bookSourceList: JsonArray? = asJsonArray(getStorage(book.name + "/bookSource"))
        if (bookSourceList != null) {
            return returnData.setData(bookSourceList.getList())
        }
        return returnData.setData(arrayListOf<Int>())
    }

    private suspend fun saveSource(context: RoutingContext): ReturnData {
        val bookSource = context.bodyAsJson.mapTo(BookSource::class.java)
        var bookSourceList: JsonArray? = asJsonArray(getStorage("bookSource"))
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
        saveStorage("bookSource", bookSourceList)
        loadInstalledBookSourceList();
        val returnData = ReturnData()
        return returnData.setData(bookSourceList.getList())
    }

    private suspend fun saveSources(context: RoutingContext): ReturnData {
        val bookSourceJsonArray = context.bodyAsJsonArray
        var bookSourceList: JsonArray? = asJsonArray(getStorage("bookSource"))
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
        saveStorage("bookSource", bookSourceList!!)
        loadInstalledBookSourceList();
        val returnData = ReturnData()
        return returnData.setData(bookSourceList.getList())
    }

    private suspend fun getSources(context: RoutingContext): ReturnData {
        var bookSourceList: JsonArray? = asJsonArray(getStorage("bookSource"))
        val returnData = ReturnData()
        if (bookSourceList != null) {
            return returnData.setData(bookSourceList.getList())
        }
        return returnData.setData(arrayListOf<Int>())
    }

    private suspend fun deleteSource(context: RoutingContext): ReturnData {
        val bookSource = context.bodyAsJson.mapTo(BookSource::class.java)
        var bookSourceList: JsonArray? = asJsonArray(getStorage("bookSource"))
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
        saveStorage("bookSource", bookSourceList)
        loadInstalledBookSourceList();
        val returnData = ReturnData()
        return returnData.setData(bookSourceList.getList())
    }

    private suspend fun deleteSources(context: RoutingContext): ReturnData {
        val bookSourceJsonArray = context.bodyAsJsonArray
        var bookSourceList: JsonArray? = asJsonArray(getStorage("bookSource"))
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
        saveStorage("bookSource", bookSourceList)
        loadInstalledBookSourceList();
        val returnData = ReturnData()
        return returnData.setData(bookSourceList.getList())
    }

    private suspend fun getBookshelf(context: RoutingContext): ReturnData {
        var refresh: Int = 0
        if (context.request().method() == HttpMethod.POST) {
            // post 请求
            refresh = context.bodyAsJson.getInteger("refresh", 0)
        } else {
            // get 请求
            refresh = context.queryParam("refresh").firstOrNull()?.toInt() ?: 0
        }
        var bookList = getBookShelfBooks(refresh > 0)
        val returnData = ReturnData()
        return returnData.setData(bookList)
    }

    private suspend fun getShelfBook(context: RoutingContext): ReturnData {
        val params = context.bodyAsJson
        var name = params.getString("name")
        val returnData = ReturnData()

        if (name != null) {
            var book = getShelfBookByName(name)
            if (book != null) {
                return returnData.setData(book)
            } else {
                return returnData.setErrorMsg("书籍不存在")
            }
        }
        var url = params.getString("url")
        if (url != null) {
            var book = getShelfBookByURL(url)
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
        var bookshelf: JsonArray? = asJsonArray(getStorage("bookshelf"))
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
        saveStorage("bookshelf", bookshelf)
        return returnData.setData(book)
    }

    private suspend fun saveBookSource(context: RoutingContext): ReturnData {
        val returnData = ReturnData()
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
        bookName = URLDecoder.decode(bookName, "UTF-8")
        var book = getShelfBookByName(bookName)
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

        var bookshelf: JsonArray? = asJsonArray(getStorage("bookshelf"))
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
        saveStorage("bookshelf", bookshelf)
        return returnData.setData(book)
    }

    private suspend fun deleteBook(context: RoutingContext): ReturnData {
        val book = context.bodyAsJson.mapTo(Book::class.java)
        var bookshelf: JsonArray? = asJsonArray(getStorage("bookshelf"))
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
        saveStorage("bookshelf", bookshelf)
        val returnData = ReturnData()
        return returnData.setData(bookshelf.getList())
    }



    /**
     * 非 API
     */
    private suspend fun loadBookCacheInfo() {
        var _bookInfoCache: JsonObject? = asJsonObject(getStorage("bookInfoCache"))
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
            saveStorage("bookInfoCache", bookInfoCache)
        }
        return bookList
    }

    private suspend fun getBookShelfBooks(refresh: Boolean = false): List<Book> {
        var bookshelf: JsonArray? = asJsonArray(getStorage("bookshelf"))
        if (bookshelf == null) {
            return arrayListOf<Book>()
        }
        var bookList = arrayListOf<Book>()
        for (i in 0 until bookshelf.size()) {
            var book = bookshelf.getJsonObject(i).mapTo(Book::class.java)
            var bookSource = getInstalledBookSourceStringBySourceURL(book.origin)
            if (bookSource != null) {
                var bookChapterList = getLocalChapterList(book, bookSource, refresh)
                var bookChapter = bookChapterList.last()
                book.lastCheckTime = System.currentTimeMillis()
                book.lastCheckCount = bookChapterList.size - book.totalChapterNum
                book.latestChapterTitle = bookChapter.title
                book.totalChapterNum = bookChapterList.size
                bookList.add(book)
            }
        }
        return bookList
    }


    private suspend fun getLocalChapterList(book: Book, bookSource: String, refresh: Boolean = false): List<BookChapter> {
        val md5Encode = MD5Utils.md5Encode(book.bookUrl).toString()
        var chapterList: JsonArray? = asJsonArray(getStorage(book.name + "/" + md5Encode))

        if (chapterList == null || refresh) {
            var onlineChapterList = WebBook(bookSource).getChapterList(book)
            saveStorage(book.name + "/" + md5Encode, onlineChapterList)
            saveShelfBookLatestChapter(book, onlineChapterList)
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
        var bookSourceList: JsonArray? = asJsonArray(getStorage("bookSource"))
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

    private suspend fun getShelfBookByURL(url: String): Book? {
        var bookshelf: JsonArray? = asJsonArray(getStorage("bookshelf"))
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

    private suspend fun getShelfBookByName(name: String): Book? {
        var bookshelf: JsonArray? = asJsonArray(getStorage("bookshelf"))
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

    private suspend fun saveShelfBookProgress(book: Book, bookChapter: BookChapter) {
        var bookshelf: JsonArray? = asJsonArray(getStorage("bookshelf"))
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
            saveStorage("bookshelf", bookshelf)
        }
    }

    private suspend fun saveShelfBookLatestChapter(book: Book, bookChapterList: List<BookChapter>) {
        var bookshelf: JsonArray? = asJsonArray(getStorage("bookshelf"))
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
            saveStorage("bookshelf", bookshelf)
        }
    }

    private suspend fun saveBookSources(bookName: String, sourceList: List<SearchBook>) {
        var bookSourceList: JsonArray? = asJsonArray(getStorage(bookName + "/bookSource"))
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