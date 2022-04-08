package com.htmake.reader.entity

data class BasicError(
        val error: String,
        val exception: String,
        val message: String,
        val path: String,
        val status: Int,
        val timestamp: Long
)