package io.legado.app.model

import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import io.legado.app.data.entities.BookSource
import io.legado.app.data.entities.SearchBook
import io.legado.app.help.storage.OldRule
import io.legado.app.model.analyzeRule.AnalyzeUrl
import io.legado.app.model.webbook.BookChapterList
import io.legado.app.model.webbook.BookContent
import io.legado.app.model.webbook.BookInfo
import io.legado.app.model.webbook.BookList
import mu.KotlinLogging

private val logger = KotlinLogging.logger {}

class WebBook(val bookSource: BookSource) {

    constructor(bookSourceString: String) : this(OldRule.jsonToBookSource(bookSourceString)!!)

    val sourceUrl: String
        get() = bookSource.bookSourceUrl

    /**
     * 搜索
     */
    suspend fun searchBook(
        key: String,
        page: Int? = 1
    ): List<SearchBook> {
        return bookSource.searchUrl?.let { searchUrl ->
            val analyzeUrl = AnalyzeUrl(
                ruleUrl = searchUrl,
                key = key,
                page = page,
                baseUrl = sourceUrl,
                headerMapF = bookSource.getHeaderMap()
            )
            val res = analyzeUrl.getResponseAwait()
            BookList.analyzeBookList(
                res.body,
                bookSource,
                analyzeUrl,
                res.url,
                true
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
        val analyzeUrl = AnalyzeUrl(
            ruleUrl = url,
            page = page,
            baseUrl = sourceUrl,
            headerMapF = bookSource.getHeaderMap()
        )
        val res = analyzeUrl.getResponseAwait()
        return BookList.analyzeBookList(
            res.body,
            bookSource,
            analyzeUrl,
            res.url,
            false
        )

    }

    /**
     * 书籍信息
     */
    suspend fun getBookInfo(bookUrl: String): Book {
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
        val body = analyzeUrl.getResponseAwait().body

        BookInfo.analyzeBookInfo(book, body, bookSource, book.bookUrl)
        book.tocHtml = null
        return book
    }

    /**
     * 目录
     */
    suspend fun getChapterList(
        book: Book
    ): List<BookChapter> {
        val body = if (book.bookUrl == book.tocUrl && !book.tocHtml.isNullOrEmpty()) {
            book.tocHtml
        } else {
            AnalyzeUrl(
                book = book,
                ruleUrl = book.tocUrl,
//                baseUrl = book.bookUrl,
                headerMapF = bookSource.getHeaderMap()
            ).getResponseAwait().body
        }
        return BookChapterList.analyzeChapterList(book, body, bookSource, book.tocUrl)

    }

    /**
     * 章节内容
     */
    suspend fun getBookContent(
//        book: Book?,
//        bookChapter: BookChapter,
        bookChapterUrl:String,
        nextChapterUrl: String? = null
    ): String {
//        if (bookSource.getContentRule().content.isNullOrEmpty()) {
//            return bookChapter.url
//        }
//        val body = if (book != null && bookChapter.url == book.bookUrl && !book.tocHtml.isNullOrEmpty()) {
//            book.tocHtml
//        } else {
        val book = Book()
        val bookChapter = BookChapter()
        bookChapter.url = bookChapterUrl
        val analyzeUrl =
            AnalyzeUrl(
                book = book,
                ruleUrl = bookChapter.url,
//                    baseUrl = book?.tocUrl,
                headerMapF = bookSource.getHeaderMap()
            )
        val body = analyzeUrl.getResponseAwait(
            bookSource.bookSourceUrl,
            jsStr = bookSource.getContentRule().webJs,
            sourceRegex = bookSource.getContentRule().sourceRegex
        ).body
//        }
        return BookContent.analyzeContent(
//                this,
            body,
            book,
            bookChapter,
            bookSource,
            bookChapter.url,
            nextChapterUrl
        )
    }
}