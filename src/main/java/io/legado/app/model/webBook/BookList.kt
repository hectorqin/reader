package io.legado.app.model.webBook

import io.legado.app.data.entities.BookSource
import io.legado.app.data.entities.Book
import io.legado.app.data.entities.SearchBook
import io.legado.app.data.entities.rule.BookListRule
import io.legado.app.help.BookHelp
import io.legado.app.model.DebugLog
import io.legado.app.model.analyzeRule.AnalyzeRule
import io.legado.app.model.analyzeRule.AnalyzeUrl
import io.legado.app.utils.NetworkUtils
import io.legado.app.utils.StringUtils.wordCountFormat
import io.legado.app.utils.htmlFormat

object BookList {

    @Throws(Exception::class)
    fun analyzeBookList(
        body: String?,
        bookSource: BookSource,
        analyzeUrl: AnalyzeUrl,
        baseUrl: String,
        variableBook: SearchBook,
        isSearch: Boolean = true,
        debugLog: DebugLog? = null
    ): ArrayList<SearchBook> {
        val bookList = ArrayList<SearchBook>()
        body ?: throw Exception(
//            App.INSTANCE.getString(
//                R.string.error_get_web_content,
//                analyzeUrl.ruleUrl
//            )
                //todo getString
                "error_get_web_content"
        )
        debugLog?.log(bookSource.bookSourceUrl, "≡获取成功:${analyzeUrl.ruleUrl}")
        val analyzeRule = AnalyzeRule(variableBook, bookSource)
        analyzeRule.setContent(body).setBaseUrl(baseUrl)
        analyzeRule.setRedirectUrl(baseUrl)
        bookSource.bookUrlPattern?.let {
            if (baseUrl.matches(it.toRegex())) {
                debugLog?.log(bookSource.bookSourceUrl, "≡链接为详情页")
                getInfoItem(body, analyzeRule, bookSource, analyzeUrl, baseUrl,  variableBook.variable, debugLog = debugLog)?.let { searchBook ->
                    searchBook.infoHtml = body
                    bookList.add(searchBook)
                }
                return bookList
            }
        }
        val collections: List<Any>
        var reverse = false
        val bookListRule: BookListRule = when {
            isSearch -> bookSource.getSearchRule()
            bookSource.getExploreRule().bookList.isNullOrBlank() -> bookSource.getSearchRule()
            else -> bookSource.getExploreRule()
        }
        var ruleList: String = bookListRule.bookList ?: ""
        if (ruleList.startsWith("-")) {
            reverse = true
            ruleList = ruleList.substring(1)
        }
        if (ruleList.startsWith("+")) {
            ruleList = ruleList.substring(1)
        }
        debugLog?.log(bookSource.bookSourceUrl, "┌获取书籍列表")
        collections = analyzeRule.getElements(ruleList)
        if (collections.isEmpty() && bookSource.bookUrlPattern.isNullOrEmpty()) {
            debugLog?.log(bookSource.bookSourceUrl, "└列表为空,按详情页解析")
            getInfoItem(body, analyzeRule, bookSource, analyzeUrl, baseUrl, variableBook.variable, debugLog = debugLog)?.let { searchBook ->
                searchBook.infoHtml = body
                bookList.add(searchBook)
            }
        } else {
            val ruleName = analyzeRule.splitSourceRule(bookListRule.name)
            val ruleBookUrl = analyzeRule.splitSourceRule(bookListRule.bookUrl)
            val ruleAuthor = analyzeRule.splitSourceRule(bookListRule.author)
            val ruleCoverUrl = analyzeRule.splitSourceRule(bookListRule.coverUrl)
            val ruleIntro = analyzeRule.splitSourceRule(bookListRule.intro)
            val ruleKind = analyzeRule.splitSourceRule(bookListRule.kind)
            val ruleLastChapter = analyzeRule.splitSourceRule(bookListRule.lastChapter)
            val ruleWordCount = analyzeRule.splitSourceRule(bookListRule.wordCount)
            debugLog?.log(bookSource.bookSourceUrl, "└列表大小:${collections.size}")
            for ((index, item) in collections.withIndex()) {
                getSearchItem(
                    item, analyzeRule, bookSource, baseUrl, variableBook.variable, index == 0,
                    ruleName = ruleName, ruleBookUrl = ruleBookUrl, ruleAuthor = ruleAuthor,
                    ruleCoverUrl = ruleCoverUrl, ruleIntro = ruleIntro, ruleKind = ruleKind,
                    ruleLastChapter = ruleLastChapter, ruleWordCount = ruleWordCount,
                    debugLog = debugLog
                )?.let { searchBook ->
                    if (baseUrl == searchBook.bookUrl) {
                        searchBook.infoHtml = body
                    }
                    bookList.add(searchBook)
                }
            }
            if (reverse) {
                bookList.reverse()
            }
        }
        return bookList
    }

    private fun getInfoItem(
        body: String,
        analyzeRule: AnalyzeRule,
        bookSource: BookSource,
        analyzeUrl: AnalyzeUrl,
        baseUrl: String,
        variable: String?,
        debugLog: DebugLog? = null
    ): SearchBook? {
        val book = Book(variable = variable)
        book.bookUrl = analyzeUrl.ruleUrl
        book.origin = bookSource.bookSourceUrl
        book.originName = bookSource.bookSourceName
        book.originOrder = bookSource.customOrder
        book.type = bookSource.bookSourceType
        analyzeRule.ruleData = book
        BookInfo.analyzeBookInfo(
            book,
            body,
            analyzeRule,
            bookSource,
            baseUrl,
            baseUrl,
            false,
            debugLog
        )
        if (book.name.isNotBlank()) {
            return book.toSearchBook()
        }
        return null
    }

    private fun getSearchItem(
        item: Any,
        analyzeRule: AnalyzeRule,
        bookSource: BookSource,
        baseUrl: String,
        variable: String?,
        log: Boolean,
        ruleName: List<AnalyzeRule.SourceRule>,
        ruleBookUrl: List<AnalyzeRule.SourceRule>,
        ruleAuthor: List<AnalyzeRule.SourceRule>,
        ruleKind: List<AnalyzeRule.SourceRule>,
        ruleCoverUrl: List<AnalyzeRule.SourceRule>,
        ruleWordCount: List<AnalyzeRule.SourceRule>,
        ruleIntro: List<AnalyzeRule.SourceRule>,
        ruleLastChapter: List<AnalyzeRule.SourceRule>,
        debugLog: DebugLog? = null
    ): SearchBook? {
        val searchBook = SearchBook(variable = variable)
        searchBook.origin = bookSource.bookSourceUrl
        searchBook.originName = bookSource.bookSourceName
        searchBook.type = bookSource.bookSourceType
        searchBook.originOrder = bookSource.customOrder
        analyzeRule.ruleData = searchBook
        analyzeRule.setContent(item)
        if (log) debugLog?.log(bookSource.bookSourceUrl, "┌获取书名")
        searchBook.name = BookHelp.formatBookName(analyzeRule.getString(ruleName))
        if (log) debugLog?.log(bookSource.bookSourceUrl, "└${searchBook.name}")
        if (searchBook.name.isNotEmpty()) {
            if (log) debugLog?.log(bookSource.bookSourceUrl, "┌获取作者")
            searchBook.author = BookHelp.formatBookAuthor(analyzeRule.getString(ruleAuthor))
            if (log) debugLog?.log(bookSource.bookSourceUrl, "└${searchBook.author}")
            if (log) debugLog?.log(bookSource.bookSourceUrl, "┌获取分类")
            try {
                searchBook.kind = analyzeRule.getStringList(ruleKind)?.joinToString(",")
                if (log) debugLog?.log(bookSource.bookSourceUrl, "└${searchBook.kind}")
            } catch (e: Exception) {
                if (log) debugLog?.log(bookSource.bookSourceUrl, "└${e.localizedMessage}")
            }
            if (log) debugLog?.log(bookSource.bookSourceUrl, "┌获取字数")
            try {
                searchBook.wordCount = wordCountFormat(analyzeRule.getString(ruleWordCount))
                if (log) debugLog?.log(bookSource.bookSourceUrl, "└${searchBook.wordCount}")
            } catch (e: java.lang.Exception) {
                if (log) debugLog?.log(bookSource.bookSourceUrl, "└${e.localizedMessage}")
            }
            if (log) debugLog?.log(bookSource.bookSourceUrl, "┌获取最新章节")
            try {
                searchBook.latestChapterTitle = analyzeRule.getString(ruleLastChapter)
                if (log) debugLog?.log(bookSource.bookSourceUrl, "└${searchBook.latestChapterTitle}")
            } catch (e: java.lang.Exception) {
                if (log) debugLog?.log(bookSource.bookSourceUrl, "└${e.localizedMessage}")
            }
            if (log) debugLog?.log(bookSource.bookSourceUrl, "┌获取简介")
            try {
                searchBook.intro = analyzeRule.getString(ruleIntro).htmlFormat()
                if (log) debugLog?.log(bookSource.bookSourceUrl, "└${searchBook.intro}")
            } catch (e: java.lang.Exception) {
                if (log) debugLog?.log(bookSource.bookSourceUrl, "└${e.localizedMessage}")
            }
            if (log) debugLog?.log(bookSource.bookSourceUrl, "┌获取封面链接")
            try {
                analyzeRule.getString(ruleCoverUrl).let {
                    if (it.isNotEmpty()) searchBook.coverUrl =
                        NetworkUtils.getAbsoluteURL(baseUrl, it)
                }
                if (log) debugLog?.log(bookSource.bookSourceUrl, "└${searchBook.coverUrl}")
            } catch (e: java.lang.Exception) {
                if (log) debugLog?.log(bookSource.bookSourceUrl, "└${e.localizedMessage}")
            }
            if (log) debugLog?.log(bookSource.bookSourceUrl, "┌获取详情页链接")
            searchBook.bookUrl = analyzeRule.getString(ruleBookUrl, isUrl = true)
            if (searchBook.bookUrl.isEmpty()) {
                searchBook.bookUrl = baseUrl
            }
            if (log) debugLog?.log(bookSource.bookSourceUrl, "└${searchBook.bookUrl}")
            return searchBook
        }
        return null
    }

}