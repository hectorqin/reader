FROM hectorqin/reader

# 时区
ENV TZ=Asia/Shanghai

EXPOSE 8080
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["java", "-jar", "/app/bin/reader.jar" ]
