package org.lightink.reader.config

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.stereotype.Component

@Component
@ConfigurationProperties(prefix = "reader.mysql")
class MysqlConfig {

    var port: Int = 0
    lateinit var host: String
    lateinit var database: String
    lateinit var user: String
    lateinit var password: String
    override fun toString(): String {
        return "MysqlConfig(port=$port, host='$host', database='$database', user='$user', password='$password')"
    }


}