package org.lightink.reader.entity

data class BasicError(
        val error: String,
        val exception: Throwable,
        val message: String,
        val path: String,
        val status: Int,
        val timestamp: Long
)