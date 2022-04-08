package com.htmake.reader

import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import io.vertx.core.Future
import io.vertx.core.Vertx
import io.vertx.core.http.*
import io.vertx.core.json.Json
import io.vertx.ext.web.client.WebClient
import io.vertx.ext.web.client.WebClientOptions
import mu.KotlinLogging
import com.htmake.reader.api.YueduApi

import com.htmake.reader.verticle.RestVerticle
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.SpringApplication
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.context.annotation.Bean
import javax.annotation.PostConstruct

private val logger = KotlinLogging.logger {}

@SpringBootApplication
@EnableScheduling
class ReaderApplication {

    @Autowired
    private lateinit var yueduApi: YueduApi

    companion object {
        val vertx by lazy { Vertx.vertx() }
        fun vertx() = vertx
    }

    @PostConstruct
    fun deployVerticle() {
        Json.mapper.apply {
            registerKotlinModule()
        }

        Json.prettyMapper.apply {
            registerKotlinModule()
        }

        Json.mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        vertx().deployVerticle(yueduApi)
    }

    @Bean
    fun webClient(): WebClient {
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
}




