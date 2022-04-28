package io.legado.app.model.webBook

import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookSource
import io.legado.app.help.BookHelp
import io.legado.app.model.DebugLog
import io.legado.app.model.analyzeRule.AnalyzeRule
import io.legado.app.utils.NetworkUtils
import io.legado.app.utils.StringUtils.wordCountFormat
import io.legado.app.utils.htmlFormat

object BookInfo {

    @Throws(Exception::class)
    fun analyzeBookInfo(
        book: Book,
        body: String?,
        bookSource: BookSource,
        baseUrl: String,
        redirectUrl: String,
        canReName: Boolean,
        debugLog: DebugLog? = null
    ) {
        body ?: throw Exception(
            "error_get_web_content: " + baseUrl
        )
        debugLog?.log(bookSource.bookSourceUrl, "≡获取成功:${baseUrl}")
        val analyzeRule = AnalyzeRule(book, bookSource)
        analyzeRule.setContent(body).setBaseUrl(baseUrl)
        analyzeRule.setRedirectUrl(redirectUrl)
        analyzeBookInfo(book, body, analyzeRule, bookSource, baseUrl, redirectUrl, canReName, debugLog)
    }

    @Throws(Exception::class)
    fun analyzeBookInfo(
        book: Book,
        body: String?,
        analyzeRule: AnalyzeRule,
        bookSource: BookSource,
        baseUrl: String,
        redirectUrl: String,
        canReName: Boolean,
        debugLog: DebugLog? = null
    ) {
        body ?: throw Exception(
            "error_get_web_content: " + baseUrl
        )
        val infoRule = bookSource.getBookInfoRule()
        infoRule.init?.let {
            if (it.isNotEmpty()) {
                debugLog?.log(bookSource.bookSourceUrl, "≡执行详情页初始化规则")
                analyzeRule.setContent(analyzeRule.getElement(it))
            }
        }
        val mCanReName = canReName && !infoRule.canReName.isNullOrBlank()
        debugLog?.log(bookSource.bookSourceUrl, "┌获取书名")
        BookHelp.formatBookName(analyzeRule.getString(infoRule.name)).let {
            if (it.isNotEmpty() && (mCanReName || book.name.isEmpty())) {
                book.name = it
            }
            debugLog?.log(bookSource.bookSourceUrl, "└${it}")
        }
        debugLog?.log(bookSource.bookSourceUrl, "┌获取作者")
        BookHelp.formatBookAuthor(analyzeRule.getString(infoRule.author)).let {
            if (it.isNotEmpty() && (mCanReName || book.author.isEmpty())) {
                book.author = it
            }
            debugLog?.log(bookSource.bookSourceUrl, "└${it}")
        }
        debugLog?.log(bookSource.bookSourceUrl, "┌获取分类")
        try {
            analyzeRule.getStringList(infoRule.kind)
                ?.joinToString(",")
                ?.let {
                    if (it.isNotEmpty()) book.kind = it
                }
            debugLog?.log(bookSource.bookSourceUrl, "└${book.kind}")
        } catch (e: Exception) {
            debugLog?.log(bookSource.bookSourceUrl, "└${e.localizedMessage}")
        }
        debugLog?.log(bookSource.bookSourceUrl, "┌获取字数")
        try {
            wordCountFormat(analyzeRule.getString(infoRule.wordCount)).let {
                if (it.isNotEmpty()) book.wordCount = it
            }
            debugLog?.log(bookSource.bookSourceUrl, "└${book.wordCount}")
        } catch (e: Exception) {
            debugLog?.log(bookSource.bookSourceUrl, "└${e.localizedMessage}")
        }
        debugLog?.log(bookSource.bookSourceUrl, "┌获取最新章节")
        try {
            analyzeRule.getString(infoRule.lastChapter).let {
                if (it.isNotEmpty()) book.latestChapterTitle = it
            }
            debugLog?.log(bookSource.bookSourceUrl, "└${book.latestChapterTitle}")
        } catch (e: Exception) {
            debugLog?.log(bookSource.bookSourceUrl, "└${e.localizedMessage}")
        }
        debugLog?.log(bookSource.bookSourceUrl, "┌获取简介")
        try {
            analyzeRule.getString(infoRule.intro).let {
                if (it.isNotEmpty()) book.intro = it.htmlFormat()
            }
            debugLog?.log(bookSource.bookSourceUrl, "└${book.intro}")
        } catch (e: Exception) {
            debugLog?.log(bookSource.bookSourceUrl, "└${e.localizedMessage}")
        }
        debugLog?.log(bookSource.bookSourceUrl, "┌获取封面链接")
        try {
            analyzeRule.getString(infoRule.coverUrl).let {
                if (it.isNotEmpty()) {
                    book.coverUrl =
                        NetworkUtils.getAbsoluteURL(redirectUrl, it)
                }
            }
            debugLog?.log(bookSource.bookSourceUrl, "└${book.coverUrl}")
        } catch (e: Exception) {
            debugLog?.log(bookSource.bookSourceUrl, "└${e.localizedMessage}")
        }
        debugLog?.log(bookSource.bookSourceUrl, "┌获取目录链接")
        book.tocUrl = analyzeRule.getString(infoRule.tocUrl, isUrl = true)
        if (book.tocUrl.isEmpty()) book.tocUrl = baseUrl
        if (book.tocUrl == baseUrl) {
            book.tocHtml = body
        }
        debugLog?.log(bookSource.bookSourceUrl, "└${book.tocUrl}")
    }

}