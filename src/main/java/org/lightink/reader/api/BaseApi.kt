package org.gosky.aroundight.api

import io.vertx.ext.web.Route
import io.vertx.ext.web.Router
import io.vertx.ext.web.RoutingContext
import io.vertx.kotlin.coroutines.dispatcher
import kotlinx.coroutines.launch


/**
 * @Auther: zoharSoul
 * @Date: 2019-06-26 17:14
 * @Description:
 */
interface BaseApi {

    suspend fun initRouter(router: Router)



}