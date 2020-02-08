package org.gosky.aroundight.api

import io.vertx.ext.web.Router
import kotlinx.coroutines.CoroutineScope


/**
 * @Auther: zoharSoul
 * @Date: 2019-06-26 17:14
 * @Description:
 */
interface BaseApi {

    suspend fun initRouter(router: Router)



}