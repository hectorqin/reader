package org.lightink.reader

import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import io.vertx.core.json.Json
import io.vertx.reactivex.core.Vertx
import io.vertx.reactivex.ext.web.client.WebClient
import org.lightink.reader.booksource.BookSource
import org.springframework.boot.SpringApplication
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.context.annotation.Bean
import java.util.concurrent.CompletableFuture


@SpringBootApplication
class ReaderApplication {


    @Bean
    fun vertx(): Vertx {
        val vertx = Vertx.vertx()
        Json.mapper.apply {
            registerKotlinModule()
        }

        Json.prettyMapper.apply {
            registerKotlinModule()
        }
        return vertx
    }

    @Bean
    fun webClient(vertx: Vertx): WebClient {
        return WebClient.create(vertx)
    }

    @Bean
    fun bookSource(webClient: WebClient): BookSource {
        val completableFuture = CompletableFuture<BookSource>()
        webClient.getAbs("https://gitee.com/chimisgo/BookSourceRepository/raw/master/sources/%E7%A8%BB%E8%8D%89%E4%BA%BA%E4%B9%A6%E5%B1%8B.json")
                .rxSend()
                .subscribe { t ->
                    completableFuture.complete(t.bodyAsJson(BookSource::class.java))
                }
        return completableFuture.get()
    }

}


fun main(args: Array<String>) {
    SpringApplication.run(ReaderApplication::class.java, *args)
}

