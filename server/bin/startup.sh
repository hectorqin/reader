#!/bin/bash

# Copyright 1999-2018 Alibaba Group Holding Ltd.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at

#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

cygwin=false
darwin=false
os400=false
case "`uname`" in
CYGWIN*) cygwin=true;;
Darwin*) darwin=true;;
OS400*) os400=true;;
esac
error_exit ()
{
    echo "ERROR: $1 !!"
    exit 1
}
[ ! -e "$JAVA_HOME/bin/java" ] && JAVA_HOME=$HOME/jdk/java
[ ! -e "$JAVA_HOME/bin/java" ] && JAVA_HOME=/usr/java
[ ! -e "$JAVA_HOME/bin/java" ] && JAVA_HOME=/opt/taobao/java
[ ! -e "$JAVA_HOME/bin/java" ] && unset JAVA_HOME

if [ -z "$JAVA_HOME" ]; then
  if $darwin; then

    if [ -x '/usr/libexec/java_home' ] ; then
      export JAVA_HOME=`/usr/libexec/java_home`

    elif [ -d "/System/Library/Frameworks/JavaVM.framework/Versions/CurrentJDK/Home" ]; then
      export JAVA_HOME="/System/Library/Frameworks/JavaVM.framework/Versions/CurrentJDK/Home"
    fi
  else
    JAVA_PATH=`dirname $(readlink -f $(which javac))`
    if [ "x$JAVA_PATH" != "x" ]; then
      export JAVA_HOME=`dirname $JAVA_PATH 2>/dev/null`
    fi
  fi
  if [ -z "$JAVA_HOME" ]; then
        error_exit "请设置 JAVA_HOME 环境变量，需要jdk8及以上的java环境！"
  fi
fi

export BASE_DIR=`cd $(dirname $0)/..; pwd`

SERVER="reader"
NEWEST_JAR=$(ls $BASE_DIR/target | grep -EO 'reader.*\.jar' | sort -nr | head -1)
if [ -n "$NEWEST_JAR" ]; then
  SERVER=${NEWEST_JAR/.jar/}
fi

MODE=""
INVITE_CODE=""
SECURE_KEY=""
while getopts ":m:s:i:k:" opt
do
    case $opt in
        m)
            MODE=$OPTARG;;
        s)
            SERVER=$OPTARG;;
        i)
            INVITE_CODE=$OPTARG;;
        k)
            SECURE_KEY=$OPTARG;;
        ?)
        echo "未知的参数: $opt"
        exit 1;;
    esac
done

export JAVA_HOME
export JAVA="$JAVA_HOME/bin/java"
export CUSTOM_SEARCH_LOCATIONS=file:${BASE_DIR}/conf/

#===========================================================================================
# JVM Configuration
#===========================================================================================
if [[ "${MODE}" == "" ]]; then
    echo "Reader 的运行模式以配置文件 conf/application.properties 为准。注意，当前未限制jvm内存"
elif [[ "${MODE}" == "single" ]]; then
    JAVA_OPT="${JAVA_OPT} -Xms256m -Xmx256m -Xmn128m"
    JAVA_OPT="${JAVA_OPT} -Dreader.app.secure=false"
    echo "Reader 将以单用户模式运行。注意，当前内存限制为256m"
else
    JAVA_OPT="${JAVA_OPT} -server -Xms1g -Xmx1g -Xmn512m -XX:MetaspaceSize=64m -XX:MaxMetaspaceSize=160m"
    JAVA_OPT="${JAVA_OPT} -XX:-OmitStackTraceInFastThrow -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=${BASE_DIR}/logs/java_heapdump.hprof"
    JAVA_OPT="${JAVA_OPT} -XX:-UseLargePages"
    JAVA_OPT="${JAVA_OPT} -Dreader.app.secure=true"

    TIPS=""
    if [[ "${INVITE_CODE}" != "" ]]; then
      JAVA_OPT="${JAVA_OPT} -Dreader.app.inviteCode=${INVITE_CODE}"
      TIPS="${TIPS} 邀请码：${INVITE_CODE}"
    fi

    if [[ "${SECURE_KEY}" != "" ]]; then
      JAVA_OPT="${JAVA_OPT} -Dreader.app.secureKey=${SECURE_KEY}"
      TIPS="${TIPS} 管理员密码：${SECURE_KEY}"
    fi

    if [[ "${TIPS}" == "" ]]; then
      TIPS="邀请码和管理员密码以配置文件 conf/application.properties 为准"
    fi
    TIPS="${TIPS}。注意，当前内存限制为1g"
    echo "Reader 将以多用户模式运行。${TIPS}"
fi

JAVA_MAJOR_VERSION=$($JAVA -version 2>&1 | sed -E -n 's/.* version "([0-9]*).*$/\1/p')
if [[ "$JAVA_MAJOR_VERSION" -ge "9" ]] ; then
  JAVA_OPT="${JAVA_OPT} -Xlog:gc*:file=${BASE_DIR}/logs/reader_gc.log:time,tags:filecount=10,filesize=100m"
else
  JAVA_OPT_EXT_FIX="-Djava.ext.dirs=${JAVA_HOME}/jre/lib/ext:${JAVA_HOME}/lib/ext"
  JAVA_OPT="${JAVA_OPT} -Xloggc:${BASE_DIR}/logs/reader_gc.log -verbose:gc -XX:+PrintGCDetails -XX:+PrintGCDateStamps -XX:+PrintGCTimeStamps -XX:+UseGCLogFileRotation -XX:NumberOfGCLogFiles=10 -XX:GCLogFileSize=100M"
fi

# JAVA_OPT="${JAVA_OPT} -Dloader.path=${BASE_DIR}/plugins,${BASE_DIR}/plugins/health,${BASE_DIR}/plugins/cmdb,${BASE_DIR}/plugins/selector"
JAVA_OPT="${JAVA_OPT} -Dfile.encoding=UTF-8 -Dsun.jnu.encoding=UTF-8 -Dreader.app.workDir=${BASE_DIR}"
JAVA_OPT="${JAVA_OPT} -jar ${BASE_DIR}/target/${SERVER}.jar"
JAVA_OPT="${JAVA_OPT} ${JAVA_OPT_EXT}"
JAVA_OPT="${JAVA_OPT} --spring.config.additional-location=${CUSTOM_SEARCH_LOCATIONS}"
# JAVA_OPT="${JAVA_OPT} --logging.config=${BASE_DIR}/conf/nacos-logback.xml"
JAVA_OPT="${JAVA_OPT} --server.max-http-header-size=524288"

if [ ! -d "${BASE_DIR}/logs" ]; then
  mkdir ${BASE_DIR}/logs
fi

echo "启动命令："
echo "$JAVA $JAVA_OPT_EXT_FIX ${JAVA_OPT}"
echo

# check the start.out log output file
if [ ! -f "${BASE_DIR}/logs/start.out" ]; then
  touch "${BASE_DIR}/logs/start.out"
else
  mv ${BASE_DIR}/logs/start.out ${BASE_DIR}/logs/start-$(date +'%Y-%m-%d_%H_%M').out
fi
# start
echo "$JAVA $JAVA_OPT_EXT_FIX ${JAVA_OPT}" > ${BASE_DIR}/logs/start.out 2>&1 &

if [[ "$JAVA_OPT_EXT_FIX" == "" ]]; then
  nohup "$JAVA" ${JAVA_OPT} reader.server >> ${BASE_DIR}/logs/start.out 2>&1 &
else
  nohup "$JAVA" "$JAVA_OPT_EXT_FIX" ${JAVA_OPT} reader.server >> ${BASE_DIR}/logs/start.out 2>&1 &
fi

echo "Reader 正在启动中，你可以在 ${BASE_DIR}/logs/start.out 查看日志"
