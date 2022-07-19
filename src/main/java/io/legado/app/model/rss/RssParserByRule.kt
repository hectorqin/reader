package io.legado.app.model.rss

import io.legado.app.data.entities.RssArticle
import io.legado.app.data.entities.RssSource
import io.legado.app.exception.NoStackTraceException
import io.legado.app.model.DebugLog
import io.legado.app.model.analyzeRule.AnalyzeRule
import io.legado.app.model.analyzeRule.RuleData
import io.legado.app.utils.NetworkUtils
import java.util.*

object RssParserByRule {

    @Throws(Exception::class)
    fun parseXML(
        sortName: String,
        sortUrl: String,
        body: String?,
        rssSource: RssSource,
        ruleData: RuleData,
        debugLog: DebugLog?
    ): Pair<MutableList<RssArticle>, String?> {
        val sourceUrl = rssSource.sourceUrl
        var nextUrl: String? = null
        if (body.isNullOrBlank()) {
            throw NoStackTraceException(
                "error_get_web_content: " + rssSource.sourceUrl
            )
        }
        // debugLog?.log(sourceUrl, "≡获取成功:$sourceUrl")
        // debugLog?.log(sourceUrl, body)
        var ruleArticles = rssSource.ruleArticles
        if (ruleArticles.isNullOrBlank()) {
            debugLog?.log(sourceUrl, "⇒列表规则为空, 使用默认规则解析")
            return RssParserDefault.parseXML(sortName, body, sourceUrl, debugLog)
        } else {
            val articleList = mutableListOf<RssArticle>()
            val analyzeRule = AnalyzeRule(ruleData, rssSource)
            analyzeRule.setContent(body).setBaseUrl(sortUrl)
            analyzeRule.setRedirectUrl(sortUrl)
            var reverse = false
            if (ruleArticles.startsWith("-")) {
                reverse = true
                ruleArticles = ruleArticles.substring(1)
            }
            debugLog?.log(sourceUrl, "┌获取列表")
            val collections = analyzeRule.getElements(ruleArticles)
            debugLog?.log(sourceUrl, "└列表大小:${collections.size}")
            if (!rssSource.ruleNextPage.isNullOrEmpty()) {
                debugLog?.log(sourceUrl, "┌获取下一页链接")
                if (rssSource.ruleNextPage!!.uppercase(Locale.getDefault()) == "PAGE") {
                    nextUrl = sortUrl
                } else {
                    nextUrl = analyzeRule.getString(rssSource.ruleNextPage)
                    if (nextUrl.isNotEmpty()) {
                        nextUrl = NetworkUtils.getAbsoluteURL(sortUrl, nextUrl)
                    }
                }
                debugLog?.log(sourceUrl, "└$nextUrl")
            }
            val ruleTitle = analyzeRule.splitSourceRule(rssSource.ruleTitle)
            val rulePubDate = analyzeRule.splitSourceRule(rssSource.rulePubDate)
            val ruleDescription = analyzeRule.splitSourceRule(rssSource.ruleDescription)
            val ruleImage = analyzeRule.splitSourceRule(rssSource.ruleImage)
            val ruleLink = analyzeRule.splitSourceRule(rssSource.ruleLink)
            val variable = ruleData.getVariable()
            for ((index, item) in collections.withIndex()) {
                getItem(
                    sourceUrl, item, analyzeRule, variable, index == 0,
                    ruleTitle, rulePubDate, ruleDescription, ruleImage, ruleLink, debugLog
                )?.let {
                    it.sort = sortName
                    it.origin = sourceUrl
                    articleList.add(it)
                }
            }
            if (reverse) {
                articleList.reverse()
            }
            return Pair(articleList, nextUrl)
        }
    }

    private fun getItem(
        sourceUrl: String,
        item: Any,
        analyzeRule: AnalyzeRule,
        variable: String?,
        log: Boolean,
        ruleTitle: List<AnalyzeRule.SourceRule>,
        rulePubDate: List<AnalyzeRule.SourceRule>,
        ruleDescription: List<AnalyzeRule.SourceRule>,
        ruleImage: List<AnalyzeRule.SourceRule>,
        ruleLink: List<AnalyzeRule.SourceRule>,
        debugLog: DebugLog?
    ): RssArticle? {
        val rssArticle = RssArticle(variable = variable)
        analyzeRule.ruleData = rssArticle
        analyzeRule.setContent(item)
        debugLog?.log(sourceUrl, "┌获取标题", log)
        rssArticle.title = analyzeRule.getString(ruleTitle)
        debugLog?.log(sourceUrl, "└${rssArticle.title}", log)
        debugLog?.log(sourceUrl, "┌获取时间", log)
        rssArticle.pubDate = analyzeRule.getString(rulePubDate)
        debugLog?.log(sourceUrl, "└${rssArticle.pubDate}", log)
        debugLog?.log(sourceUrl, "┌获取描述", log)
        if (ruleDescription.isNullOrEmpty()) {
            rssArticle.description = null
            debugLog?.log(sourceUrl, "└描述规则为空，将会解析内容页", log)
        } else {
            rssArticle.description = analyzeRule.getString(ruleDescription)
            debugLog?.log(sourceUrl, "└${rssArticle.description}", log)
        }
        debugLog?.log(sourceUrl, "┌获取图片url", log)
        rssArticle.image = analyzeRule.getString(ruleImage, isUrl = true)
        debugLog?.log(sourceUrl, "└${rssArticle.image}", log)
        debugLog?.log(sourceUrl, "┌获取文章链接", log)
        rssArticle.link = NetworkUtils.getAbsoluteURL(sourceUrl, analyzeRule.getString(ruleLink))
        debugLog?.log(sourceUrl, "└${rssArticle.link}", log)
        if (rssArticle.title.isBlank()) {
            return null
        }
        return rssArticle
    }
}