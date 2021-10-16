package io.legado.app.model.webbook


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
import kotlinx.coroutines.withContext

object BookContent {

    suspend fun analyzeContent(
            body: String?,
            book: Book?,
            bookChapter: BookChapter,
            bookSource: BookSource,
            baseUrl: String,
            nextChapterUrlF: String? = null,
            debugLog: DebugLog? = null
    ): String {
        body ?: throw Exception(
                "error_get_web_content"
        )
        debugLog?.log(bookSource.bookSourceUrl, "≡获取成功:${baseUrl}")
        val content = StringBuilder()
        val nextUrlList = arrayListOf(baseUrl)
        val contentRule = bookSource.getContentRule()
        var contentData = analyzeContent(body, contentRule, book, bookChapter, bookSource, baseUrl, debugLog = debugLog)
        content.append(contentData.content)
        if (contentData.nextUrl.size == 1) {
            var nextUrl = contentData.nextUrl[0]
            val nextChapterUrl = if (!nextChapterUrlF.isNullOrEmpty())
                nextChapterUrlF
            else
                //todo
                throw RuntimeException("我在java上没有App.db啊啊啊")
            while (nextUrl.isNotEmpty() && !nextUrlList.contains(nextUrl)) {
                if (!nextChapterUrl.isNullOrEmpty()
                        && NetworkUtils.getAbsoluteURL(baseUrl, nextUrl)
                        == NetworkUtils.getAbsoluteURL(baseUrl, nextChapterUrl)
                ) break
                nextUrlList.add(nextUrl)
                AnalyzeUrl(
                        ruleUrl = nextUrl,
                        ruleData = book,
                        headerMapF = bookSource.getHeaderMap()
                ).getResponseAwait()
                        .body?.let { nextBody ->
                    contentData =
                            analyzeContent(
                                    nextBody, contentRule, book,
                                    bookChapter, bookSource, baseUrl, debugLog = debugLog
                            )
                    nextUrl =
                            if (contentData.nextUrl.isNotEmpty()) contentData.nextUrl[0] else ""
                    content.append(contentData.content)
                }
            }
            debugLog?.log(bookSource.bookSourceUrl, "◇本章总页数:${nextUrlList.size}")
        } else if (contentData.nextUrl.size > 1) {
            val contentDataList = arrayListOf<ContentData<String>>()
            for (item in contentData.nextUrl) {
                if (!nextUrlList.contains(item))
                    contentDataList.add(ContentData(nextUrl = item))
            }
            for (item in contentDataList) {
//                withContext(coroutineScope.coroutineContext) {
                    AnalyzeUrl(
                            ruleUrl = item.nextUrl,
                            ruleData = book,
                            headerMapF = bookSource.getHeaderMap()
                    ).getResponseAwait()
                            .body?.let {
                        contentData =
                                analyzeContent(
                                        it, contentRule, book, bookChapter,
                                        bookSource, item.nextUrl, debugLog = debugLog
                                )
                        item.content = contentData.content
                    }
//                }
            }
            for (item in contentDataList) {
                content.append(item.content)
            }
        }
        debugLog?.log(bookSource.bookSourceUrl, "┌获取章节名称")
        debugLog?.log(bookSource.bookSourceUrl, "└${bookChapter.title}")
        debugLog?.log(bookSource.bookSourceUrl, "┌获取正文内容")
        debugLog?.log(bookSource.bookSourceUrl, "└\n$content")
        return content.toString()
    }

    private fun analyzeContent(
            body: String,
            contentRule: ContentRule,
            book: Book?,
            chapter: BookChapter,
            bookSource: BookSource,
            baseUrl: String,
            debugLog: DebugLog? = null
    ): ContentData<List<String>> {
        val nextUrlList = arrayListOf<String>()
        val analyzeRule = AnalyzeRule(book)
        analyzeRule.setContent(body, baseUrl)
        analyzeRule.chapter = chapter
        val nextUrlRule = contentRule.nextContentUrl
        if (!nextUrlRule.isNullOrEmpty()) {
            debugLog?.log(bookSource.bookSourceUrl, "┌获取正文下一页链接")
            analyzeRule.getStringList(nextUrlRule, true)?.let {
                nextUrlList.addAll(it)
            }
            debugLog?.log(bookSource.bookSourceUrl, "└" + nextUrlList.joinToString("，"))
        }
        val content = HtmlFormatter.formatKeepImg(analyzeRule.getString(contentRule.content))
        return ContentData(content, nextUrlList)
    }
}