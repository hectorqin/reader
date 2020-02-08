package org.lightink.reader.api

import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import io.legado.app.data.entities.SearchBook
import io.legado.app.help.storage.OldRule
import io.legado.app.model.Debug
import io.legado.app.model.WebBook
import io.vertx.ext.web.Router
import io.vertx.ext.web.RoutingContext
import mu.KotlinLogging
import org.lightink.reader.service.YueduSchedule
import org.lightink.reader.service.yuedu.constant.DeepinkBookSource
import org.lightink.reader.utils.error
import org.lightink.reader.utils.success
import org.lightink.reader.verticle.RestVerticle
import org.springframework.stereotype.Component

private val logger = KotlinLogging.logger {}

@Component
class YueduApi : RestVerticle() {


    override suspend fun initRouter(router: Router) {
        router.post("/yuedu/searchBook").coroutineHandler { searchBook(it) }
        router.post("/yuedu/exploreBook").coroutineHandler { exploreBook(it) }
        router.post("/yuedu/getBookInfo").coroutineHandler { getBookInfo(it) }
        router.post("/yuedu/getChapterList").coroutineHandler { getChapterList(it) }
        router.post("/yuedu/getContent").coroutineHandler { getContent(it) }
        router.get("/yuedu/md5").handler { getMd5(it) }
        router.get("/yuedu/check").coroutineHandler { check(it) }
    }

    private suspend fun check(value: RoutingContext) {
        for (mutableEntry in YueduSchedule.shuyuanlist) {
            try {
                logger.info("开始检测 md5: {}", mutableEntry.key)
                val bookSource = OldRule.jsonToBookSource(json = mutableEntry.value)!!
                val webBook = WebBook(bookSource)
                Debug.startDebug(webBook, "剑来")
                logger.info("结束检测 md5: {}", mutableEntry.key)
                logger.info("生成文件 md5: {}", mutableEntry.key)
                DeepinkBookSource.generate(bookSource.bookSourceName,
                        bookSource.bookSourceUrl, mutableEntry.key)
            } catch (e: Exception) {

            }

        }
    }

    private fun getMd5(it: RoutingContext) {
        it.success(YueduSchedule.Shuyuan.shuyuanlist)
    }


    private suspend fun getBookInfo(context: RoutingContext): Book {
        val bookSourceCode = context.bodyAsJson.getString("bookSourceCode")
        val bookSource = if (bookSourceCode != null) {
            YueduSchedule.Shuyuan.get(bookSourceCode)
        } else {
            context.bodyAsJson.getJsonObject("bookSource").toString()
        }
        val book = context.bodyAsJson.getJsonObject("searchBook").mapTo(SearchBook::class.java).toBook()
        return WebBook(bookSource).getBookInfo(book)

    }

    private suspend fun getContent(context: RoutingContext): Map<String, Any?> {
        val bookSourceCode = context.bodyAsJson.getString("bookSourceCode")
        val bookSource = if (bookSourceCode != null) {
            YueduSchedule.Shuyuan.get(bookSourceCode)
        } else {
            context.bodyAsJson.getJsonObject("bookSource").toString()
        }
        val book = context.bodyAsJson.getJsonObject("book")?.mapTo(Book::class.java)
        val bookChapter = context.bodyAsJson.getJsonObject("bookChapter").mapTo(BookChapter::class.java)
        val content = WebBook(bookSource).getContent(book, bookChapter)

        return mapOf<String, Any?>("text" to content)

    }

    private suspend fun getChapterList(context: RoutingContext): List<BookChapter> {
        val bookSourceCode = context.bodyAsJson.getString("bookSourceCode")
        val bookSource = if (bookSourceCode != null) {
            YueduSchedule.Shuyuan.get(bookSourceCode)
        } else {
            context.bodyAsJson.getJsonObject("bookSource").toString()
        }
        val book = context.bodyAsJson.getJsonObject("book").mapTo(Book::class.java)
        return WebBook(bookSource).getChapterList(book)

    }

    private suspend fun exploreBook(context: RoutingContext): List<SearchBook> {
        val bookSourceCode = context.bodyAsJson.getString("bookSourceCode")
        val bookSource = if (bookSourceCode != null) {
            YueduSchedule.Shuyuan.get(bookSourceCode)
        } else {
            context.bodyAsJson.getJsonObject("bookSource").toString()
        }
        val ruleFindUrl = context.bodyAsJson.getString("ruleFindUrl")
        val page = context.bodyAsJson.getInteger("page", 1)

        return WebBook(bookSource).exploreBook(ruleFindUrl, page)

    }

    private suspend fun searchBook(context: RoutingContext): List<SearchBook> {

        val bookSourceCode = context.bodyAsJson.getString("bookSourceCode")
        val bookSource = if (bookSourceCode != null) {
            YueduSchedule.Shuyuan.get(bookSourceCode)
        } else {
            context.bodyAsJson.getJsonObject("bookSource").toString()
        }
        val key = context.bodyAsJson.getString("key")
        val page = context.bodyAsJson.getInteger("page", 1)
        logger.info { "searchBook" }
        return WebBook(bookSource).searchBook(key, page)

    }

}