FROM gradle:5.2.1-jdk8-alpine AS build-env
ADD --chown=gradle:gradle . /app
WORKDIR /app

RUN gradle assemble --info

FROM openjdk:8-jdk-alpine
# Install base packages
RUN apk update
RUN apk upgrade
RUN apk add ca-certificates && update-ca-certificates
# Change TimeZone
RUN apk add --update tzdata
# 时区
ENV TZ=Asia/Shanghai
# Clean APK cache
RUN rm -rf /var/cache/apk/*

#RUN ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
#  && echo Asia/Shanghai > /etc/timdezone \
#  && dpkg-reconfigure -f noninteractive tzdata

EXPOSE 9000
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]
COPY --from=hengyunabc/arthas:latest /opt/arthas /opt/arthas
COPY --from=build-env /app/build/libs/reader-0.0.1-SNAPSHOT.jar /app/bin/qingmo.jar
CMD ["java", "-jar", "/app/bin/qingmo.jar" ]

