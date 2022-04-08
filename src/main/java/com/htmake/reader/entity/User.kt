package com.htmake.reader.entity

data class User(
        var username: String="",
        var password: String="",
        var salt: String="",
        var token: String="",
        var last_login_at: Long = System.currentTimeMillis(),
        var created_at: Long = System.currentTimeMillis(),
        var enable_webdav: Boolean = false,
        var token_map: Map<String, Long>? = null
)