package io.legado.app.model

import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import mu.KotlinLogging

private val logger = KotlinLogging.logger {}

interface DebugLog {

    fun log(sourceUrl: String? = "", msg: String? = "") {
        logger.info("sourceUrl: {}, msg: {}", sourceUrl, msg)
    }
}