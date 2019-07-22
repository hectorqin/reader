package org.lightink.reader.api

import io.vertx.reactivex.ext.web.Router
import io.vertx.reactivex.ext.web.RoutingContext
import mu.KotlinLogging
import org.gosky.aroundight.api.BaseApi
import org.lightink.reader.ext.success
import org.lightink.reader.service.MainService
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.stereotype.Component


/**
 * @Auther: zoharSoul
 * @Date: 2019-05-21 11:20
 * @Description:
 */
private val logger = KotlinLogging.logger {}

@Component
class MainApi : BaseApi {

    @Autowired
    private lateinit var mainService: MainService

    override fun initRouter(router: Router) {
        router.get("/search").handler { search(it) }
        router.get("/details").handler { details(it) }

    }

    private fun search(routingContext: RoutingContext) {
        val key = routingContext.queryParams().get("key")
        logger.info { "search: $key" }
        mainService.search(key)
                .subscribe { t ->
                    routingContext.success(t)
                }
    }

    private fun details(routingContext: RoutingContext) {
        val link = routingContext.queryParams().get("link")
        logger.info { "link: $link" }
        mainService.details(link)
                .subscribe { t ->
                    routingContext.success(t)
                }
    }

}
