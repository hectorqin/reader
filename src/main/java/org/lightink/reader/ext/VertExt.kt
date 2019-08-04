package org.lightink.reader.ext

import com.google.gson.Gson
import io.reactivex.Maybe
import io.reactivex.Single
import io.vertx.core.json.JsonObject
import io.vertx.reactivex.ext.web.RoutingContext


/**
 * @Auther: zoharSoul
 * @Date: 2019-05-21 16:17
 * @Description:
 */


fun RoutingContext.success(any: Any?) {
    var toJson: String
    if (any is JsonObject) {
        toJson = any.toString()
    } else {
        toJson = Gson().toJson(any)
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

fun Single<*>.subscribe(routingContext: RoutingContext) {

    this.subscribe({ onSuccess ->
        routingContext.success(onSuccess)
    }, { error ->
        routingContext.error(error)
    })

}

fun Maybe<*>.subscribe(routingContext: RoutingContext) {

    this.subscribe({ onSuccess ->
        routingContext.success(onSuccess)
    }, { error ->
        routingContext.error(error)
    })

}