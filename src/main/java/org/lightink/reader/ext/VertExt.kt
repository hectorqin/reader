package org.lightink.reader.ext

import com.google.gson.Gson

import io.vertx.core.json.JsonObject
import io.vertx.ext.web.RoutingContext


/**
 * @Auther: zoharSoul
 * @Date: 2019-05-21 16:17
 * @Description:
 */


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

fun RoutingContext.error(any: Any?) {
    this.request()
            .response()
            .putHeader("content-type", "application/json")
            .setStatusCode(500)
            .end(Gson().toJson(any))
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