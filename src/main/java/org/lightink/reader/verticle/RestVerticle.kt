package org.lightink.reader.verticle

import io.vertx.core.http.HttpMethod
import io.vertx.ext.web.Route
import io.vertx.ext.web.Router
import io.vertx.ext.web.RoutingContext
import io.vertx.ext.web.handler.BodyHandler
import io.vertx.ext.web.handler.CorsHandler
import io.vertx.ext.web.handler.LoggerFormat
import io.vertx.ext.web.handler.LoggerHandler
import io.vertx.kotlin.coroutines.CoroutineVerticle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import mu.KotlinLogging
import org.lightink.reader.utils.error
import org.lightink.reader.utils.success
import java.net.URLDecoder


private val logger = KotlinLogging.logger {}

abstract class RestVerticle : CoroutineVerticle() {

    protected lateinit var router: Router

    open var port: Int = 8080

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

        router.route().handler(LoggerHandler.create(LoggerFormat.DEFAULT));
        router.route("/reader3/*").handler {
            logger.info("request url: {}", URLDecoder.decode(it.request().absoluteURI()))
            logger.info("request body: {}", it.bodyAsString)
            it.next()
        }

        router.get("/health").handler { it.success("ok!") }

        initRouter(router)

//        router.errorHandler(500) { routerContext ->
//            logger.error { routerContext.failure().message }
//            routerContext.error(routerContext.failure())
//        }

        router.route().last().failureHandler { ctx ->
            ctx.error(ctx.failure())
        }

        logger.info("port: {}", port)
        vertx.createHttpServer().requestHandler(router).exceptionHandler{error ->
            onException(error)
        }.listen(port) { res ->
            if (res.succeeded()) {
                logger.info("Server running at: http://localhost:{}", port);
                logger.info("Web reader running at: http://localhost:{}/web/", port);
                started();
            } else {
                onStartError();
            }
        }
    }

    abstract suspend fun initRouter(router: Router);

    open fun onException(error: Throwable) {
        logger.error("vertx exception: {}", error)
    }

    open fun onStartError() {
    }

    open fun started() {

    }

    /**
     * An extension method for simplifying coroutines usage with Vert.x Web routers
     */
    fun Route.coroutineHandler(fn: suspend (RoutingContext) -> Any) {
        handler { ctx ->
            val job = launch(Dispatchers.IO) {
                try {
                    ctx.success(fn(ctx))
//                    fn(ctx)
                } catch (e: Exception) {
                    logger.error("Error: {}", e)
                    ctx.error(e)
                }
            }
        }
    }

    fun Route.coroutineHandlerWithoutRes(fn: suspend (RoutingContext) -> Any) {
        handler { ctx ->
            val job = launch(Dispatchers.IO) {
                try {
                    fn(ctx)
                } catch (e: Exception) {
                    logger.error("Error: {}", e)
                    ctx.error(e)
                }
            }
        }
    }
}