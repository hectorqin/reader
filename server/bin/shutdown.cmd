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

if not exist "%JAVA_HOME%\bin\java.exe" (
    rem find java_home from reg
    for /f "tokens=2*" %%i in ('reg query "HKLM\SOFTWARE\JavaSoft\Java Runtime Environment" /s ^| findstr "JavaHome"') do (
        set "JAVA_HOME=%%j"
    )
)
if exist "%JAVA_HOME%\bin\java.exe" (
    set "JAVA=%JAVA_HOME%\bin\java.exe"
) else (
    echo Please set the JAVA_HOME variable in your environment, We need jdk8 or later!
    pause
    EXIT /B 1
)

setlocal

set "PATH=%JAVA_HOME%\bin;%PATH%"

echo killing reader server

for /f "tokens=1" %%i in ('jps -m ^| find "reader.server"') do ( taskkill /F /PID %%i )

echo Done!
