package org.lightink.reader.service

import io.legado.app.utils.MD5Utils
import io.vertx.core.json.Json
import io.vertx.core.json.JsonObject
import io.vertx.ext.web.client.WebClient
import io.vertx.kotlin.core.json.get
import mu.KotlinLogging
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import javax.annotation.PostConstruct

private val logger = KotlinLogging.logger {}

@Component
class YueduSchedule {

    private val shuyuanUrl = "https://xiu2.github.io/yuedu/shuyuan"
    @Autowired
    private lateinit var webClient: WebClient

    @Scheduled(cron = "0 0 2 * * ?")
    @PostConstruct
    fun getBookSource() {
        webClient.getAbs(shuyuanUrl)
                .send {
                    val map = mutableMapOf<String, String>()
                    it.result().bodyAsJsonArray()
                            .forEach {
                                val md5Encode = MD5Utils
                                        .md5Encode(JsonObject.mapFrom(it).getString("bookSourceUrl")).toString()
                                map.put(md5Encode, it.toString())
                            }
                    Shuyuan.shuyuanlist = map
                    logger.info("shuyuan: {}", map)
                }
    }

    companion object Shuyuan {
        var shuyuanlist = mutableMapOf<String, String>()

        fun get(hashcode: String): String {
            return shuyuanlist.getOrDefault(hashcode,"")
        }
    }
}
