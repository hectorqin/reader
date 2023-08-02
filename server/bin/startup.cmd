@echo off
REM Copyright 1999-2018 Alibaba Group Holding Ltd.
REM Licensed under the Apache License, Version 2.0 (the "License");
REM you may not use this file except in compliance with the License.
REM You may obtain a copy of the License at
REM
REM      http://www.apache.org/licenses/LICENSE-2.0
REM
REM Unless required by applicable law or agreed to in writing, software
REM distributed under the License is distributed on an "AS IS" BASIS,
REM WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
REM See the License for the specific language governing permissions and
REM limitations under the License.

if not exist "%JAVA_HOME%\bin\java.exe" (
    rem find java_home from reg
    for /f "tokens=2*" %%i in ('reg query "HKLM\SOFTWARE\JavaSoft\Java Runtime Environment" /s ^| findstr "JavaHome"') do (
        set "JAVA_HOME=%%j"
    )
)
if exist "%JAVA_HOME%\bin\java.exe" (
    set "JAVA=%JAVA_HOME%\bin\java.exe"
) else (
    rem check java command
    for /f "usebackq delims=" %%i in (`where java`) do (
        set JAVA=%%i
    )

    if not "%JAVA%" == "" if exist "%JAVA%"  (
        rem java path is exist
    ) else (
        echo Please set the JAVA_HOME variable in your environment, We need jdk8 or later!
        pause
        EXIT /B 1
    )
)

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

set MODE=""
set INVITE_CODE=""
set SECURE_KEY=""
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
if %MODE% == "" (
    echo The running mode of the Reader is determined by the configuration file conf/application.properties. Please note that there is currently no memory limit set for the JVM.
)

if %MODE% == "single" (
    echo The running mode of the Reader is determined by the configuration file conf/application.properties. Please note that the current memory limit is set to 256m.
    set "READER_JVM_OPTS=-Xms256m -Xmx256m -Xmn128m"
)

rem if reader startup mode is multi-user
if not %MODE% == "" if not %MODE% == "single" (
    set READER_TIPS=""
    set "READER_OPTS=-Dreader.app.secure=true"
    if not "%INVITE_CODE%" == "" {
        set "READER_OPTS=%READER_OPTS%  -Dreader.app.inviteCode=%INVITE_CODE%"
        set "READER_TIPS=%READER_TIPS% inviteCode: %INVITE_CODE%"
    }
    if not "%SECURE_KEY%" == "" {
        set "READER_OPTS=%READER_OPTS%  -Dreader.app.secureKey=%SECURE_KEY%"
        set "READER_TIPS=%READER_TIPS% secureKey: %SECURE_KEY%"
    }
    if "%READER_TIPS%" == "" {
        set "READER_TIPS=The invitation code and administrator password are determined by the configuration file conf\application.properties."
    }
    set "READER_TIPS=%READER_TIPS%. Please note that the current memory limit is set to 1g."

    echo The Reader will running in multi-user mode. %READER_TIPS%

    set "READER_JVM_OPTS=-server -Xms1g -Xmx1g -Xmn512m -XX:MetaspaceSize=64m -XX:MaxMetaspaceSize=160m -XX:-OmitStackTraceInFastThrow -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=%BASE_DIR%\logs\java_heapdump.hprof -XX:-UseLargePages"
)

rem set reader options
@REM set "READER_OPTS=%READER_OPTS% -Dloader.path=%BASE_DIR%/plugins,%BASE_DIR%/plugins/health,%BASE_DIR%/plugins/cmdb,%BASE_DIR%/plugins/selector"
set "READER_OPTS=%READER_OPTS% -Dfile.encoding=UTF-8 -Dsun.jnu.encoding=UTF-8 -Dspring.profiles.active=prod -Dreader.app.workDir=%BASE_DIR%"
set "READER_OPTS=%READER_OPTS% -jar %BASE_DIR%\target\%SERVER%.jar"

rem set reader spring config location
set "READER_CONFIG_OPTS=--spring.config.additional-location=%CUSTOM_SEARCH_LOCATIONS%"

rem set reader log4j file location
@REM set "READER_LOG4J_OPTS=--logging.config=%BASE_DIR%/conf/reader-logback.xml"


set COMMAND="%JAVA%" %READER_JVM_OPTS% %READER_OPTS% %READER_CONFIG_OPTS% %READER_LOG4J_OPTS% reader.server %*

echo Run command:
echo %COMMAND%
echo

echo Reader is starting, you can check the %BASE_DIR%\logs

rem start reader command
%COMMAND%
