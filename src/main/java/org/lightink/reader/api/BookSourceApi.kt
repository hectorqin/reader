package org.lightink.reader.api

import io.vertx.ext.web.Route
import io.vertx.ext.web.Router
import io.vertx.ext.web.RoutingContext
import io.vertx.kotlin.coroutines.dispatcher
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import mu.KotlinLogging
import org.gosky.aroundight.api.BaseApi
import org.lightink.reader.service.BookSourceService
import org.lightink.reader.verticle.coroutineHandler
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.stereotype.Component

/**
 * @Date: 2019-07-29 23:58
 * @Description:
 */

private val logger = KotlinLogging.logger {}

@Component
class BookSourceApi : BaseApi {

    @Autowired
    private lateinit var bookSourceService: BookSourceService


    override suspend fun initRouter(router: Router) {

        router.get("/book_source/repository")
                .coroutineHandler {
                    bookSourceService.bookSourceRepositoryList()
                }

        router.get("/book_source/description/:code")
                .coroutineHandler {
                    val code = it.pathParam("code")
                    bookSourceService.bookSourceDescription(code)
                }

        router.get("/book_source/:code/:name")
                .coroutineHandler {
                    val code = it.pathParam("code")
                    val name = it.pathParam("name")
                    bookSourceService.bookSource(code, name)
                }

        router.get("/git/repository.json")
                .coroutineHandler {
                    bookSourceService.serverRepositoryJson()

                }

        router.get("/git/sources/:name")
                .coroutineHandler {
                    val name = it.pathParam("name")
                    bookSourceService.serverBookSourceJson(name.replace(".json", ""))
                }

    }

}