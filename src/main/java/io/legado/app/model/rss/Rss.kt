package io.legado.app.model.rss

import io.legado.app.data.entities.RssArticle
import io.legado.app.data.entities.RssSource
import io.legado.app.help.coroutine.Coroutine
import io.legado.app.model.DebugLog
import io.legado.app.model.analyzeRule.AnalyzeRule
import io.legado.app.model.analyzeRule.AnalyzeUrl
import io.legado.app.model.analyzeRule.RuleData
import io.legado.app.utils.NetworkUtils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlin.coroutines.CoroutineContext

object Rss {
    suspend fun getArticles(
        sortName: String,
        sortUrl: String,
        rssSource: RssSource,
        page: Int,
        debugLog: DebugLog?
    ): Pair<MutableList<RssArticle>, String?> {
        val ruleData = RuleData()
        val analyzeUrl = AnalyzeUrl(
            sortUrl,
            page = page,
            source = rssSource,
            ruleData = ruleData,
            headerMapF = rssSource.getHeaderMap()
        )
        val body = analyzeUrl.getStrResponseAwait(debugLog = debugLog).body
        // debugLog?.log(rssSource.sourceUrl, "┌获取链接内容:${sortUrl}")
        // debugLog?.log(rssSource.sourceUrl, "└\n${body}")
        return RssParserByRule.parseXML(sortName, sortUrl, body, rssSource, ruleData, debugLog)
    }

    suspend fun getContent(
        rssArticle: RssArticle,
        ruleContent: String,
        rssSource: RssSource,
        debugLog: DebugLog?
    ): String {
        val analyzeUrl = AnalyzeUrl(
            rssArticle.link,
            baseUrl = rssArticle.origin,
            source = rssSource,
            ruleData = rssArticle,
            headerMapF = rssSource.getHeaderMap()
        )
        val body = analyzeUrl.getStrResponseAwait(debugLog = debugLog).body
        // debugLog?.log(rssSource.sourceUrl, "┌获取链接内容:${rssArticle.link}")
        // debugLog?.log(rssSource.sourceUrl, "└\n${body}")
        val analyzeRule = AnalyzeRule(rssArticle, rssSource)
        analyzeRule.setContent(body)
            .setBaseUrl(NetworkUtils.getAbsoluteURL(rssArticle.origin, rssArticle.link))
        return analyzeRule.getString(ruleContent)
    }
}