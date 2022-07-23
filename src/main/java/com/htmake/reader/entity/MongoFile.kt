package com.htmake.reader.entity

data class MongoFile(
    var path: String = "",
    var content: String = "",
    var created_at: Long = System.currentTimeMillis(),
    var updated_at: Long = System.currentTimeMillis()
)