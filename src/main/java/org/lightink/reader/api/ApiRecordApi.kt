//package org.lightink.reader.api
//
//import io.vertx.ext.web.Router
//import kotlinx.coroutines.CoroutineScope
//import org.gosky.aroundight.api.BaseApi
//import org.lightink.reader.service.ApiRecordService
//import org.lightink.reader.verticle.coroutineHandler
//import org.springframework.beans.factory.annotation.Autowired
//import org.springframework.stereotype.Component
//import kotlin.time.days
//
//@Component
//class ApiRecordApi : BaseApi {
//
//    @Autowired
//    private lateinit var apiRecordService: ApiRecordService
//
//    override suspend fun initRouter(router: Router, coroutineScope: CoroutineScope) {
//        router.get("/api_record/list")
//                .coroutineHandler(coroutineScope) {
//                    val startDate = it.queryParams().get("startDate")
//                    val endDate = it.queryParams().get("endDate")
//                    val type = it.queryParams().get("type")
//
//                    return@coroutineHandler apiRecordService.findApiRecord(startDate, endDate, type)
//                }
//    }
//}