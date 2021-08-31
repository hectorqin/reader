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
import org.lightink.reader.api.YueduApi
import org.lightink.reader.config.MysqlConfig

import org.lightink.reader.verticle.RestVerticle
import org.lightink.reader.utils.SpringContextUtils
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.SpringApplication
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.context.annotation.Bean
import org.springframework.context.ConfigurableApplicationContext
import uk.org.lidalia.sysoutslf4j.context.SysOutOverSLF4J
import javax.annotation.PostConstruct

import java.util.function.Consumer

import javafx.application.Application
import javafx.application.Platform
import javafx.scene.Scene
import javafx.scene.web.WebView
import javafx.stage.Stage
import javafx.stage.WindowEvent
import javafx.event.EventHandler

import org.springframework.boot.CommandLineRunner
import org.springframework.core.env.Environment

private val logger = KotlinLogging.logger {}

@SpringBootApplication
class ReaderApplication(): Application(), CommandLineRunner, Consumer<Stage> {

    @Autowired
    private lateinit var yueduApi: YueduApi

    //注入对象
    @Autowired
    private lateinit var env: Environment;

    private lateinit var primaryStage: Stage;

    companion object {
        val vertx by lazy { Vertx.vertx() }
        var context: ConfigurableApplicationContext? = null
        fun vertx() = vertx
        lateinit var webUrl: String
    }

    @PostConstruct
    fun deployVerticle() {
        vertx().deployVerticle(yueduApi)
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

    override fun run(args: Array<String>) {
        logger.info("args: {}", args)
        var showUI = env.getProperty("reader.app.showUI", Boolean::class.java)
        logger.info("showUI: {}", showUI)
        webUrl = env.getProperty("reader.server.webUrl") ?: ("http://localhost:" + yueduApi.port + "/web/")
        logger.info("webUrl: {}", webUrl)
        if (showUI !== null && showUI) {
            System.setProperty("sun.net.http.allowRestrictedHeaders", "true")
            launch();
            Platform.runLater(object : Runnable {
                override fun run() {
                    val stage = Stage()
                    try {
                        start(stage)
                    } catch (e: Exception) {
                        // TODO Auto-generated catch block
                        e.printStackTrace()
                    }
                }
            })
        }
    }

    override fun start(stage: Stage) {
        try {
            primaryStage = stage
            accept(primaryStage)
        } catch(e: Exception) {
            e.printStackTrace()
        }
    }

    override fun accept(stage: Stage) {
        var webView = WebView();
        var webEngine = webView.getEngine();
        webEngine.load(webUrl);
        val scene = Scene(webView, 1280.0, 800.0)
        stage.setScene(scene)
        stage.setTitle("Reader")
        stage.show()
    }

    override fun stop() {
        var context = SpringContextUtils.getApplicationContext()
        logger.info("application stop: {}", context)
        System.exit(SpringApplication.exit(context))
    }
}

fun main(args: Array<String>) {
    SpringApplication.run(ReaderApplication::class.java, *args)
}




