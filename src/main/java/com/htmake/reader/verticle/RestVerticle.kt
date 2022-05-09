package com.htmake.reader.verticle

import io.vertx.core.http.HttpMethod
import io.vertx.ext.web.Route
import io.vertx.ext.web.Router
import io.vertx.ext.web.RoutingContext
import io.vertx.ext.web.handler.BodyHandler
import io.vertx.ext.web.handler.CorsHandler
import io.vertx.ext.web.handler.LoggerFormat
import io.vertx.ext.web.handler.LoggerHandler
import io.vertx.ext.web.handler.SessionHandler
import io.vertx.ext.web.sstore.LocalSessionStore
import io.vertx.kotlin.coroutines.CoroutineVerticle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import mu.KotlinLogging
import com.htmake.reader.utils.error
import com.htmake.reader.utils.success
import java.net.URLDecoder


private val logger = KotlinLogging.logger {}

abstract class RestVerticle : CoroutineVerticle() {

    protected lateinit var router: Router

    open var port: Int = 8080

    override suspend fun start() {
        super.start()
        router = Router.router(vertx)
        val cookieName = "reader.session"
	    router.route().handler(
            SessionHandler.create(LocalSessionStore.create(vertx))
                            .setSessionCookieName(cookieName)
                            .setSessionTimeout(7L * 86400 * 1000)
                            .setSessionCookiePath("/")
        );
        router.route().handler {
            it.addHeadersEndHandler { _ ->
                val cookie = it.getCookie(cookieName)
                if (cookie != null) {
                    // 每次访问都延长cookie有效期
                    cookie.setMaxAge(2L * 86400 * 1000)
                    cookie.setPath("/")
                }
            }
            it.next()
        }

        // CORS support
        router.route().handler {
            it.addHeadersEndHandler { _ ->
                val origin = it.request().getHeader("Origin")
                if (origin != null && origin.isNotEmpty()) {
                    var res = it.response()
                    res.putHeader("Access-Control-Allow-Origin", origin)
                    res.putHeader("Access-Control-Allow-Credentials", "true")
                    res.putHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE")
                    res.putHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, If-Match, If-Modified-Since, If-None-Match, If-Unmodified-Since, X-Requested-With")
                }
            }
            val origin = it.request().getHeader("Origin")
            if (origin != null && origin.isNotEmpty() && it.request().method() == HttpMethod.OPTIONS) {
                it.success("")
            } else {
                it.next()
            }
        }

        router.route().handler(BodyHandler.create())

        router.route().handler(LoggerHandler.create(LoggerFormat.DEFAULT));
        router.route("/reader3/*").handler {
            logger.info("{} {}", it.request().rawMethod(), URLDecoder.decode(it.request().absoluteURI(), "UTF-8"))
            if (!it.request().rawMethod().equals("PUT") && (it.fileUploads() == null || it.fileUploads().isEmpty()) && it.bodyAsString.length > 0 && it.bodyAsString.length < 1000) {
                logger.info("Request body: {}", it.bodyAsString)
            }
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
                logger.info("Web reader running at: http://localhost:{}", port);
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

    open fun onHandlerError(ctx: RoutingContext, error: Exception) {
        logger.error("Error: {}", error)
        ctx.error(error)
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
                    onHandlerError(ctx, e)
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
                    onHandlerError(ctx, e)
                }
            }
        }
    }
}