@echo off
rem Copyright 1999-2018 Alibaba Group Holding Ltd.
rem Licensed under the Apache License, Version 2.0 (the "License");
rem you may not use this file except in compliance with the License.
rem You may obtain a copy of the License at
rem
rem      http://www.apache.org/licenses/LICENSE-2.0
rem
rem Unless required by applicable law or agreed to in writing, software
rem distributed under the License is distributed on an "AS IS" BASIS,
rem WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
rem See the License for the specific language governing permissions and
rem limitations under the License.
if not exist "%JAVA_HOME%\bin\java.exe" echo "请设置 JAVA_HOME 环境变量，需要jdk8及以上的java环境！" & EXIT /B 1
set "JAVA=%JAVA_HOME%\bin\java.exe"

setlocal enabledelayedexpansion

set BASE_DIR=%~dp0
rem added double quotation marks to avoid the issue caused by the folder names containing spaces.
rem removed the last 5 chars(which means \bin\) to get the base DIR.
set BASE_DIR="%BASE_DIR:~0,-5%"

set CUSTOM_SEARCH_LOCATIONS=file:%BASE_DIR%/conf/

set SERVER=reader

for /f "delims=" %%i in ('dir /b /o:-n %BASE_DIR%\target\reader*.jar') do set NEWEST_JAR=%%i

if not "%NEWEST_JAR%"=="" (
  set SERVER=%NEWEST_JAR:.jar=%
)

set SERVER %SERVER%
set MODE="single"
set INVITE_CODE="reader666"
set SECURE_KEY="readersk"
set MODE_INDEX=-1
set INVITE_CODE_INDEX=-1
set SERVER_INDEX=-1
set SECURE_KEY_INDEX=-1
set EMBEDDED_STORAGE=""


set i=0
for %%a in (%*) do (
    if "%%a" == "-m" ( set /a MODE_INDEX=!i!+1 )
    if "%%a" == "-i" ( set /a INVITE_CODE_INDEX=!i!+1 )
    if "%%a" == "-s" ( set /a SERVER_INDEX=!i!+1 )
    if "%%a" == "-k" ( set /a SECURE_KEY_INDEX=!i!+1 )
    set /a i+=1
)

set i=0
for %%a in (%*) do (
    if %MODE_INDEX% == !i! ( set MODE="%%a" )
    if %INVITE_CODE_INDEX% == !i! ( set INVITE_CODE="%%a" )
    if %SERVER_INDEX% == !i! (set SERVER="%%a")
    if %SECURE_KEY_INDEX% == !i! (set SECURE_KEY="%%a")
    set /a i+=1
)

rem if reader startup mode is single
if %MODE% == "single" (
    echo "Reader 将以单用户模式运行"
    set "READER_JVM_OPTS=-Xms256m -Xmx256m -Xmn128m"
)

rem if reader startup mode is multi-user
if not %MODE% == "single" (
    echo "Reader 将以多用户模式运行。邀请码：%INVITE_CODE%，管理员密码：%SECURE_KEY%"
    set "READER_OPTS=-Dreader.app.secure=true -Dreader.app.inviteCode=%INVITE_CODE% -Dreader.app.secureKey=%SECURE_KEY%"

    set "READER_JVM_OPTS=-server -Xms1g -Xmx1g -Xmn512m -XX:MetaspaceSize=64m -XX:MaxMetaspaceSize=160m -XX:-OmitStackTraceInFastThrow -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=%BASE_DIR%\logs\java_heapdump.hprof -XX:-UseLargePages"
)

rem set reader options
@REM set "READER_OPTS=%READER_OPTS% -Dloader.path=%BASE_DIR%/plugins,%BASE_DIR%/plugins/health,%BASE_DIR%/plugins/cmdb,%BASE_DIR%/plugins/selector"
set "READER_OPTS=%READER_OPTS% -Dreader.app.workDir=%BASE_DIR%"
set "READER_OPTS=%READER_OPTS% -jar %BASE_DIR%\target\%SERVER%.jar"

rem set reader spring config location
set "READER_CONFIG_OPTS=--spring.config.additional-location=%CUSTOM_SEARCH_LOCATIONS%"

rem set reader log4j file location
@REM set "READER_LOG4J_OPTS=--logging.config=%BASE_DIR%/conf/reader-logback.xml"


set COMMAND="%JAVA%" %READER_JVM_OPTS% %READER_OPTS% %READER_CONFIG_OPTS% %READER_LOG4J_OPTS% reader.server %*

echo %COMMAND%

echo "Reader 正在启动中，你可以在 %BASE_DIR%\logs\start.out 查看日志"

rem start reader command
%COMMAND%
