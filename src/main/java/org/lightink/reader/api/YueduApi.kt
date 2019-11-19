package org.lightink.reader.api

import io.legado.app.model.WebBook
import io.vertx.ext.web.Router
import io.vertx.ext.web.RoutingContext
import kotlinx.coroutines.CoroutineScope
import org.gosky.aroundight.api.BaseApi
import org.lightink.reader.verticle.coroutineHandler
import org.springframework.stereotype.Component

@Component
class YueduApi : BaseApi {


    override suspend fun initRouter(router: Router, coroutineScope: CoroutineScope) {
        router.post("/yuedu/searchBook").coroutineHandler(coroutineScope) { searchBook(it) }
        router.post("/yuedu/exploreBook").coroutineHandler(coroutineScope) { exploreBook(it) }
        router.post("/yuedu/getChapterList").coroutineHandler(coroutineScope) { getChapterList(it) }
        router.post("/yuedu/getContent").coroutineHandler(coroutineScope) { getContent(it) }
    }

    private fun getContent(it: RoutingContext): Any {
        val bookSource = it.bodyAsJson.getString("bookSource")
        val key = it.bodyAsJson.getString("key")
        val page = it.bodyAsJson.getInteger("page", 1)
        WebBook().searchBook()
    }

    private fun getChapterList(it: RoutingContext): Any {

    }

    private fun exploreBook(it: RoutingContext): Any {

    }

    private fun searchBook(it: RoutingContext): Any {


    }

}