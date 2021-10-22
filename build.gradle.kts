import org.openjfx.gradle.*
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile
import java.lang.reflect.*
import io.github.fvarrui.javapackager.model.Platform
import io.github.fvarrui.javapackager.model.WindowsConfig
import de.undercouch.gradle.tasks.download.Download

buildscript {
    val kotlin_version: String by extra
    extra["kotlin_version"] = "1.3.50"
    repositories {
	    mavenLocal()
        mavenCentral()
    }
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlin_version")
        classpath("io.github.fvarrui:javapackager:1.6.1-SNAPSHOT")
    }
}
plugins {
    id("org.springframework.boot") version "2.1.6.RELEASE"
    id("java")
    id("application")
    id("org.openjfx.javafxplugin") version "0.0.9"
    id("org.jetbrains.kotlin.plugin.spring") version "1.3.61"
}

configure<JavaFXOptions> {
    version = "11.0.2"
    modules = listOf("javafx.web")

    // Set JAVAFX_PLATFORM to "linux", "win", or "mac"
    val javafxPlatformOverride = System.getenv("JAVAFX_PLATFORM")
    if (javafxPlatformOverride != null) {
        val javafxPlatform: JavaFXPlatform = JavaFXPlatform.values()
            .firstOrNull { it.classifier == javafxPlatformOverride }
            ?: throw IllegalArgumentException("JAVAFX_PLATFORM $javafxPlatformOverride not in list:" +
                    " ${JavaFXPlatform.values().map { it.classifier }}")

        logger.info("Overriding JavaFX platform to {}", javafxPlatform)

        // Override the private platform field
        val platformField: Field = JavaFXOptions::class.java.getDeclaredField("platform")
        platformField.isAccessible = true
        platformField.set(this, javafxPlatform)

        // Invoke the private updateJavaFXDependencies() method
        val updateDeps: Method = JavaFXOptions::class.java.getDeclaredMethod("updateJavaFXDependencies")
        updateDeps.isAccessible = true
        updateDeps.invoke(this)
    }
}

apply(plugin = "io.spring.dependency-management")
apply(plugin = "kotlin")
apply(plugin = "io.github.fvarrui.javapackager.plugin")

group = "org.lightink"
version = "1.7.0"

java {
    sourceCompatibility = JavaVersion.VERSION_1_8
    targetCompatibility = JavaVersion.VERSION_1_8
}

repositories {
    mavenCentral()
    maven("https://jitpack.io")
    maven("https://gitlab.com/api/v4/projects/26729549/packages/maven")
    google()
    jcenter()
}

val compileOnly by configurations.getting {
    extendsFrom(configurations["annotationProcessor"])
}

dependencies {
    val kotlin_version: String by extra
    implementation("org.springframework.boot:spring-boot-starter")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    implementation("org.jetbrains.kotlin:kotlin-stdlib-jdk8:$kotlin_version")
    implementation("org.jsoup:jsoup:1.14.1")
    implementation("com.google.code.gson:gson:2.8.5")
    implementation("io.vertx:vertx-core:3.8.1")
    implementation("io.vertx:vertx-lang-kotlin:3.8.1")
    implementation("io.vertx:vertx-lang-kotlin-coroutines:3.8.1")
    implementation("io.vertx:vertx-web:3.8.1")
    implementation("io.vertx:vertx-web-client:3.8.1")
//    implementation("io.vertx:vertx-rx-java2:3.8.1")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.9.+")
    implementation("io.github.microutils:kotlin-logging:1.6.24")
    implementation("com.google.guava:guava:28.0-jre")
    implementation("com.squareup.okhttp3:okhttp:4.1.1")
    implementation("uk.org.lidalia:sysout-over-slf4j:1.0.2")
    implementation("io.vertx:vertx-mysql-client:3.8.1")
    //Retrofit
    implementation("com.squareup.okhttp3:logging-interceptor:4.1.0")
    implementation("com.squareup.retrofit2:retrofit:2.6.1")

    implementation("com.github.gedoor:rhino-android:1.3")
    implementation("cn.wanghaomiao:JsoupXpath:2.3.2")
    implementation("com.jayway.jsonpath:json-path:2.4.0")
    implementation("com.julienviet:retrofit-vertx:1.1.3")
    implementation("com.squareup.okhttp3:logging-interceptor:4.2.1")

    // implementation("xmlpull:xmlpull:1.1.3.1")
    implementation("org.xmlpull:xmlpull:1.1.4.0")
    implementation("com.github.stefanhaustein:kxml2:2.5.0")
}

val compileKotlin: KotlinCompile by tasks
val compileTestKotlin: KotlinCompile by tasks

compileKotlin.kotlinOptions {
    jvmTarget = "1.8"
}
compileTestKotlin.kotlinOptions {
    jvmTarget = "1.8"
}

application {
    // Define the main class for the application
    mainClassName = "org.lightink.reader.ReaderUIApplicationKt"
}

tasks.create<io.github.fvarrui.javapackager.gradle.PackageTask>("buildReader"){
    dependsOn("build")
	// mandatory
	mainClass = "org.lightink.reader.ReaderUIApplicationKt"
	// optional
    setBundleJre(false)
    vmArgs = arrayListOf<String>("-Dreader.app.showUI=true", "-Dspring.profiles.active=prod", "-Dreader.app.packaged=true", "-Dreader.app.debug=true")
}

tasks.create<io.github.fvarrui.javapackager.gradle.PackageTask>("packageReaderMac") {
    dependsOn("build")
	// mandatory
	mainClass = "org.lightink.reader.ReaderUIApplicationKt"
	// optional
    setBundleJre(false)
	// bundleJre = false
    // setCreateZipball(true)
    vmArgs = arrayListOf<String>("-Dreader.app.showUI=true", "-Dspring.profiles.active=prod", "-Dreader.app.packaged=true", "-Dreader.app.debug=false", "-Dlogging.path=\$HOME/.reader/logs")
}

tasks.create<io.github.fvarrui.javapackager.gradle.PackageTask>("packageReaderWin") {
    dependsOn("build")
	// mandatory
	mainClass = "org.lightink.reader.ReaderUIApplicationKt"
	// optional
    setBundleJre(false)
	// bundleJre = true
    // jrePath = File(buildDir, "win64-jre")
    setCreateZipball(true)
    platform = Platform.windows
    vmArgs = arrayListOf<String>("-Dreader.app.showUI=true", "-Dspring.profiles.active=prod", "-Dreader.app.debug=false")
    withGroovyBuilder {
        "winConfig" {
            "setWrapJar"(false)
        }
    }
    // winConfig {
    //     wrapJar = false
    // }
}

tasks.create<io.github.fvarrui.javapackager.gradle.PackageTask>("packageReaderLinux") {
    dependsOn("build")
	// mandatory
	mainClass = "org.lightink.reader.ReaderUIApplicationKt"
	// optional
    setBundleJre(false)
	// bundleJre = false
    setCreateZipball(true)
    platform = Platform.linux
    vmArgs = arrayListOf<String>("-Dreader.app.showUI=true", "-Dspring.profiles.active=prod", "-Dreader.app.debug=false")
    withGroovyBuilder {
        "linuxConfig" {
            "setWrapJar"(false)
        }
    }
}

tasks {
    val downloadWinJre by registering(Download::class) {
        src("https://github.com/AdoptOpenJDK/openjdk11-binaries/releases/download/jdk-11.0.8%2B10/OpenJDK11U-jre_x64_windows_hotspot_11.0.8_10.zip")
        dest(File(buildDir, "win64-jre.zip"))
        onlyIfModified(true)
    }
}

tasks.register<Copy>("unpackWinJre") {
    dependsOn("downloadWinJre")
    from(zipTree("$buildDir/win64-jre.zip")) {
        include("jdk*/**")
        eachFile {
            relativePath = RelativePath(true, *relativePath.segments.drop(1).toTypedArray())
        }
        includeEmptyDirs = false
    }
    into(File(buildDir, "win64-jre"))
}

// javafx {
//     version = "11.0.2"
//     modules = [ 'javafx.web' ]
// }