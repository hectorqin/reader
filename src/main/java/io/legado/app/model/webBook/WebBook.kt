package io.legado.app.model.webBook

import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import io.legado.app.data.entities.BookSource
import io.legado.app.data.entities.SearchBook
import io.legado.app.help.storage.OldRule
import io.legado.app.model.analyzeRule.AnalyzeUrl
import io.legado.app.model.webBook.BookChapterList
import io.legado.app.model.webBook.BookContent
import io.legado.app.model.webBook.BookInfo
import io.legado.app.model.webBook.BookList
import io.legado.app.model.Debug
import mu.KotlinLogging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private val logger = KotlinLogging.logger {}

class WebBook(val bookSource: BookSource, val debugLog: Boolean = true) {

    constructor(bookSourceString: String, debugLog: Boolean = true) : this(OldRule.jsonToBookSource(bookSourceString)!!, debugLog)

    val sourceUrl: String
        get() = bookSource.bookSourceUrl

    /**
     * 搜索
     */
    suspend fun searchBook(
        key: String,
        page: Int? = 1
    ): List<SearchBook> {
        val variableBook = SearchBook()
        return bookSource.searchUrl?.let { searchUrl ->
            val analyzeUrl = AnalyzeUrl(
                ruleUrl = searchUrl,
                key = key,
                page = page,
                baseUrl = sourceUrl,
                headerMapF = bookSource.getHeaderMap(),
                book = variableBook
            )
            val res = analyzeUrl.getStrResponse(bookSource.bookSourceUrl)
            BookList.analyzeBookList(
                res.body,
                bookSource,
                analyzeUrl,
                res.url,
                variableBook,
                true,
                debugLog = if(debugLog) Debug else null
            ).map {
                it.tocHtml = ""
                it.infoHtml = ""
                it
            }
        } ?: arrayListOf()

    }

    /**
     * 发现
     */
    suspend fun exploreBook(
        url: String,
        page: Int? = 1
    ): List<SearchBook> {
        val variableBook = SearchBook()
        val analyzeUrl = AnalyzeUrl(
            ruleUrl = url,
            page = page,
            baseUrl = sourceUrl,
            headerMapF = bookSource.getHeaderMap()
        )
        val res = analyzeUrl.getStrResponse(bookSource.bookSourceUrl)
        return BookList.analyzeBookList(
            res.body,
            bookSource,
            analyzeUrl,
            res.url,
            variableBook,
            false,
            debugLog = if(debugLog) Debug else null
        )
    }

    /**
     * 书籍信息
     */
    suspend fun getBookInfo(book: Book, canReName: Boolean = true): Book {
        book.type = bookSource.bookSourceType
        if (!book.infoHtml.isNullOrEmpty()) {
            BookInfo.analyzeBookInfo(
                book,
                book.infoHtml,
                bookSource,
                book.bookUrl,
                book.bookUrl,
                canReName
            )
            return book
        } else {
            return getBookInfo(book.bookUrl, canReName)
        }
    }

    /**
     * 书籍信息
     */
    suspend fun getBookInfo(bookUrl: String, canReName: Boolean = true): Book {
        val book = Book()
        book.bookUrl = bookUrl
        book.origin = bookSource.bookSourceUrl
        book.originName = bookSource.bookSourceName
        book.originOrder = bookSource.customOrder
        book.type = bookSource.bookSourceType
        val analyzeUrl = AnalyzeUrl(
            book = book,
            ruleUrl = book.bookUrl,
            baseUrl = sourceUrl,
            headerMapF = bookSource.getHeaderMap()
        )
        val res = analyzeUrl.getStrResponse(bookSource.bookSourceUrl)

        BookInfo.analyzeBookInfo(book, res.body, bookSource, book.bookUrl, res.url, canReName, debugLog = if(debugLog) Debug else null)
        book.tocHtml = null
        return book
    }

    /**
     * 目录
     */
    suspend fun getChapterList(
        book: Book
    ): List<BookChapter> {
        book.type = bookSource.bookSourceType
        return if (book.bookUrl == book.tocUrl && !book.tocHtml.isNullOrEmpty()) {
            BookChapterList.analyzeChapterList(
                book,
                book.tocHtml,
                bookSource,
                book.tocUrl,
                book.tocUrl
            )
        } else {
            val res = AnalyzeUrl(
                book = book,
                ruleUrl = book.tocUrl,
                baseUrl = book.bookUrl,
                headerMapF = bookSource.getHeaderMap()
            ).getStrResponse(bookSource.bookSourceUrl)
            return BookChapterList.analyzeChapterList(book, res.body, bookSource, book.tocUrl, res.url, debugLog = if(debugLog) Debug else null)
        }
    }

    /**
     * 章节内容
     */
    suspend fun getBookContent(
       book: Book,
       bookChapter: BookChapter,
        // bookChapterUrl:String,
        nextChapterUrl: String? = null
    ): String {
       if (bookSource.getContentRule().content.isNullOrEmpty()) {
            if(debugLog) Debug.log(sourceUrl, "⇒正文规则为空,使用章节链接: ${bookChapter.url}")
            return bookChapter.url
       }
//        val body = if (book != null && bookChapter.url == book.bookUrl && !book.tocHtml.isNullOrEmpty()) {
//            book.tocHtml
//        } else {
        logger.info("bookChapterUrl: {}", bookChapter.url, bookChapter.getAbsoluteURL())
        val res = AnalyzeUrl(
            ruleUrl = bookChapter.getAbsoluteURL(),
            baseUrl = book.tocUrl,
            headerMapF = bookSource.getHeaderMap(),
            book = book,
            chapter = bookChapter
        ).getStrResponse(
            bookSource.bookSourceUrl,
            jsStr = bookSource.getContentRule().webJs,
            sourceRegex = bookSource.getContentRule().sourceRegex
        )
        return BookContent.analyzeContent(
            res.body,
            book,
            bookChapter,
            bookSource,
            bookChapter.url,
            res.url,
            nextChapterUrl,
            debugLog = if(debugLog) Debug else null
        )
    }
}