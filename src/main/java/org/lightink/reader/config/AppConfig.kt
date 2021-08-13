package org.lightink.reader.config

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.stereotype.Component

@Component
@ConfigurationProperties(prefix = "qingmo.app")
class AppConfig {
    lateinit var storagePath: String // 存储路径
}