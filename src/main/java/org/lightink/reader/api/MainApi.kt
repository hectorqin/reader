package org.lightink.reader.api

import io.vertx.reactivex.ext.web.Router
import io.vertx.reactivex.ext.web.RoutingContext
import mu.KotlinLogging
import org.gosky.aroundight.api.BaseApi
import org.lightink.reader.ext.subscribe
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
        router.get("/:code/:name/search").handler { search(it) }
        router.get("/:code/:name/details").handler { details(it) }
        router.get("/:code/:name/content").handler { content(it) }

    }

    private fun search(routingContext: RoutingContext) {
        val key = routingContext.queryParams().get("key")
        val code = routingContext.pathParam("code")
        val name = routingContext.pathParam("name")

        logger.info { "search: $key" }
        mainService.search(code, name, key)
                .subscribe(routingContext)
    }

    private fun details(routingContext: RoutingContext) {
        val link = routingContext.queryParams().get("link")
        val code = routingContext.pathParam("code")
        val name = routingContext.pathParam("name")
        logger.info { "link: $link" }
        mainService.details(code, name, link)
                .subscribe(routingContext)

    }

    private fun content(routingContext: RoutingContext) {
        val href = routingContext.queryParams().get("href")
        val code = routingContext.pathParam("code")
        val name = routingContext.pathParam("name")
        logger.info { "href: $href" }
        mainService.content(code, name, href)
                .subscribe(routingContext)

    }

}
