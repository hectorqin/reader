package io.legado.app.model

import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import mu.KotlinLogging
import okhttp3.logging.HttpLoggingInterceptor

private val logger = KotlinLogging.logger {}

interface DebugLog: HttpLoggingInterceptor.Logger {
    fun log(
        sourceUrl: String? = "",
        msg: String? = "",
        isHtml: Boolean = false
    ) {
        logger.info("sourceUrl: {}, msg: {}", sourceUrl, msg)
    }

    override fun log(message: String) {
        logger.debug(message)
    }
}