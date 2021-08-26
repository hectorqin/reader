FROM node:lts-alpine3.14 AS build-web
ADD . /app
WORKDIR /app/web
# Build web
RUN yarn && yarn build

# Build jar
FROM gradle:5.2.1-jdk8-alpine AS build-env
ADD --chown=gradle:gradle . /app
WORKDIR /app
COPY --from=build-web /app/web/dist /app/src/main/resources/web
RUN gradle assemble --info

FROM openjdk:8-jdk-alpine
# Install base packages
RUN apk update; \
    apk upgrade; \
    # Add CA certs
    apk add ca-certificates; \
    update-ca-certificates; \
    # Change TimeZone
    apk add --update tzdata; \
    # Add tini
    apk add --no-cache tini; \
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
COPY --from=build-env /app/build/libs/reader-1.0.0.jar /app/bin/reader.jar
CMD ["java", "-jar", "/app/bin/reader.jar" ]
