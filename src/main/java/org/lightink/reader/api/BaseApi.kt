package org.gosky.aroundight.api

import io.vertx.reactivex.ext.web.Router


/**
 * @Auther: zoharSoul
 * @Date: 2019-06-26 17:14
 * @Description:
 */
interface BaseApi {

    fun initRouter(router: Router)

}