package io.legado.app.model

import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import io.legado.app.model.webBook.WebBook
import io.legado.app.utils.isAbsUrl
import io.legado.app.utils.HtmlFormatter
import mu.KotlinLogging
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.Date

private val logger = KotlinLogging.logger {}

class Debugger(val logMsg: (String) -> Unit) : DebugLog {
    private val debugTimeFormat = SimpleDateFormat("[mm:ss.SSS]", Locale.getDefault())
    private var startTime: Long = System.currentTimeMillis()

    fun log(
        sourceUrl: String?,
        msg: String?
    ) {
        log(sourceUrl, msg, false)
    }

    override fun log(message: String) {
        val time = debugTimeFormat.format(Date(System.currentTimeMillis() - startTime))
        logMsg("$time $message")
    }

    override fun log(
        sourceUrl: String?,
        msg: String?,
        isHtml: Boolean
    ) {
        if (sourceUrl == null || msg == null) return
        logger.info("sourceUrl: {}, msg: {}", sourceUrl, msg)
        var printMsg = msg

        if (isHtml) {
            printMsg = HtmlFormatter.format(msg)
        }
        val time = debugTimeFormat.format(Date(System.currentTimeMillis() - startTime))
        printMsg = "$time $printMsg"
        logMsg(printMsg)
    }

    suspend fun startDebug(webBook: WebBook, key: String) {
        val bookSource = webBook.bookSource
        webBook.debugLogger = this@Debugger
        when {
            key.isAbsUrl() -> {
                val book = Book()
                book.origin = bookSource.bookSourceUrl
                book.bookUrl = key
                log(bookSource.bookSourceUrl, "⇒开始访问详情页:$key")
                infoDebug(webBook, book)
            }
            key.contains("::") -> {
                val url = key.substringAfter("::")
                log(bookSource.bookSourceUrl, "⇒开始访问发现页:$url")
                exploreDebug(webBook, url)
            }
            key.startsWith("++") -> {
                val url = key.substring(2)
                val book = Book()
                book.origin = bookSource.bookSourceUrl
                book.tocUrl = url
                log(bookSource.bookSourceUrl, "⇒开始访目录页:$url")
                tocDebug(webBook, book)
            }
            key.startsWith("--") -> {
                val url = key.substring(2)
                val book = Book()
                book.origin = bookSource.bookSourceUrl
                log(bookSource.bookSourceUrl, "⇒开始访正文页:$url")
                val chapter = BookChapter()
                chapter.title = "调试"
                chapter.url = url
                contentDebug(webBook, book, chapter, null)
            }
            else -> {
                log(bookSource.bookSourceUrl, "⇒开始搜索关键字:$key")
                searchDebug(webBook, key)
            }
        }
    }

    private suspend fun exploreDebug(webBook: WebBook, url: String) {
        webBook.debugLogger = this@Debugger
        log("︾开始解析发现页")
        runCatching {
            webBook.exploreBook(url, 1)
        }.onSuccess { exploreBooks ->
            exploreBooks.let {
                if (exploreBooks.isNotEmpty()) {
                    log(webBook.sourceUrl, "︽发现页解析完成")
                    infoDebug(webBook, exploreBooks[0].toBook())
                } else {
                    log(webBook.sourceUrl, "︽未获取到书籍")
                }
            }
        }.onFailure {
            log(webBook.sourceUrl, "Error: " + it.localizedMessage)
            throw it
        }
   }

    private suspend fun searchDebug(webBook: WebBook, key: String) {
        webBook.debugLogger = this@Debugger
        log(msg = "︾开始解析搜索页")
        runCatching {
            webBook.searchBook(key, 1)
        }.onSuccess { searchBooks ->
            searchBooks.let {
                if (searchBooks.isNotEmpty()) {
                    log(webBook.sourceUrl, "︽搜索页解析完成")
                    infoDebug(webBook, searchBooks[0].toBook())
                } else {
                    log(webBook.sourceUrl, "︽未获取到书籍")
                }
            }
        }.onFailure {
            log(webBook.sourceUrl, "Error: " + it.localizedMessage)
            throw it
        }
    }

    private suspend fun infoDebug(webBook: WebBook, book: Book) {
        webBook.debugLogger = this@Debugger
        log(msg = "︾开始解析详情页")
        runCatching { webBook.getBookInfo(book.bookUrl) }
                .onSuccess {
                    log(webBook.sourceUrl, "︽详情页解析完成")
                    tocDebug(webBook, it)
                }
                .onFailure {
                    log(webBook.sourceUrl, "Error: " + it.localizedMessage)
                    throw it
                }
    }

    private suspend fun tocDebug(webBook: WebBook, book: Book) {
        webBook.debugLogger = this@Debugger
        log(msg = "︾开始解析目录页")
        runCatching {
            webBook.getChapterList(book)
        }
                .onSuccess { chapterList ->
                    chapterList?.let {
                        if (it.isNotEmpty()) {
                            log(webBook.sourceUrl, "︽目录页解析完成")
                            val nextChapterUrl = if (it.size > 1) it[1].url else null
                            contentDebug(webBook, book, it[0], nextChapterUrl)
                        } else {
                            log(webBook.sourceUrl, "︽目录列表为空")
                        }
                    }
                }
                .onFailure {
                    log(webBook.sourceUrl, "Error: " + it.localizedMessage)
                    throw it
                }
    }

    private suspend fun contentDebug(
            webBook: WebBook,
            book: Book,
            bookChapter: BookChapter,
            nextChapterUrl: String?
    ) {
        webBook.debugLogger = this@Debugger
        log(webBook.sourceUrl, "︾开始解析正文页")
        runCatching { webBook.getBookContent(book, bookChapter, nextChapterUrl) }
                .onSuccess {
                    log(webBook.sourceUrl, "︽正文页解析完成")
                }
                .onFailure {
                    log(webBook.sourceUrl, "Error: " + it.localizedMessage)
                }
    }
}