#!/bin/bash

# export JAVA_HOME=/Library/Java/JavaVirtualMachines/openjdk-11.jdk/Contents/Home

mv src/main/java/org/lightink/reader/ReaderUIApplication.kt src/main/java/org/lightink/reader/ReaderUIApplication.kt.back
./gradlew -b cli.gradle $@
mv src/main/java/org/lightink/reader/ReaderUIApplication.kt.back src/main/java/org/lightink/reader/ReaderUIApplication.kt
