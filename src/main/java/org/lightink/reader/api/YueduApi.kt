package org.lightink.reader.api

import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import io.legado.app.data.entities.BookSource
import io.legado.app.data.entities.SearchBook
import io.legado.app.model.WebBook
import io.vertx.ext.web.Router
import io.vertx.ext.web.RoutingContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import mu.KotlinLogging
import org.gosky.aroundight.api.BaseApi
import org.lightink.reader.utils.error
import org.lightink.reader.utils.success
import org.lightink.reader.verticle.coroutineHandler
import org.springframework.stereotype.Component
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

private val logger = KotlinLogging.logger {}

@Component
class YueduApi : BaseApi {


    override suspend fun initRouter(router: Router, coroutineScope: CoroutineScope) {
        router.post("/yuedu/searchBook").handler { searchBook(it) }
        router.post("/yuedu/exploreBook").handler { exploreBook(it) }
        router.post("/yuedu/getBookInfo").handler { getBookInfo(it) }
        router.post("/yuedu/getChapterList").handler { getChapterList(it) }
        router.post("/yuedu/getContent").handler { getContent(it) }
    }

    private fun getBookInfo(context: RoutingContext) {
        val bookSource = context.bodyAsJson.getJsonObject("bookSource").toString()
        val book = context.bodyAsJson.getJsonObject("searchBook").mapTo(SearchBook::class.java).toBook()
        WebBook(bookSource).getBookInfo(book)
                .onSuccess {
                    context.success(it)
                }
                .onError {
                    context.error(it)
                }
    }

    private fun getContent(context: RoutingContext) {
        val bookSource = context.bodyAsJson.getJsonObject("bookSource").toString()
        val book = context.bodyAsJson.getJsonObject("book").mapTo(Book::class.java)
        val bookChapter = context.bodyAsJson.getJsonObject("bookChapter").mapTo(BookChapter::class.java)
        WebBook(bookSource).getContent(book, bookChapter)
                .onSuccess {
                    context.success(it)
                }
                .onError {
                    context.error(it)
                }

    }

    private fun getChapterList(context: RoutingContext) {
        val bookSource = context.bodyAsJson.getJsonObject("bookSource").toString()
        val book = context.bodyAsJson.getJsonObject("book").mapTo(Book::class.java)
        WebBook(bookSource).getChapterList(book)
                .onSuccess {
                    context.success(it)
                }
                .onError {
                    context.error(it)
                }
    }

    private fun exploreBook(context: RoutingContext) {
        val bookSource = context.bodyAsJson.getJsonObject("bookSource").toString()
        val ruleFindUrl = context.bodyAsJson.getString("ruleFindUrl")
        val page = context.bodyAsJson.getInteger("page", 1)

        WebBook(bookSource).exploreBook(ruleFindUrl, page)
                .onSuccess {
                    context.success(it)
                }
                .onError {
                    context.error(it)
                }

    }

    private fun searchBook(context: RoutingContext) {

        val bookSource = context.bodyAsJson.getJsonObject("bookSource").toString()
        val key = context.bodyAsJson.getString("key")
        val page = context.bodyAsJson.getInteger("page", 1)
        logger.info { "searchBook" }
        WebBook(bookSource).searchBook(key, page)
                .onSuccess {
                    context.success(it)
                }
                .onError {
                    context.error(it)
                }
    }

}