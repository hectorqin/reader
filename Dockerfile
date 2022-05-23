FROM node:lts-alpine3.14 AS build-web
ADD . /app
WORKDIR /app/web
# Build web
RUN yarn && yarn build

# Build jar
FROM gradle:6.1.1-jdk8 AS build-env
ADD --chown=gradle:gradle . /app
WORKDIR /app
COPY --from=build-web /app/web/dist /app/src/main/resources/web
RUN \
    rm src/main/java/com/htmake/reader/ReaderUIApplication.kt; \
    gradle -b cli.gradle assemble --info; \
    mv ./build/libs/*.jar ./build/libs/reader.jar

FROM openjdk:8-jdk-alpine
# Install base packages
RUN \
    # apk update; \
    # apk upgrade; \
    # Add CA certs tini tzdata
    apk add --no-cache ca-certificates tini tzdata; \
    update-ca-certificates; \
    # Clean APK cache
    rm -rf /var/cache/apk/*;

# 时区
ENV TZ=Asia/Shanghai

#RUN ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
#  && echo Asia/Shanghai > /etc/timdezone \
#  && dpkg-reconfigure -f noninteractive tzdata

EXPOSE 8080
ENTRYPOINT ["/sbin/tini", "--"]
# COPY --from=hengyunabc/arthas:latest /opt/arthas /opt/arthas
COPY --from=build-env /app/build/libs/reader.jar /app/bin/reader.jar
CMD ["java", "-jar", "/app/bin/reader.jar" ]
