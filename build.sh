#!/bin/bash

oldJAVAHome=$JAVA_HOME

if [ -d /Library/Java/JavaVirtualMachines/openjdk-11.jdk/Contents/Home ]; then
    export JAVA_HOME=/Library/Java/JavaVirtualMachines/openjdk-11.jdk/Contents/Home
fi

javaVersion=$(java -version 2>&1 | sed -n ';s/.* version "\(.*\)\.\(.*\)\..*".*/\1\2/p;')

if [[ "$javaVersion" -lt "110" ]]; then
    echo "Java version must not lower than 11.0"
    exit 1
fi

task=$1

version=""

getVersion()
{
    version=$(grep -Eo "^version = .*" $1 | grep -Eo "['\"].*['\"]" | tr -d "'\"")
}

getVersion ./build.gradle.kts

case $task in
    build)
        # 调试打包
        ./gradlew buildReader
    ;;
    run)
        # 运行 javafx UI
        port=$2
        if [[ -z "$port" ]]; then
            port=8080
        fi
        ./gradlew assemble --info
        if test $? -eq 0; then
            shift
            shift
            java -jar build/libs/reader-$version.jar --reader.app.showUI=true --reader.server.port=$port $@
        fi
    ;;
    win)
        # 打包 windows 安装包
        JAVAFX_PLATFORM=win ./gradlew packageReaderWin
    ;;
    linux)
        # 打包 linux 安装包
        JAVAFX_PLATFORM=linux ./gradlew packageReaderLinux
    ;;
    mac)
        # 打包 mac 安装包
        JAVAFX_PLATFORM=mac ./gradlew packageReaderMac
    ;;
    serve)
        # 服务端一键运行
        port=$2
        if [[ -z "$port" ]]; then
            port=8080
        fi
        mv src/main/java/com/htmake/reader/ReaderUIApplication.kt src/main/java/com/htmake/reader/ReaderUIApplication.kt.back
        getVersion ./cli.gradle
        ./gradlew -b cli.gradle assemble --info
        if test $? -eq 0; then
            mv src/main/java/com/htmake/reader/ReaderUIApplication.kt.back src/main/java/com/htmake/reader/ReaderUIApplication.kt
            java -jar build/libs/reader-$version.jar --reader.server.port=$port
        else
            mv src/main/java/com/htmake/reader/ReaderUIApplication.kt.back src/main/java/com/htmake/reader/ReaderUIApplication.kt
        fi
    ;;
    cli)
        # 服务端打包命令
        shift
        export JAVA_HOME=$oldJAVAHome
        mv src/main/java/com/htmake/reader/ReaderUIApplication.kt src/main/java/com/htmake/reader/ReaderUIApplication.kt.back
        getVersion ./cli.gradle
        ./gradlew -b cli.gradle $@
        mv src/main/java/com/htmake/reader/ReaderUIApplication.kt.back src/main/java/com/htmake/reader/ReaderUIApplication.kt
    ;;
    yarn)
        # yarn 快捷命令，默认 install
        shift
        cd web
        yarn $@
    ;;
    web)
        # 开发web页面
        cd web
        yarn serve
    ;;
    sync)
        # 编译同步web资源
        cd web
        yarn sync
    ;;
    *)
        echo "
USAGE: ./build.sh build|run|win|linux|mac|serve|cli|yarn|web|sync

build   调试打包
run     桌面端编译运行，需要先执行 sync 命令编译同步web资源
win     打包 windows 安装包
linux   打包 linux 安装包
mac     打包 mac 安装包
serve   服务端编译运行
cli     服务端打包命令
yarn    web页面 yarn 快捷命令，默认 install
web     开发web页面
sync    编译同步web资源
"
    ;;
esac

export JAVA_HOME=$oldJAVAHome
