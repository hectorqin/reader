package com.htmake.reader.entity

data class User(
        var username: String="",
        var password: String="",
        var salt: String="",
        var token: String="",
        var last_login_at: Long = System.currentTimeMillis(),
        var created_at: Long = System.currentTimeMillis(),
        var enable_webdav: Boolean = false, // 是否开启 WebDAV 功能
        var token_map: Map<String, Long>? = null,
        var enable_local_store: Boolean = false // 是否开启本地书仓功能
)