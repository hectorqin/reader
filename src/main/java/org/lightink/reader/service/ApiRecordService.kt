package org.lightink.reader.service

import io.vertx.kotlin.mysqlclient.preparedQueryAwait
import io.vertx.mysqlclient.MySQLPool
import io.vertx.sqlclient.Tuple
import mu.KotlinLogging
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.stereotype.Service
import java.lang.RuntimeException

private val logger = KotlinLogging.logger {}

@Service
class ApiRecordService {

    @Autowired
    private lateinit var mySQLClient: MySQLPool

    /**
     * 获取api请求记录
     * @param startDate yyyy-MM-dd HH:mm:ss
     * @param endDate yyyy-MM-dd HH:mm:ss
     */
    suspend fun findApiRecord(startDate: String, endDate: String, type: String): List<Map<String, Int>> {

        val sql = "select count(status = 1) as success_count, count(status = 0) as failed_count\n" +
                "from b_history\n" +
                "where create_at > ?\n" +
                "  and create_at < ?\n" +
                when (type) {
                    "hour" -> "group by hour"
                    "minute" -> "group by minute"
                    "day" -> "group by day"
                    else -> throw RuntimeException("group by类型不正确")
                }


        return mySQLClient.preparedQueryAwait(sql, Tuple.of(startDate, endDate))
                .map {
                    val successCount = it.getInteger("success_count")
                    val failedCount = it.getInteger("failed_count")
                    mapOf("successCount" to successCount, "failedCount" to failedCount)
                }
    }

}