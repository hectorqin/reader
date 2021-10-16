package io.legado.app.model.webbook

import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookSource
import io.legado.app.model.DebugLog
import io.legado.app.model.analyzeRule.AnalyzeRule
import io.legado.app.utils.NetworkUtils
import io.legado.app.utils.htmlFormat

object BookInfo {

    @Throws(Exception::class)
    fun analyzeBookInfo(
        book: Book,
        body: String?,
        bookSource: BookSource,
        baseUrl: String,
        debugLog: DebugLog? = null
    ) {
        body ?: throw Exception(
        "error_get_web_content"
        )
        debugLog?.log(bookSource.bookSourceUrl, "≡获取成功:${baseUrl}")
        val infoRule = bookSource.getBookInfoRule()
        val analyzeRule = AnalyzeRule(book)
        analyzeRule.setContent(body, baseUrl)
        infoRule.init?.let {
            if (it.isNotEmpty()) {
                debugLog?.log(bookSource.bookSourceUrl, "≡执行详情页初始化规则")
                analyzeRule.setContent(analyzeRule.getElement(it))
            }
        }
        debugLog?.log(bookSource.bookSourceUrl, "┌获取书名")
        analyzeRule.getString(infoRule.name).let {
            if (it.isNotEmpty()) book.name = it
        }
        debugLog?.log(bookSource.bookSourceUrl, "└${book.name}")
        debugLog?.log(bookSource.bookSourceUrl, "┌获取作者")
        analyzeRule.getString(infoRule.author).let {
            if (it.isNotEmpty()) book.author = it
        }
        debugLog?.log(bookSource.bookSourceUrl, "└${book.author}")
        debugLog?.log(bookSource.bookSourceUrl, "┌获取分类")
        analyzeRule.getString(infoRule.kind).let {
            if (it.isNotEmpty()) book.kind = it
        }
        debugLog?.log(bookSource.bookSourceUrl, "└${book.kind}")
        debugLog?.log(bookSource.bookSourceUrl, "┌获取字数")
        analyzeRule.getString(infoRule.wordCount).let {
            if (it.isNotEmpty()) book.wordCount = it
        }
        debugLog?.log(bookSource.bookSourceUrl, "└${book.wordCount}")
        debugLog?.log(bookSource.bookSourceUrl, "┌获取最新章节")
        analyzeRule.getString(infoRule.lastChapter).let {
            if (it.isNotEmpty()) book.latestChapterTitle = it
        }
        debugLog?.log(bookSource.bookSourceUrl, "└${book.latestChapterTitle}")
        debugLog?.log(bookSource.bookSourceUrl, "┌获取简介")
        analyzeRule.getString(infoRule.intro).let {
            if (it.isNotEmpty()) book.intro = it.htmlFormat()
        }
        debugLog?.log(bookSource.bookSourceUrl, "└${book.intro}")

        debugLog?.log(bookSource.bookSourceUrl, "┌获取封面链接")
        analyzeRule.getString(infoRule.coverUrl).let {
            if (it.isNotEmpty()) book.coverUrl = NetworkUtils.getAbsoluteURL(baseUrl, it)
        }
        debugLog?.log(bookSource.bookSourceUrl, "└${book.coverUrl}")
        debugLog?.log(bookSource.bookSourceUrl, "┌获取目录链接")
        book.tocUrl = analyzeRule.getString(infoRule.tocUrl, true) ?: baseUrl
        if (book.tocUrl.isEmpty()) book.tocUrl = baseUrl
        if (book.tocUrl == baseUrl) {
            book.tocHtml = body
        }
        debugLog?.log(bookSource.bookSourceUrl, "└${book.tocUrl}")
    }

}