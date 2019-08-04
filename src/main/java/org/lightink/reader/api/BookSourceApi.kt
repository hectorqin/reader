package org.lightink.reader.api

import io.vertx.reactivex.ext.web.Router
import mu.KotlinLogging
import org.gosky.aroundight.api.BaseApi
import org.lightink.reader.ext.subscribe
import org.lightink.reader.service.BookSourceService
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


    override fun initRouter(router: Router) {
        router.get("/book_source/repository")
                .handler {
                    bookSourceService.bookSourceRepositoryList()
                            .subscribe(it)

                }

        router.get("/book_source/description/:code")
                .handler {
                    val code = it.pathParam("code")
                    bookSourceService.bookSourceDescription(code)
                            .subscribe(it)

                }

        router.get("/book_source/:code/:name")
                .handler {
                    val code = it.pathParam("code")
                    val name = it.pathParam("name")
                    bookSourceService.bookSource(code, name)
                            .subscribe(it)

                }

        router.get("/git/repository.json")
                .handler {
                    bookSourceService.serverRepositoryJson()
                            .subscribe(it)
                }

        router.get("/git/sources/:name")
                .handler {
                    val name = it.pathParam("name")
                    bookSourceService.serverBookSourceJson(name.replace(".json", ""))
                            .subscribe(it)

                }

    }
}