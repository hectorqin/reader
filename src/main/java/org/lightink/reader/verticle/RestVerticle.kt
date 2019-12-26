package org.lightink.reader.verticle

import io.vertx.core.http.HttpMethod
import io.vertx.core.logging.LoggerFactory
import io.vertx.core.logging.SLF4JLogDelegateFactory
import io.vertx.ext.web.Route
import io.vertx.ext.web.Router
import io.vertx.ext.web.RoutingContext
import io.vertx.ext.web.handler.BodyHandler
import io.vertx.ext.web.handler.CorsHandler
import io.vertx.ext.web.handler.LoggerFormat
import io.vertx.ext.web.handler.LoggerHandler
import io.vertx.kotlin.coroutines.CoroutineVerticle
import io.vertx.kotlin.coroutines.dispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import mu.KotlinLogging
import org.gosky.aroundight.api.BaseApi
import org.lightink.reader.utils.error
import org.lightink.reader.utils.success
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.stereotype.Component
import java.net.URLDecoder


/**
 * @Date: 2019-02-24 14:50
 * @Description:
 */

private val logger = KotlinLogging.logger {}

@Component
class RestVerticle : CoroutineVerticle() {

    protected lateinit var router: Router

    @Autowired
    private lateinit var apiList: List<BaseApi>


    override suspend fun start() {
        super.start()
        router = Router.router(vertx)

        // CORS support
        val allowedHeaders = HashSet<String>()
        allowedHeaders.add("x-requested-with")
        //        allowedHeaders.add("Access-Control-Allow-Origin");
        allowedHeaders.add("Access-Control-Allow-Headers")
        allowedHeaders.add("origin")
        allowedHeaders.add("Content-Type")
        allowedHeaders.add("accept")
        allowedHeaders.add("authorization")
        allowedHeaders.add("X-PINGARUNER")

        val allowedMethods = HashSet<HttpMethod>()
        allowedMethods.add(HttpMethod.GET)
        allowedMethods.add(HttpMethod.POST)
        allowedMethods.add(HttpMethod.OPTIONS)
        /*
         * these methods aren't necessary for this sample,
         * but you may need them for your projects
         */
        allowedMethods.add(HttpMethod.DELETE)
        allowedMethods.add(HttpMethod.PATCH)
        allowedMethods.add(HttpMethod.PUT)

        router.route().handler(CorsHandler.create("*").allowedHeaders(allowedHeaders).allowedMethods(allowedMethods))
        router.route().handler(BodyHandler.create())


        System.setProperty(LoggerFactory.LOGGER_DELEGATE_FACTORY_CLASS_NAME, SLF4JLogDelegateFactory::class.java.name)

        LoggerFactory.getLogger(LoggerFactory::class.java) // Required for Logback to work in Vertx


        router.route().handler(LoggerHandler.create(LoggerFormat.DEFAULT));
        router.route().handler {
            logger.info("request url: {}", URLDecoder.decode(it.request().absoluteURI()))
            logger.info("request body: {}", it.bodyAsString)
            it.next()
        }

        router.get("/health").handler { it.success("ok!") }
        apiList.forEach { it.initRouter(router, CoroutineScope(coroutineContext)) }

//        router.errorHandler(500) { routerContext ->
//            logger.error { routerContext.failure().message }
//            routerContext.error(routerContext.failure())
//        }

        router.route().last().failureHandler { ctx ->
            ctx.error(ctx.failure())
        }

        vertx.createHttpServer().requestHandler(router).listen(8080)

    }

}

/**
 * An extension method for simplifying coroutines usage with Vert.x Web routers
 */
fun Route.coroutineHandler(coroutineScope: CoroutineScope, fn: suspend (RoutingContext) -> Any) {
    handler { ctx ->
        coroutineScope.launch(ctx.vertx().dispatcher()) {
            try {
                ctx.success(fn(ctx))
            } catch (e: Exception) {
                ctx.error(e)
            }
        }
    }
}
