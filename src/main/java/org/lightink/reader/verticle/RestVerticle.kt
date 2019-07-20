package org.lightink.reader.verticle

import io.vertx.core.http.HttpMethod
import io.vertx.reactivex.core.AbstractVerticle
import io.vertx.reactivex.ext.auth.jwt.JWTAuth
import io.vertx.reactivex.ext.web.Router
import io.vertx.reactivex.ext.web.handler.BodyHandler
import io.vertx.reactivex.ext.web.handler.CorsHandler
import io.vertx.reactivex.ext.web.handler.JWTAuthHandler
import mu.KotlinLogging
import org.gosky.aroundight.api.BaseApi
import org.lightink.reader.ext.error
import org.lightink.reader.ext.success
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.stereotype.Component


/**
 * @Date: 2019-02-24 14:50
 * @Description:
 */

private val logger = KotlinLogging.logger {}

@Component
class RestVerticle : AbstractVerticle() {

    protected lateinit var router: Router

    @Autowired
    private lateinit var apiList: List<BaseApi>

    @Autowired
    private lateinit var jwtAuth: JWTAuth

    @Throws(Exception::class)
    override fun start() {
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
        router.route().handler(BodyHandler.create()) // <3>

        router.get("/health").handler { it.success("ok!") }

        router.route("/*").handler(JWTAuthHandler.create(jwtAuth, "/user/login"));

        apiList.forEach { it.initRouter(router) }

        router.errorHandler(500) { routerContext ->
            logger.error { routerContext.failure().message }
            routerContext.error("error" to routerContext.failure().message)
        }

        vertx.createHttpServer().requestHandler(router).listen(8080)

    }


}
