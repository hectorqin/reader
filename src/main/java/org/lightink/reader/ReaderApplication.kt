package org.lightink.reader

import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import com.google.gson.Gson
import io.vertx.core.json.Json
import io.vertx.ext.web.client.WebClientOptions
import io.vertx.reactivex.core.Vertx
import io.vertx.reactivex.ext.web.client.WebClient
import org.lightink.reader.booksource.BookSource
import org.lightink.reader.verticle.RestVerticle
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.SpringApplication
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.context.annotation.Bean
import java.util.concurrent.CompletableFuture
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
        val webClientOptions = WebClientOptions()
        webClientOptions.isTryUseCompression = true
        webClientOptions.logActivity = true
        val webClient = WebClient.create(vertx, webClientOptions)

        return webClient
    }

    @Bean
    fun bookSource(webClient: WebClient): BookSource {

        Json.mapper.apply {
            registerKotlinModule()
        }

        Json.prettyMapper.apply {
            registerKotlinModule()
        }

        val completableFuture = CompletableFuture<BookSource>()
        webClient.getAbs("https://gitee.com/hunji66/hm-source/raw/master/sources/%E6%88%91%E7%9A%84%E5%B0%8F%E4%B9%A6%E5%B1%8B.json")
                .rxSend()
                .subscribe { t ->
                    completableFuture.complete(Gson().fromJson<BookSource>(t.bodyAsString(),BookSource::class.java))
                }
        return completableFuture.get()
    }

}


fun main(args: Array<String>) {
    SpringApplication.run(ReaderApplication::class.java, *args)
}

