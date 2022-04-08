package io.legado.app.data.entities

import io.legado.app.utils.GSON
import io.legado.app.utils.fromJsonArray
import io.legado.app.help.JsExtensions
import io.legado.app.constant.AppConst
import javax.script.SimpleBindings
data class RssSource(
    var sourceUrl: String = "",
    var sourceName: String = "",
    var sourceIcon: String = "",
    var sourceGroup: String? = null,
    var sourceComment: String? = null,
    var enabled: Boolean = true,
    var concurrentRate: String? = null,    //并发率
    var header: String? = null,            // 请求头
    var loginUrl: String? = null,          // 登录地址
    // var loginUi: List<RowUi>? = null,               //登录UI
    var loginCheckJs: String? = null,               //登录检测js
    var sortUrl: String? = null,
    var singleUrl: Boolean = false,
    //列表规则
    var articleStyle: Int = 0,                      //列表样式,0,1,2
    var ruleArticles: String? = null,
    var ruleNextPage: String? = null,
    var ruleTitle: String? = null,
    var rulePubDate: String? = null,
    //webView规则
    var ruleDescription: String? = null,
    var ruleImage: String? = null,
    var ruleLink: String? = null,
    var ruleContent: String? = null,
    var style: String? = null,
    var enableJs: Boolean = true,
    var loadWithBaseUrl: Boolean = true,
    var customOrder: Int = 0
): JsExtensions {

    fun getTag(): String {
        return sourceName
    }

    fun getKey(): String {
        return sourceUrl
    }

    override fun equals(other: Any?): Boolean {
        if (other is RssSource) {
            return other.sourceUrl == sourceUrl
        }
        return false
    }

    override fun hashCode() = sourceUrl.hashCode()

    fun equal(source: RssSource): Boolean {
        return equal(sourceUrl, source.sourceUrl)
                && equal(sourceIcon, source.sourceIcon)
                && enabled == source.enabled
                && equal(sourceGroup, source.sourceGroup)
                && equal(ruleArticles, source.ruleArticles)
                && equal(ruleNextPage, source.ruleNextPage)
                && equal(ruleTitle, source.ruleTitle)
                && equal(rulePubDate, source.rulePubDate)
                && equal(ruleDescription, source.ruleDescription)
                && equal(ruleLink, source.ruleLink)
                && equal(ruleContent, source.ruleContent)
                && enableJs == source.enableJs
                && loadWithBaseUrl == source.loadWithBaseUrl
    }

    private fun equal(a: String?, b: String?): Boolean {
        return a == b || (a.isNullOrEmpty() && b.isNullOrEmpty())
    }

    fun sortUrls(): List<Pair<String, String>> = arrayListOf<Pair<String, String>>().apply {
        kotlin.runCatching {
            var a = sortUrl
            if (sortUrl?.startsWith("<js>", false) == true
                || sortUrl?.startsWith("@js:", false) == true
            ) {
                val jsStr = if (sortUrl!!.startsWith("@")) {
                    sortUrl!!.substring(4)
                } else {
                    sortUrl!!.substring(4, sortUrl!!.lastIndexOf("<"))
                }
                a = evalJS(jsStr).toString()
            }
            a?.split("(&&|\n)+".toRegex())?.forEach { c ->
                val d = c.split("::")
                if (d.size > 1)
                    add(Pair(d[0], d[1]))
            }
            if (isEmpty()) {
                add(Pair("", sourceUrl))
            }
        }
    }

    /**
     * 执行JS
     */
    @Throws(Exception::class)
    fun evalJS(jsStr: String, bindingsConfig: SimpleBindings.() -> Unit = {}): Any? {
        val bindings = SimpleBindings()
        bindings.apply(bindingsConfig)
        bindings["java"] = this
        bindings["source"] = this
        bindings["baseUrl"] = getKey()
        return AppConst.SCRIPT_ENGINE.eval(jsStr, bindings)
    }
}