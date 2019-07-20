FROM gradle:5.2.1-jdk8-alpine AS build-env
ADD --chown=gradle:gradle . /app
WORKDIR /app

RUN gradle assemble --info

FROM openjdk:8-jre
# 时区
RUN ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
  && echo Asia/Shanghai > /etc/timezone \
  && dpkg-reconfigure -f noninteractive tzdata

EXPOSE 9000

COPY --from=build-env /app/build/libs/reader-0.0.1-SNAPSHOT.jar /app/bin/qingmo.jar
CMD ["java", "-jar", "/app/bin/qingmo.jar"]

