package io.legado.app.model.webBook

import io.legado.app.data.entities.Book
import io.legado.app.data.entities.BookChapter
import io.legado.app.data.entities.BookSource
import io.legado.app.data.entities.rule.TocRule
import io.legado.app.exception.TocEmptyException
import io.legado.app.model.DebugLog
import io.legado.app.model.analyzeRule.AnalyzeRule
import io.legado.app.model.analyzeRule.AnalyzeUrl
import io.legado.app.utils.isTrue
import io.legado.app.utils.TextUtils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers.IO
import kotlinx.coroutines.async
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

object BookChapterList {

    suspend fun analyzeChapterList(
        book: Book,
        body: String?,
        bookSource: BookSource,
        baseUrl: String,
        redirectUrl: String,
        debugLog: DebugLog? = null
    ): List<BookChapter> {
        body ?: throw Exception(
//            App.INSTANCE.getString(R.string.error_get_web_content, baseUrl)
            //todo getString
            "error_get_web_content"
        )
        val chapterList = arrayListOf<BookChapter>()
        debugLog?.log(bookSource.bookSourceUrl, "≡获取成功:${baseUrl}")
        // debugLog?.log(bookSource.bookSourceUrl, body)
        val tocRule = bookSource.getTocRule()
        val nextUrlList = arrayListOf(redirectUrl)
        var reverse = false
        var listRule = tocRule.chapterList ?: ""
        if (listRule.startsWith("-")) {
            reverse = true
            listRule = listRule.substring(1)
        }
        if (listRule.startsWith("+")) {
            listRule = listRule.substring(1)
        }
        var chapterData =
            analyzeChapterList(
                book, baseUrl, redirectUrl, body,
                tocRule, listRule, bookSource, true, true, debugLog
            )
        chapterList.addAll(chapterData.first)
        when (chapterData.second.size) {
            0 -> Unit
            1 -> {
                var nextUrl = chapterData.second[0]
                while (nextUrl.isNotEmpty() && !nextUrlList.contains(nextUrl)) {
                    nextUrlList.add(nextUrl)
                    AnalyzeUrl(
                        mUrl = nextUrl,
                        source = bookSource,
                        ruleData = book,
                        headerMapF = bookSource.getHeaderMap()
                    ).getStrResponseAwait().body?.let { nextBody ->
                        chapterData = analyzeChapterList(
                            book, nextUrl, nextUrl,
                            nextBody, tocRule, listRule, bookSource, false, false, debugLog
                        )
                        nextUrl = chapterData.second.firstOrNull() ?: ""
                        chapterList.addAll(chapterData.first)
                    }
                }
                debugLog?.log(bookSource.bookSourceUrl, "◇目录总页数:${nextUrlList.size}")
            }
            else -> {
                debugLog?.log(bookSource.bookSourceUrl, "◇并发解析目录,总页数:${chapterData.second.size}")
                withContext(IO) {
                    val asyncArray = Array(chapterData.second.size) {
                        async(IO) {
                            val urlStr = chapterData.second[it]
                            val analyzeUrl = AnalyzeUrl(
                                mUrl = urlStr,
                                source = bookSource,
                                ruleData = book,
                                headerMapF = bookSource.getHeaderMap()
                            )
                            val res = analyzeUrl.getStrResponseAwait()
                            analyzeChapterList(
                                book, urlStr, res.url,
                                res.body!!, tocRule, listRule, bookSource, false, false, debugLog
                            ).first
                        }
                    }
                    asyncArray.forEach { coroutine ->
                        chapterList.addAll(coroutine.await())
                    }
                }
            }
        }
        if (chapterList.isEmpty()) {
            throw TocEmptyException("目录为空")
        }
        //去重
        if (!reverse) {
            chapterList.reverse()
        }
        val lh = LinkedHashSet(chapterList)
        val list = ArrayList(lh)
        // if (!book.getReverseToc()) {
        list.reverse()
        // }
        debugLog?.log(book.origin, "◇目录总数:${list.size}")
        list.forEachIndexed { index, bookChapter ->
            bookChapter.index = index
        }
        if (list.size > 0) {
            book.latestChapterTitle = list.last().title
        }
//        book.durChapterTitle =
//            list.getOrNull(book.durChapterIndex)?.title ?: book.latestChapterTitle
        if (book.totalChapterNum < list.size) {
            book.lastCheckCount = list.size - book.totalChapterNum
            // book.latestChapterTime = System.currentTimeMillis()
            // book.lastCheckTime = System.currentTimeMillis()
        }
        book.totalChapterNum = list.size
        return list
    }

    private fun analyzeChapterList(
        book: Book,
        baseUrl: String,
        redirectUrl: String,
        body: String,
        tocRule: TocRule,
        listRule: String,
        bookSource: BookSource,
        getNextUrl: Boolean = true,
        log: Boolean = false,
        debugLog: DebugLog? = null
    ): Pair<List<BookChapter>, List<String>>  {
        val analyzeRule = AnalyzeRule(book, bookSource)
        analyzeRule.setContent(body).setBaseUrl(baseUrl)
        analyzeRule.setRedirectUrl(redirectUrl)
        //获取目录列表
        val chapterList = arrayListOf<BookChapter>()
        if(log) debugLog?.log(bookSource.bookSourceUrl, "┌获取目录列表")
        val elements = analyzeRule.getElements(listRule)
        if(log) debugLog?.log(bookSource.bookSourceUrl, "└列表大小:${elements.size}")
        //获取下一页链接
        val nextUrlList = arrayListOf<String>()
        val nextTocRule = tocRule.nextTocUrl
        if (getNextUrl && !nextTocRule.isNullOrEmpty()) {
            if(log) debugLog?.log(bookSource.bookSourceUrl, "┌获取目录下一页列表")
            analyzeRule.getStringList(nextTocRule, isUrl = true)?.let {
                for (item in it) {
                    if (item != redirectUrl) {
                        nextUrlList.add(item)
                    }
                }
            }
            if(log) debugLog?.log(bookSource.bookSourceUrl, "└" + TextUtils.join("，\n", nextUrlList))
        }
        if (elements.isNotEmpty()) {
            if(log) debugLog?.log(bookSource.bookSourceUrl, "┌解析目录列表")
            val nameRule = analyzeRule.splitSourceRule(tocRule.chapterName)
            val urlRule = analyzeRule.splitSourceRule(tocRule.chapterUrl)
            val vipRule = analyzeRule.splitSourceRule(tocRule.isVip)
            val upTimeRule = analyzeRule.splitSourceRule(tocRule.updateTime)
            // val isVolumeRule = analyzeRule.splitSourceRule(tocRule.isVolume)
            elements.forEachIndexed { index, item ->
                analyzeRule.setContent(item)
                val bookChapter = BookChapter(bookUrl = book.bookUrl, baseUrl = redirectUrl)
                analyzeRule.chapter = bookChapter
                bookChapter.title = analyzeRule.getString(nameRule)
                bookChapter.url = analyzeRule.getString(urlRule)
                bookChapter.tag = analyzeRule.getString(upTimeRule)
                if (bookChapter.url.isEmpty()) {
                    if (bookChapter.isVolume) {
                        bookChapter.url = bookChapter.title + index
                        if(log) debugLog?.log(bookSource.bookSourceUrl, "⇒一级目录${index}未获取到url,使用标题替代")
                    } else {
                        bookChapter.url = baseUrl
                        if(log) debugLog?.log(bookSource.bookSourceUrl, "⇒目录${index}未获取到url,使用baseUrl替代")
                    }
                }
                if (bookChapter.title.isNotEmpty()) {
                    var isVip = analyzeRule.getString(vipRule)
                    if (isVip.isTrue()) {
                        bookChapter.title = "\uD83D\uDD12" + bookChapter.title
                    }
                    chapterList.add(bookChapter)
                }
            }
            if(log) debugLog?.log(bookSource.bookSourceUrl, "└目录列表解析完成")
            if(log) debugLog?.log(bookSource.bookSourceUrl, "┌获取首章名称")
            if(log) debugLog?.log(bookSource.bookSourceUrl, "└${chapterList[0].title}")
            if(log) debugLog?.log(bookSource.bookSourceUrl, "┌获取首章链接")
            if(log) debugLog?.log(bookSource.bookSourceUrl, "└${chapterList[0].url}")
            if(log) debugLog?.log(bookSource.bookSourceUrl, "┌获取首章信息")
            if(log) debugLog?.log(bookSource.bookSourceUrl, "└${chapterList[0].tag}")
        }
        return Pair(chapterList, nextUrlList)
    }

}