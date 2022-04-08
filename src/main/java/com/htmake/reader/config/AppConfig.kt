package com.htmake.reader.config

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.stereotype.Component

@Component
@ConfigurationProperties(prefix = "reader.app")
class AppConfig {
    lateinit var storagePath: String // 存储路径
    var showUI = false // 是否显示UI
    var debug = false  // 是否调试web
    var packaged = false  // 是否打包为app
    var secure = false    // 是否启用登录鉴权
    var inviteCode = ""   // 注册邀请码
    var secureKey = ""    // 管理密码
}