package org.lightink.reader.ext

import com.google.gson.Gson

import io.vertx.core.json.JsonObject
import io.vertx.ext.web.RoutingContext
import mu.KotlinLogging
import org.lightink.reader.entity.BasicError


/**
 * @Auther: zoharSoul
 * @Date: 2019-05-21 16:17
 * @Description:
 */
private val logger = KotlinLogging.logger {}

fun RoutingContext.success(any: Any?) {
    val toJson: String = if (any is JsonObject) {
        any.toString()
    } else {
        Gson().toJson(any)
    }
    this.response()
            .putHeader("content-type", "application/json")
            .end(toJson)
}

fun RoutingContext.error(throwable: Throwable) {
    val basicError = BasicError(
            "Internal Server Error",
            throwable,
            throwable.message.toString(),
            this.request().uri(),
            500,
            System.currentTimeMillis()
    )

    val errorJson = Gson().toJson(basicError)
    logger.error { errorJson }
    this.response()
            .putHeader("content-type", "application/json")
            .setStatusCode(500)
            .end(errorJson)
}

//fun Single<*>.subscribe(routingContext: RoutingContext) {
//
//    this.subscribe({ onSuccess ->
//        routingContext.success(onSuccess)
//    }, { error ->
//        error.printStackTrace()
//        routingContext.error(error)
//    })
//
//}
//
//fun Maybe<*>.subscribe(routingContext: RoutingContext) {
//
//    this.subscribe({ onSuccess ->
//        routingContext.success(onSuccess)
//    }, { error ->
//        error.printStackTrace()
//        routingContext.error(error)
//    })
//
//}