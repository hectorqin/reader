package io.legado.app.model.rss

import io.legado.app.data.entities.RssArticle
import io.legado.app.data.entities.RssSource
import io.legado.app.model.DebugLog
import io.legado.app.model.analyzeRule.AnalyzeRule
import io.legado.app.model.analyzeRule.RuleDataInterface
import io.legado.app.utils.GSON

object RssParserByRule {

   @Throws(Exception::class)
   fun parseXML(body: String?, rssSource: RssSource, ruleData: RuleDataInterface, debugLog: DebugLog? = null): MutableList<RssArticle> {
       val sourceUrl = rssSource.sourceUrl
       if (body.isNullOrBlank()) {
           throw Exception("error_get_web_content")
       }
       debugLog?.log(sourceUrl, "≡获取成功:$sourceUrl")
       var ruleArticles = rssSource.ruleArticles
       if (ruleArticles.isNullOrBlank()) {
           debugLog?.log(sourceUrl, "列表规则为空, 使用默认规则解析")
           return RssParser.parseXML(body, sourceUrl)
       } else {
           val articleList = mutableListOf<RssArticle>()
           val analyzeRule = AnalyzeRule(ruleData)
           analyzeRule.setContent(body, rssSource.sourceUrl)
           var reverse = true
           if (ruleArticles.startsWith("-")) {
               reverse = false
               ruleArticles = ruleArticles.substring(1)
           }
           debugLog?.log(sourceUrl, "┌获取列表")
           val collections = analyzeRule.getElements(ruleArticles)
           debugLog?.log(sourceUrl, "└列表大小:${collections.size}")
           val ruleTitle = analyzeRule.splitSourceRule(rssSource.ruleTitle)
           val rulePubDate = analyzeRule.splitSourceRule(rssSource.rulePubDate)
           val ruleDescription = analyzeRule.splitSourceRule(rssSource.ruleDescription)
           val ruleImage = analyzeRule.splitSourceRule(rssSource.ruleImage)
           val ruleLink = analyzeRule.splitSourceRule(rssSource.ruleLink)
           for ((index, item) in collections.withIndex()) {
               getItem(
                   sourceUrl, item, analyzeRule, index == 0,
                   ruleTitle, rulePubDate, ruleDescription, ruleImage, ruleLink,
                   debugLog = debugLog
               )?.let {
                   it.origin = rssSource.sourceUrl
                   articleList.add(it)
               }
           }
           if (reverse) {
               articleList.reverse()
           }
           for ((index: Int, item: RssArticle) in articleList.withIndex()) {
               item.order = System.currentTimeMillis() + index
           }
           return articleList
       }
   }

   private fun getItem(
       sourceUrl: String,
       item: Any,
       analyzeRule: AnalyzeRule,
       log: Boolean,
       ruleTitle: List<AnalyzeRule.SourceRule>,
       rulePubDate: List<AnalyzeRule.SourceRule>,
       ruleDescription: List<AnalyzeRule.SourceRule>,
       ruleImage: List<AnalyzeRule.SourceRule>,
       ruleLink: List<AnalyzeRule.SourceRule>,
       debugLog: DebugLog? = null
   ): RssArticle? {
       val rssArticle = RssArticle()
       analyzeRule.setContent(item)
       debugLog?.log(sourceUrl, "┌获取标题")
       rssArticle.title = analyzeRule.getString(ruleTitle)
       debugLog?.log(sourceUrl, "└${rssArticle.title}")
       debugLog?.log(sourceUrl, "┌获取时间")
       rssArticle.pubDate = analyzeRule.getString(rulePubDate)
       debugLog?.log(sourceUrl, "└${rssArticle.pubDate}")
       debugLog?.log(sourceUrl, "┌获取描述")
       rssArticle.description = analyzeRule.getString(ruleDescription)
       debugLog?.log(sourceUrl, "└${rssArticle.description}")
       debugLog?.log(sourceUrl, "┌获取图片url")
       rssArticle.image = analyzeRule.getString(ruleImage, isUrl = true)
       debugLog?.log(sourceUrl, "└${rssArticle.image}")
       debugLog?.log(sourceUrl, "┌获取文章链接")
       rssArticle.link = analyzeRule.getString(ruleLink)
       debugLog?.log(sourceUrl, "└${rssArticle.link}")
       rssArticle.variable = GSON.toJson(analyzeRule.ruleData.variableMap)
       if (rssArticle.title.isBlank()) {
           return null
       }
       return rssArticle
   }
}