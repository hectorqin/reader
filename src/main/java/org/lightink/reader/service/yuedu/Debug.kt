package io.legado.app.model

import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
//import io.legado.app.data.entities.RssArticle
//import io.legado.app.data.entities.RssSource
import io.legado.app.help.coroutine.CompositeCoroutine
import io.legado.app.utils.htmlFormat
import io.legado.app.utils.isAbsUrl
import io.vertx.kotlin.ext.consul.blockingQueryOptionsOf
import mu.KotlinLogging
import java.text.SimpleDateFormat
import java.util.*

private val logger = KotlinLogging.logger {}

object Debug {

    private val DEBUG_TIME_FORMAT = SimpleDateFormat("[mm:ss.SSS]", Locale.getDefault())
    private var startTime: Long = System.currentTimeMillis()

    @Synchronized
    fun log(
            sourceUrl: String? = "",
            msg: String? = "",
            isHtml: Boolean = false,
            showTime: Boolean = true,
            state: Int = 1
    ) {
//        if (debugSource != sourceUrl || callback == null || !print) return
        var printMsg = msg ?: ""
        if (isHtml) {
            printMsg = printMsg.htmlFormat()
        }
        if (showTime) {
            printMsg =
                    "${DEBUG_TIME_FORMAT.format(Date(System.currentTimeMillis() - startTime))} $printMsg"
        }
        logger.info("sourceUrl: {}, state: {}, msg: {}", sourceUrl, state, printMsg)

    }

    suspend fun startDebug(webBook: WebBook, key: String) {
        startTime = System.currentTimeMillis()
//        when {
//            key.isAbsUrl() -> {
//                val book = Book()
//                book.origin = webBook.sourceUrl
//                book.bookUrl = key
//                log(webBook.sourceUrl, "⇒开始访问详情页:$key")
//                infoDebug(webBook, book)
//            }
//            key.contains("::") -> {
//                val url = key.substring(key.indexOf("::") + 2)
//                log(webBook.sourceUrl, "⇒开始访问发现页:$url")
//                exploreDebug(webBook, url)
//            }
//            else -> {
        log("⇒开始搜索关键字:$key")
        searchDebug(webBook, key)
//            }
//        }
    }

//    private suspend fun exploreDebug(webBook: WebBook, url: String) {
//        log("︾开始解析发现页")
//        val explore = webBook.exploreBook(url, 1)
//                .onSuccess { exploreBooks ->
//                    exploreBooks?.let {
//                        if (exploreBooks.isNotEmpty()) {
//                            log("︽发现页解析完成")
//                            log(showTime = false)
//                            infoDebug(webBook, exploreBooks[0].toBook())
//                        } else {
//                            log("︽未获取到书籍", state = -1)
//                        }
//                    }
//                }
//                .onError {
//                    log(
//                            debugSource,
//                            it.localizedMessage,
//                            state = -1
//                    )
//                }
//
//        tasks.add(explore)
//    }

    private suspend fun searchDebug(webBook: WebBook, key: String) {
        log("︾开始解析搜索页")
        runCatching {
            webBook.searchBook(key, 1)
        }.onSuccess { searchBooks ->
            searchBooks.let {
                if (searchBooks.isNotEmpty()) {
                    log(webBook.sourceUrl, "︽搜索页解析完成")
                    log(showTime = false)
                    infoDebug(webBook, searchBooks[0].toBook())
                } else {
                    log(webBook.sourceUrl, "︽未获取到书籍", state = -1)
                }
            }
        }.onFailure {
            log(webBook.sourceUrl, it.localizedMessage, state = -1)
            throw it
        }
    }

    private suspend fun infoDebug(webBook: WebBook, book: Book) {
        log("︾开始解析详情页")
        runCatching { webBook.getBookInfo(book) }
                .onSuccess {
                    log(webBook.sourceUrl, "︽详情页解析完成")
                    log(showTime = false)
                    tocDebug(webBook, book)
                }
                .onFailure {
                    log(webBook.sourceUrl, it.localizedMessage, state = -1)
                    throw it
                }
    }

    private suspend fun tocDebug(webBook: WebBook, book: Book) {
        log("︾开始解析目录页")
        runCatching { webBook.getChapterList(book) }
                .onSuccess { chapterList ->
                    chapterList?.let {
                        if (it.isNotEmpty()) {
                            log(webBook.sourceUrl, "︽目录页解析完成")
                            log(showTime = false)
                            val nextChapterUrl = if (it.size > 1) it[1].url else null
                            contentDebug(webBook, book, it[0], nextChapterUrl)
                        } else {
                            log(webBook.sourceUrl, "︽目录列表为空", state = -1)
                        }
                    }
                }
                .onFailure {
                    log(webBook.sourceUrl, it.localizedMessage, state = -1)
                    throw it
                }
    }

    private suspend fun contentDebug(
            webBook: WebBook,
            book: Book,
            bookChapter: BookChapter,
            nextChapterUrl: String?
    ) {
        log(webBook.sourceUrl, "︾开始解析正文页")
        runCatching { webBook.getContent(book, bookChapter, nextChapterUrl) }
                .onSuccess {
                    log(webBook.sourceUrl, "︽正文页解析完成", state = 1000)
                }
                .onFailure {
                    log(webBook.sourceUrl, it.localizedMessage, state = -1)
                }
    }
}