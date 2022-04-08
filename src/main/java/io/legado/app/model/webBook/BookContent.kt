package io.legado.app.model.webBook


import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import io.legado.app.data.entities.BookSource
import io.legado.app.data.entities.rule.ContentRule
import io.legado.app.model.DebugLog
import io.legado.app.model.analyzeRule.AnalyzeRule
import io.legado.app.model.analyzeRule.AnalyzeUrl
import io.legado.app.utils.NetworkUtils
import io.legado.app.utils.HtmlFormatter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers.IO
import kotlinx.coroutines.async
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

object BookContent {

    suspend fun analyzeContent(
            body: String?,
            book: Book,
            bookChapter: BookChapter,
            bookSource: BookSource,
            baseUrl: String,
            redirectUrl: String,
            nextChapterUrl: String? = null,
            debugLog: DebugLog? = null
    ): String {
        body ?: throw Exception(
                "error_get_web_content"
        )
        debugLog?.log(bookSource.bookSourceUrl, "≡获取成功:${baseUrl}")
        val mNextChapterUrl = if (!nextChapterUrl.isNullOrEmpty()) {
            nextChapterUrl
        } else {
            // appDb.bookChapterDao.getChapter(book.bookUrl, bookChapter.index + 1)?.url
            null
        }
        val content = StringBuilder()
        val nextUrlList = arrayListOf(baseUrl)
        val contentRule = bookSource.getContentRule()
        val analyzeRule = AnalyzeRule(book).setContent(body, baseUrl)
        analyzeRule.setRedirectUrl(baseUrl)
        analyzeRule.nextChapterUrl = mNextChapterUrl
        var contentData = analyzeContent(
            book, baseUrl, redirectUrl, body, contentRule, bookChapter, bookSource, mNextChapterUrl
        )
        content.append(contentData.content)
        if (contentData.nextUrl.size == 1) {
            var nextUrl = contentData.nextUrl[0]
            while (nextUrl.isNotEmpty() && !nextUrlList.contains(nextUrl)) {
                if (!mNextChapterUrl.isNullOrEmpty()
                    && NetworkUtils.getAbsoluteURL(baseUrl, nextUrl)
                    == NetworkUtils.getAbsoluteURL(baseUrl, mNextChapterUrl)
                ) break
                nextUrlList.add(nextUrl)
                val res = AnalyzeUrl(
                    ruleUrl = nextUrl,
                    book = book,
                    headerMapF = bookSource.getHeaderMap()
                ).getStrResponse(bookSource.bookSourceUrl)
                res.body?.let { nextBody ->
                    contentData = analyzeContent(
                        book, nextUrl, res.url, nextBody, contentRule,
                        bookChapter, bookSource, mNextChapterUrl, false
                    )
                    nextUrl =
                        if (contentData.nextUrl.isNotEmpty()) contentData.nextUrl[0] else ""
                    content.append("\n").append(contentData.content)
                }
            }
            debugLog?.log(bookSource.bookSourceUrl, "◇本章总页数:${nextUrlList.size}")
        } else if (contentData.nextUrl.size > 1) {
            debugLog?.log(bookSource.bookSourceUrl, "◇并发解析目录,总页数:${contentData.nextUrl.size}")
            withContext(IO) {
                val asyncArray = Array(contentData.nextUrl.size) {
                    async(IO) {
                        val urlStr = contentData.nextUrl[it]
                        val analyzeUrl = AnalyzeUrl(
                            ruleUrl = urlStr,
                            book = book,
                            headerMapF = bookSource.getHeaderMap()
                        )
                        val res = analyzeUrl.getStrResponse(bookSource.bookSourceUrl)
                        analyzeContent(
                            book, urlStr, res.url, res.body!!, contentRule,
                            bookChapter, bookSource, mNextChapterUrl, false
                        ).content
                    }
                }
                asyncArray.forEach { coroutine ->
                    content.append("\n").append(coroutine.await())
                }
            }
        }
        var contentStr = content.toString()
        val replaceRegex = contentRule.replaceRegex
        if (!replaceRegex.isNullOrEmpty()) {
            contentStr = analyzeRule.getString(replaceRegex, value = contentStr)
        }
        debugLog?.log(bookSource.bookSourceUrl, "┌获取章节名称")
        debugLog?.log(bookSource.bookSourceUrl, "└${bookChapter.title}")
        debugLog?.log(bookSource.bookSourceUrl, "┌获取正文内容")
        debugLog?.log(bookSource.bookSourceUrl, "└\n$contentStr")
        // if (contentStr.isNotBlank()) {
        //     BookHelp.saveContent(book, bookChapter, contentStr)
        // }
        return contentStr
    }

    @Throws(Exception::class)
    private fun analyzeContent(
        book: Book,
        baseUrl: String,
        redirectUrl: String,
        body: String,
        contentRule: ContentRule,
        chapter: BookChapter,
        bookSource: BookSource,
        nextChapterUrl: String?,
        printLog: Boolean = true,
        debugLog: DebugLog? = null
    ): ContentData<List<String>> {
        val analyzeRule = AnalyzeRule(book)
        analyzeRule.setContent(body, baseUrl)
        val rUrl = analyzeRule.setRedirectUrl(redirectUrl)
        analyzeRule.nextChapterUrl = nextChapterUrl
        val nextUrlList = arrayListOf<String>()
        analyzeRule.chapter = chapter
        //获取正文
        var content = analyzeRule.getString(contentRule.content)
        content = HtmlFormatter.formatKeepImg(content, rUrl)
        //获取下一页链接
        val nextUrlRule = contentRule.nextContentUrl
        if (!nextUrlRule.isNullOrEmpty()) {
            if(printLog) debugLog?.log(bookSource.bookSourceUrl, "┌获取正文下一页链接")
            analyzeRule.getStringList(nextUrlRule, true)?.let {
                nextUrlList.addAll(it)
            }
            if(printLog) debugLog?.log(bookSource.bookSourceUrl, "└" + nextUrlList.joinToString("，"))
        }
        return ContentData(content, nextUrlList)
    }
}