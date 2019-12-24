package org.lightink.reader.api

import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import io.legado.app.data.entities.BookSource
import io.legado.app.data.entities.SearchBook
import io.legado.app.model.WebBook
import io.vertx.ext.web.Router
import io.vertx.ext.web.RoutingContext
import kotlinx.coroutines.CoroutineScope
import org.gosky.aroundight.api.BaseApi
import org.lightink.reader.service.YueduSchedule
import org.lightink.reader.utils.error
import org.lightink.reader.utils.success
import org.lightink.reader.verticle.coroutineHandler
import org.springframework.stereotype.Component

@Component
class HoumoApi : BaseApi {


    override suspend fun initRouter(router: Router, coroutineScope: CoroutineScope) {
        router.post("/houmo/searchBook").handler { searchBook(it) }
        router.post("/houmo/exploreBook").handler { exploreBook(it) }
        router.post("/houmo/getBookInfo").handler { getBookInfo(it) }
        router.post("/houmo/getChapterList").handler { getChapterList(it) }
        router.post("/houmo/getContent").handler { getContent(it) }
        router.get("/houmo/md5").handler { getMd5(it) }
    }

    private fun getMd5(it: RoutingContext) {
        it.success(YueduSchedule.Shuyuan.shuyuanlist)
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

        val bookSourceCode = context.request().params().get("bookSource")
        val key = context.request().params().get("key")
        val page = context.request().params().get("page")?.toInt(1)
        val bookSource = YueduSchedule.Shuyuan.get(bookSourceCode)

        WebBook(bookSource).searchBook(key, page)
                .onSuccess {
                    context.success(it)
                }
                .onError {
                    context.error(it)
                }
    }

}