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
import org.lightink.reader.SpringEvent

import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.SpringApplication
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.event.ApplicationEnvironmentPreparedEvent
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.annotation.Bean
import org.springframework.context.ConfigurableApplicationContext
import org.springframework.context.ApplicationListener
import org.springframework.context.ApplicationEvent
import uk.org.lidalia.sysoutslf4j.context.SysOutOverSLF4J
import javax.annotation.PostConstruct

import javafx.application.Application
import javafx.application.Platform
import javafx.scene.Scene
import javafx.scene.web.WebView
import javafx.scene.web.WebErrorEvent
import javafx.stage.Stage
import javafx.stage.WindowEvent
import javafx.stage.StageStyle
import javafx.event.EventHandler
import com.sun.javafx.application.LauncherImpl
import com.sun.javafx.scene.text.FontHelper
import javafx.scene.text.Font

import javafx.scene.control.ProgressBar
import javafx.scene.control.Dialog
import javafx.scene.control.ButtonType
import javafx.scene.image.ImageView
import javafx.scene.layout.VBox
import javafx.scene.paint.Color;
import javafx.scene.image.Image;
import javafx.beans.value.ChangeListener
import javafx.beans.value.ObservableValue
import javafx.concurrent.Worker

import org.springframework.core.env.Environment
import org.springframework.core.env.ConfigurableEnvironment

import java.util.concurrent.CompletableFuture

private val logger = KotlinLogging.logger {}
private var launchArgs = arrayOf<String>()

class ReaderUIApplication: Application() {

    private lateinit var primaryStage: Stage;
    private lateinit var splashStage: Stage;

    lateinit var webUrl: String
    lateinit var env: ConfigurableEnvironment

    var isSpringBootLaunched = false
    var springBootError = ""
    var showUI = false

    var defaultIcons = arrayOf<Image>();

    fun boot() {
        launch(*launchArgs)
    }

    override fun init() {
        Thread() {
            var app = SpringApplication(ReaderApplication::class.java)
            var envListener = object: ApplicationListener<ApplicationEnvironmentPreparedEvent> {
                override fun onApplicationEvent(event: ApplicationEnvironmentPreparedEvent) {
                    env = event.getEnvironment()
                    showUI = env.getProperty("reader.app.showUI", Boolean::class.java) ?: false
                    logger.info("showUI: {}", showUI)
                    var debug = env.getProperty("reader.app.debug", Boolean::class.java)
                    logger.info("debug: {}", debug)
                    var serverPort = env.getProperty("reader.server.port", Int::class.java)
                    logger.info("serverPort: {}", serverPort)
                    var port = 8080
                    if (serverPort != null && serverPort > 0) {
                        port = serverPort;
                    }
                    webUrl = env.getProperty("reader.server.webUrl") ?: ("http://localhost:" + port + "/web/")
                    var sep = if(webUrl.contains("?")) {
                        "&"
                    } else {
                        "?"
                    }
                    if (debug != null && debug) {
                        webUrl = webUrl + sep + "debug=1&nopwa=1"
                    } else {
                        webUrl = webUrl + sep + "nopwa=1"
                    }
                    logger.info("webUrl: {}", webUrl)
                    System.setProperty("reader.system.fonts", Font.getFontNames().joinToString(separator = ","))
                    if (showUI && ::primaryStage.isInitialized){
                        Platform.runLater(object : Runnable {
                            override fun run() {
                                showSplashScreen()
                            }
                        })
                    }
                }
            }
            app.addListeners(envListener)
            var springListener = object: ApplicationListener<SpringEvent> {
                override fun onApplicationEvent(event: SpringEvent) {
                    val eventType = event.getEvent()
                    if (eventType == "READY") {
                        isSpringBootLaunched = true
                        if (showUI && ::primaryStage.isInitialized && ::webUrl.isInitialized){
                            Platform.runLater(object : Runnable {
                                override fun run() {
                                    splashStage.hide()
                                    splashStage.setScene(null)
                                    showWebScreen(primaryStage, webUrl)
                                }
                            })
                        }
                    } else if (eventType == "START_ERROR") {
                        springBootError = event.getMessage()
                        if (showUI){
                            Platform.runLater(object : Runnable {
                                override fun run() {
                                    if (::splashStage.isInitialized) {
                                        splashStage.hide()
                                        splashStage.setScene(null)
                                    }
                                    showAlert(springBootError);
                                    stop();
                                }
                            })
                        } else {
                            logger.error(springBootError);
                            stop();
                        }
                    }
                }
            }
            app.addListeners(springListener)
            app.run(*launchArgs)
        }.start()
    }

    override fun start(stage: Stage) {
        try {
            logger.info("javafx start: {}", stage)
            primaryStage = stage
            if (showUI) {
                defaultIcons = arrayOf<Image>(
                    Image(ReaderUIApplication::class.java.getResource("/icons/16x16.png").toExternalForm()),
                    Image(ReaderUIApplication::class.java.getResource("/icons/24x24.png").toExternalForm()),
                    Image(ReaderUIApplication::class.java.getResource("/icons/32x32.png").toExternalForm()),
                    Image(ReaderUIApplication::class.java.getResource("/icons/48x48.png").toExternalForm()),
                    Image(ReaderUIApplication::class.java.getResource("/icons/64x64.png").toExternalForm()),
                    Image(ReaderUIApplication::class.java.getResource("/icons/128x128.png").toExternalForm())
                )
                if (isSpringBootLaunched) {
                    showWebScreen(stage, webUrl)
                } else {
                    if (springBootError.isNotEmpty()) {
                        showAlert(springBootError)
                        stop()
                    } else {
                        showSplashScreen()
                    }
                }
            }
        } catch(e: Exception) {
            e.printStackTrace()
        }
    }

    fun showSplashScreen() {
        splashStage = Stage()
        var imageView = ImageView(ReaderUIApplication::class.java.getResource("/images/loading.gif").toExternalForm());
        // var splashProgressBar = ProgressBar();
        // splashProgressBar.setPrefWidth(imageView.getImage().getWidth());
        // splashProgressBar.setPrefHeight(10.0);

        var vbox = VBox();
        vbox.getChildren().addAll(imageView);
        // vbox.setStyle("-fx-background-color: transparent;" +
        //               "-fx-padding: 0;" +
        //               "-fx-border-style: solid inside;" +
        //               "-fx-border-width: 1;" +
        //               "-fx-border-insets: 0;" +
        //               "-fx-border-radius: 0;" +
        //               "-fx-border-color: #999;");

        var splashScene = Scene(vbox, Color.TRANSPARENT);
        splashStage.setScene(splashScene);
        splashStage.getIcons().addAll(defaultIcons);
        splashStage.initStyle(StageStyle.TRANSPARENT);
        logger.info("showSplashScreen: {}", splashStage)
        splashStage.show()
    }

    fun showAlert(message: String) {
        var alert = Dialog<Any>();
        alert.getDialogPane().setContentText(message);
        alert.getDialogPane().getButtonTypes().add(ButtonType.OK);
        alert.showAndWait();
    }

    fun showConfirm(message: String): Boolean {
        var confirm = Dialog<Any>();
        confirm.getDialogPane().setContentText(message);
        confirm.getDialogPane().getButtonTypes().addAll(ButtonType.YES, ButtonType.NO);
        val result = confirm.showAndWait().filter(ButtonType.YES::equals).isPresent();

        return result
    }

    fun showWebScreen(stage: Stage, url: String) {
        System.setProperty("sun.net.http.allowRestrictedHeaders", "true")
        // logger.info("Font.getFontNames: {}", Font.getFontNames())
        // logger.info("showWebScreen: {}", url)
        var webView = WebView();
        var webEngine = webView.getEngine();
        webEngine.setOnError{ event ->
            logger.info("error: {}", event)
        };
        webEngine.setOnAlert{ event ->
            showAlert(event.data.toString())
        };
        webEngine.setConfirmHandler{ message ->
            showConfirm(message)
        };
        webEngine.getLoadWorker().stateProperty().addListener{_, oldState, newState ->
            logger.info("State from {} to {} , exception: {}", oldState, newState, webEngine.getLoadWorker().getException());
            if (newState == Worker.State.FAILED) {
                logger.info("reload {}", url)
                webEngine.load(url);
            }
        }
        webEngine.load(url);
        val scene = Scene(webView, 1280.0, 800.0)
        stage.setScene(scene)
        stage.setTitle("Reader")
        stage.getIcons().addAll(defaultIcons);
        stage.initStyle(StageStyle.UNIFIED);
        stage.show()
    }

    override fun stop() {
        super.stop()
        var context = SpringContextUtils.getApplicationContext()
        logger.info("application stop: {}", context)
        System.exit(SpringApplication.exit(context))
    }
}

fun main(args: Array<String>) {
    logger.info("args: {}", args)
    launchArgs = args
    val app = ReaderUIApplication()
    app.boot()
}




