package io.legado.app.data.entities

import io.legado.app.utils.GSON
import io.legado.app.utils.fromJsonObject
import io.legado.app.model.analyzeRule.RuleDataInterface

data class RssArticle(
    var origin: String = "",
    var sort: String = "",
    var title: String = "",
    var order: Long = 0,
    var link: String = "",
    var pubDate: String? = null,
    var description: String? = null,
    var content: String? = null,
    var image: String? = null,
    var read: Boolean = false,
    var variable: String? = null
): RuleDataInterface {

    override fun hashCode() = link.hashCode()

    override fun equals(other: Any?): Boolean {
        other ?: return false
        return if (other is RssArticle) origin == other.origin && link == other.link else false
    }

    override val variableMap by lazy {
        GSON.fromJsonObject<HashMap<String, String>>(variable) ?: HashMap()
    }

    override fun putVariable(key: String, value: String?) {
        if (value != null) {
            variableMap[key] = value
        } else {
            variableMap.remove(key)
        }
        variable = GSON.toJson(variableMap)
    }

    // fun toStar() = RssStar(
    //     origin = origin,
    //     sort = sort,
    //     title = title,
    //     starTime = System.currentTimeMillis(),
    //     link = link,
    //     pubDate = pubDate,
    //     description = description,
    //     content = content,
    //     image = image
    // )
}