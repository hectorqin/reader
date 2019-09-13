package org.lightink.reader

import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import io.vertx.core.Future
import io.vertx.core.Vertx
import io.vertx.core.http.*
import io.vertx.core.http.impl.HttpUtils
import io.vertx.core.json.Json
import io.vertx.ext.web.client.WebClient
import io.vertx.ext.web.client.WebClientOptions

import org.lightink.reader.verticle.RestVerticle
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.SpringApplication
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.context.annotation.Bean
import uk.org.lidalia.sysoutslf4j.context.SysOutOverSLF4J
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
        webClientOptions.isFollowRedirects = true
        webClientOptions.isTrustAll = true

        val httpClient = vertx.createHttpClient(HttpClientOptions().setTrustAll(true))
        httpClient.redirectHandler { resp ->
            try {
                val statusCode = resp.statusCode()
                val location = resp.getHeader(HttpHeaders.LOCATION)
                if (location != null && (statusCode == 301 || statusCode == 302 || statusCode == 303 || statusCode == 307)) {
                    val m = resp.request().method()
//                    if (statusCode == 303) {
//                        m = HttpMethod.GET
//                    } else if (m != HttpMethod.GET && m != HttpMethod.HEAD) {
//                        return@redirectHandler null
//                    }
                    val uri = HttpUtils.resolveURIReference(resp.request().absoluteURI(), location)
                    val ssl: Boolean
                    var port = uri.getPort()
                    val protocol = uri.getScheme()
                    val chend = protocol.get(protocol.length - 1)
                    if (chend == 'p') {
                        ssl = false
                        if (port == -1) {
                            port = 80
                        }
                    } else if (chend == 's') {
                        ssl = true
                        if (port == -1) {
                            port = 443
                        }
                    } else {
                        return@redirectHandler null
                    }
                    var requestURI = uri.getPath()
                    val query = uri.getQuery()
                    if (query != null) {
                        requestURI += "?$query"
                    }
                    val requestOptions = RequestOptions()
                    requestOptions.host = uri.host
                    requestOptions.port = port
                    requestOptions.isSsl = ssl
                    requestOptions.uri = requestURI
                    return@redirectHandler Future.succeededFuture<HttpClientRequest>(httpClient.request(m, requestOptions))
                }
                return@redirectHandler null
            } catch (e: Exception) {
                return@redirectHandler Future.failedFuture<HttpClientRequest>(e)
            }
        }

//        val webClient = WebClient.wrap(HttpClient(delegateHttpClient), webClientOptions)
        val webClient = WebClient.wrap(httpClient, webClientOptions)


        return webClient
    }


}


fun main(args: Array<String>) {
    SpringApplication.run(ReaderApplication::class.java, *args)

    SysOutOverSLF4J.sendSystemOutAndErrToSLF4J();

}

