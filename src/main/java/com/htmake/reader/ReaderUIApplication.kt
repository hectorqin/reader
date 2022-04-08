package com.htmake.reader

import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import io.vertx.core.Future
import io.vertx.core.Vertx
import io.vertx.core.http.*
import io.vertx.core.http.impl.HttpUtils
import io.vertx.core.json.Json
import io.vertx.ext.web.client.WebClient
import io.vertx.ext.web.client.WebClientOptions
import io.vertx.core.json.JsonObject
import mu.KotlinLogging
import com.htmake.reader.api.YueduApi
import com.htmake.reader.entity.Size

import com.htmake.reader.verticle.RestVerticle
import com.htmake.reader.utils.SpringContextUtils
import com.htmake.reader.SpringEvent

import com.htmake.reader.utils.getStorage
import com.htmake.reader.utils.saveStorage
import com.htmake.reader.utils.asJsonObject

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
import org.springframework.core.env.MapPropertySource

import java.util.concurrent.CompletableFuture

private val logger = KotlinLogging.logger {}
private var launchArgs = arrayOf<String>()

class ReaderUIApplication: Application() {

    private lateinit var primaryStage: Stage;
    private lateinit var splashStage: Stage;

    lateinit var webUrl: String
    lateinit var env: ConfigurableEnvironment
    var windowConfigMap = mutableMapOf<String, Any>()

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
                    // 加载 windowConfig
                    var windowConfigSource = loadPropertySourceFromWindowConfig()
                    env.getPropertySources().addFirst(windowConfigSource)
                    // 获取应用相关配置
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
                    webUrl = env.getProperty("reader.server.webUrl") ?: ("http://localhost:" + port)
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
                    // System.setProperty("reader.system.fonts", Font.getFontNames().joinToString(separator = ","))
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

    fun showAlert(message: String, wait: Boolean = true) {
        var alert = Dialog<Any>();
        alert.getDialogPane().setContentText(message);
        alert.getDialogPane().getButtonTypes().add(ButtonType.OK);
        if (wait) {
            alert.showAndWait();
        } else {
            alert.show();
        }
    }

    fun showConfirm(message: String): Boolean {
        var confirm = Dialog<Any>();
        confirm.getDialogPane().setContentText(message);
        confirm.getDialogPane().getButtonTypes().addAll(ButtonType.YES, ButtonType.NO);
        val result = confirm.showAndWait().filter(ButtonType.YES::equals).isPresent();

        return result
    }

    fun loadPropertySourceFromWindowConfig(): MapPropertySource {
        loadWindowConfig()
        var windowConfigPort = 0
        var windowConfigSource = mutableMapOf<String, Any>()
        try {
            // 支持配置 接口服务
            val serverConfig = windowConfigMap.getOrDefault("serverConfig", null) as? MutableMap<String, Any>
            if (serverConfig != null) {
                windowConfigSource = serverConfig
            }

            val serverPort = windowConfigMap.getOrDefault("serverPort", null)
            if (serverPort != null) {
                windowConfigPort = serverPort as Int
                if (windowConfigPort > 0) {
                    windowConfigSource.put("reader.server.port", windowConfigPort)
                }
            }
            val showUI = windowConfigMap.getOrDefault("showUI", true) as Boolean? ?: true
            windowConfigSource.put("reader.app.showUI", showUI)
            val debug = windowConfigMap.getOrDefault("debug", null)
            if (debug != null) {
                windowConfigSource.put("reader.app.debug", debug as Boolean)
            }
        } catch(e: Exception) {
            e.printStackTrace()
        }

        logger.info("windowConfigSource: {}", windowConfigSource)
        return MapPropertySource("windowConfig", windowConfigSource)
    }

    fun loadWindowConfig() {
        val windowConfigObject = asJsonObject(getStorage("windowConfig"))
        if (windowConfigObject != null) {
            windowConfigMap = windowConfigObject.map
        }
        logger.info("windowConfigMap: {}", windowConfigMap)
    }

    fun getWindowConfigDoubleProperty(name: String, defaultVal: Double): Double {
        var value = windowConfigMap.getOrDefault(name, defaultVal)
        return when(value) {
            is Int -> value.toDouble()
            is Double -> value
            else -> defaultVal
        }
    }

    fun applyWindowConfig(stage: Stage): Size {
        var width = 1280.0;
        var height = 800.0;
        try {
            loadWindowConfig()
            val setWindowPosition = windowConfigMap.getOrDefault("setWindowPosition", false) as Boolean? ?: false
            if (setWindowPosition) {
                var positionX = getWindowConfigDoubleProperty("positionX", 0.0)
                var positionY = getWindowConfigDoubleProperty("positionY", 0.0)
                stage.setX(positionX)
                stage.setY(positionY)
            }
            val rememberSize = windowConfigMap.getOrDefault("rememberSize", true) as Boolean? ?: true
            val rememberPosition = windowConfigMap.getOrDefault("rememberPosition", false) as Boolean? ?: false
            if (rememberSize) {
                stage.widthProperty().addListener{_, _, w ->
                    windowConfigMap.put("width", w)
                }
                // stage.heightProperty().addListener{_, _, h ->
                //     windowConfigMap.put("height", h)
                // }
                stage.sceneProperty().addListener{_, _, s ->
                    s.heightProperty().addListener{_, _, h ->
                        windowConfigMap.put("height", h)
                    }
                }
            }
            if (rememberPosition) {
                stage.xProperty().addListener{_, _, x ->
                    windowConfigMap.put("positionX", x)
                }
                stage.yProperty().addListener{_, _, y ->
                    windowConfigMap.put("positionY", y)
                }
            }
            val setWindowSize = windowConfigMap.getOrDefault("setWindowSize", true) as Boolean? ?: true
            if (setWindowSize) {
                width = getWindowConfigDoubleProperty("width", width)
                height = getWindowConfigDoubleProperty("height", height)
            }
        } catch(e: Exception) {
            showAlert("窗口配置加载失败，请检查窗口配置文件(windowConfig.json)", false)
            e.printStackTrace()
        }
        return Size(width, height)
    }

    fun showWebScreen(stage: Stage, url: String) {
        // 配置主窗口
        var windowSize = applyWindowConfig(stage);
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
        var reloadCount = 0;
        webEngine.getLoadWorker().stateProperty().addListener{_, oldState, newState ->
            logger.info("State from {} to {} , exception: {}", oldState, newState, webEngine.getLoadWorker().getException());
            if (newState == Worker.State.FAILED) {
                if (reloadCount < 5) {
                    reloadCount += 1
                    logger.info("reload {}", url)
                    webEngine.load(url);
                }
            }
        }
        webEngine.titleProperty().addListener{_, _, t ->
            if (t != null && t.isNotEmpty()) {
                stage.setTitle(t)
            }
        }
        webEngine.load(url);
        val scene = Scene(webView, windowSize.width, windowSize.height)
        stage.setScene(scene)
        stage.setTitle("阅读")
        stage.getIcons().addAll(defaultIcons);
        stage.initStyle(StageStyle.UNIFIED);
        stage.show()
    }

    override fun stop() {
        saveStorage("windowConfig", value = windowConfigMap, pretty = true)
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




