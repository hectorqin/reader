package org.lightink.reader.entity

data class User(
        var username: String,
        var password: String,
        var salt: String,
        var token: String="",
        var last_login_at: Long = System.currentTimeMillis(),
        var created_at: Long = System.currentTimeMillis(),
        var enableWebdav: Boolean = true
)