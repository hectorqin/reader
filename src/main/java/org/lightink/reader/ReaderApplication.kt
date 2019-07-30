package org.lightink.reader

import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import io.vertx.core.json.Json
import io.vertx.ext.web.client.WebClientOptions
import io.vertx.reactivex.core.Vertx
import io.vertx.reactivex.ext.web.client.WebClient
import org.lightink.reader.verticle.RestVerticle
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.SpringApplication
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.context.annotation.Bean
import javax.annotation.PostConstruct


@SpringBootApplication
class ReaderApplication {
    @Autowired
    private lateinit var restVerticle: RestVerticle

    @Autowired
    private lateinit var vertx: Vertx;

    @Bean
    fun vertx(): Vertx {
        val vertx = Vertx.vertx()

        return vertx
    }

    @PostConstruct
    fun deployVerticle() {
        vertx.deployVerticle(restVerticle)
    }

    @Bean
    fun webClient(vertx: Vertx): WebClient {

        Json.mapper.apply {
            registerKotlinModule()
        }

        Json.prettyMapper.apply {
            registerKotlinModule()
        }

        val webClientOptions = WebClientOptions()
        webClientOptions.isTryUseCompression = true
        webClientOptions.logActivity = true
        val webClient = WebClient.create(vertx, webClientOptions)

        return webClient
    }


}


fun main(args: Array<String>) {
    SpringApplication.run(ReaderApplication::class.java, *args)
}

