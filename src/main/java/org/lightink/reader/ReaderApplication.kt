package org.lightink.reader

import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import io.vertx.core.Future
import io.vertx.core.Vertx
import io.vertx.core.http.*
import io.vertx.core.http.impl.HttpUtils
import io.vertx.core.json.Json
import io.vertx.ext.web.client.WebClient
import io.vertx.ext.web.client.WebClientOptions
import io.vertx.kotlin.mysqlclient.MySQLConnectOptions
import io.vertx.kotlin.mysqlclient.mySQLConnectOptionsOf
import io.vertx.kotlin.sqlclient.PoolOptions
import io.vertx.kotlin.sqlclient.poolOptionsOf
import io.vertx.mysqlclient.MySQLConnectOptions
import io.vertx.mysqlclient.MySQLPool
import mu.KotlinLogging
import org.lightink.reader.config.MysqlConfig

import org.lightink.reader.verticle.RestVerticle
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.SpringApplication
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.context.annotation.Bean
import uk.org.lidalia.sysoutslf4j.context.SysOutOverSLF4J
import javax.annotation.PostConstruct

private val logger = KotlinLogging.logger {}

@SpringBootApplication
class ReaderApplication {

    @Autowired
    private lateinit var restVerticle: RestVerticle

    companion object {
        fun vertx() = Vertx.vertx()
    }

    @PostConstruct
    fun deployVerticle() {
        vertx().deployVerticle(restVerticle)
    }

    @Bean
    fun webClient(): WebClient {

        Json.mapper.apply {
            registerKotlinModule()
        }

        Json.prettyMapper.apply {
            registerKotlinModule()
        }

        Json.mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        val webClientOptions = WebClientOptions()
        webClientOptions.isTryUseCompression = true
        webClientOptions.logActivity = true
        webClientOptions.isFollowRedirects = true
        webClientOptions.isTrustAll = true

        val httpClient = vertx().createHttpClient(HttpClientOptions().setTrustAll(true))

//        val webClient = WebClient.wrap(HttpClient(delegateHttpClient), webClientOptions)
        val webClient = WebClient.wrap(httpClient, webClientOptions)

        return webClient
    }

}

fun main(args: Array<String>) {
    SpringApplication.run(ReaderApplication::class.java, *args)
    SysOutOverSLF4J.sendSystemOutAndErrToSLF4J();

}




