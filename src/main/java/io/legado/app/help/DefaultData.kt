package io.legado.app.help

// import io.legado.app.data.entities.RssSource
import io.legado.app.data.entities.TxtTocRule
import io.legado.app.utils.GSON
import io.legado.app.utils.fromJsonArray
import java.io.File

object DefaultData {
    const val txtTocRuleFileName = "txtTocRule.json"

    val txtTocRules: List<TxtTocRule> by lazy {
        val json = String(DefaultData::class.java.getResource("${File.separator}defaultData${File.separator}$txtTocRuleFileName").readBytes())
        GSON.fromJsonArray<TxtTocRule>(json).getOrNull() ?: emptyList()
    }

    // val rssSources by lazy {
    //     val json = String(
    //         File("defaultData${File.separator}rssSources.json")
    //             .readBytes()
    //     )
    //     GSON.fromJsonArray<RssSource>(json)!!
    // }
}