package org.lightink.reader.api


import io.vertx.ext.web.Router
import io.vertx.ext.web.RoutingContext
import kotlinx.coroutines.CoroutineScope
import mu.KotlinLogging
import org.gosky.aroundight.api.BaseApi
import org.lightink.reader.service.MainService
import org.lightink.reader.verticle.coroutineHandler
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

    override suspend fun initRouter(router: Router, coroutineScope: CoroutineScope) {
        router.get("/:code/:name/search").coroutineHandler(coroutineScope) { search(it) }
        router.get("/:code/:name/details").coroutineHandler(coroutineScope) { details(it) }
        router.get("/:code/:name/content").coroutineHandler(coroutineScope) { content(it) }
        router.get("/:code/:name/rank/top/:classify").coroutineHandler(coroutineScope) { rank(it) }

    }

    private suspend fun search(routingContext: RoutingContext): List<HashMap<String, String?>> {
        val key = routingContext.queryParams().get("key")
        val code = routingContext.pathParam("code")
        val name = routingContext.pathParam("name")

        //日志打点
        //code name searchurl search key
        logger.info("search ==> code: {} , name: {} , search key: {}", code, name, key)

        return mainService.search(code, name, key)
    }

    private suspend fun details(routingContext: RoutingContext): HashMap<String, Any> {
        val link = routingContext.queryParams().get("link")
        val code = routingContext.pathParam("code")
        val name = routingContext.pathParam("name")
        logger.info { "link: $link" }
        return mainService.details(code, name, link)
    }

    private suspend fun content(routingContext: RoutingContext): HashMap<String, Any> {
        val href = routingContext.queryParams().get("href")
        val code = routingContext.pathParam("code")
        val name = routingContext.pathParam("name")
        logger.info { "href: $href" }
        return mainService.content(code, name, href)


    }

    private suspend fun rank(routingContext: RoutingContext): List<HashMap<String, String?>> {
        val classify = routingContext.pathParam("classify")
        val code = routingContext.pathParam("code")
        val name = routingContext.pathParam("name")

        logger.info { "rank: $classify" }
        return mainService.rank(code, name, classify)

    }


}
